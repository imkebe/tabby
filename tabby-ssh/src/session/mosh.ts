import { Injector } from '@angular/core'
import { Observable, Subject } from 'rxjs'
import stripAnsi from 'strip-ansi'
import dgram, { Socket as DgramSocket } from 'dgram'
import { LogService } from 'tabby-core'
import { BaseSession, InputProcessor, UTF8SplitterMiddleware } from 'tabby-terminal'
import { SSHProfile } from '../api'
import { SSHSession } from './ssh'
import * as russh from 'russh'

interface MoshBootstrapData {
    key: string
    port: number
    session: string
}

export class SSHMoshSession extends BaseSession {
    bootstrapChannel?: russh.Channel
    udpSocket?: DgramSocket

    private serviceMessage = new Subject<string>()
    private ssh: SSHSession|null
    private bootstrapData?: MoshBootstrapData
    private remoteHost: string

    get serviceMessage$ (): Observable<string> { return this.serviceMessage }

    constructor (
        injector: Injector,
        ssh: SSHSession,
        private profile: SSHProfile,
    ) {
        super(injector.get(LogService).create(`ssh-mosh-${profile.options.host}-${profile.options.port}`))
        this.ssh = ssh
        this.remoteHost = this.profile.options.jumpHost ?? this.profile.options.host
        this.ssh.serviceMessage$.subscribe(m => this.emitServiceMessage(m))
        this.middleware.push(new UTF8SplitterMiddleware())
        this.middleware.push(new InputProcessor(profile.options.input))
    }

    async start (): Promise<void> {
        if (!this.ssh) {
            throw new Error('SSH session not set')
        }

        this.ssh.ref()
        this.ssh.willDestroy$.subscribe(() => this.destroy())

        this.bootstrapData = await this.bootstrapMoshServer()
        this.open = true
        this.createUDPSocket()
    }

    private async bootstrapMoshServer (): Promise<MoshBootstrapData> {
        const channel = await this.ssh!.openShellChannel({ x11: false })
        this.bootstrapChannel = channel
        channel.write(new Uint8Array(Buffer.from('mosh-server new -s\n')) )

        const output = await new Promise<string>((resolve, reject) => {
            let acc = ''
            const timer = setTimeout(() => reject(new Error('mosh bootstrap timed out')), 15000)

            channel.data$.subscribe(data => {
                acc += Buffer.from(data).toString('utf-8')
                const parsed = this.tryParseBootstrap(acc)
                if (parsed) {
                    clearTimeout(timer)
                    resolve(acc)
                }
                if (/command not found|not recognized|unknown command|mosh-server: not found/i.test(acc)) {
                    clearTimeout(timer)
                    reject(new Error('mosh-server is not installed on remote host'))
                }
            })

            channel.eof$.subscribe(() => {
                clearTimeout(timer)
                reject(new Error('SSH channel closed during mosh bootstrap'))
            })
        })

        const parsed = this.tryParseBootstrap(output)
        if (!parsed) {
            throw new Error('Unable to parse mosh-server bootstrap output')
        }

        this.emitServiceMessage(`Mosh bootstrap complete: session ${parsed.session}, UDP port ${parsed.port}`)
        return parsed
    }

    private tryParseBootstrap (output: string): MoshBootstrapData|null {
        const key = /MOSH KEY\s+([^\s\r\n]+)/.exec(output)?.[1]
        const portRaw = /MOSH CONNECT\s+(\d+)/.exec(output)?.[1]
        const session = /MOSH CONNECT\s+\d+\s+([^\s\r\n]+)/.exec(output)?.[1]

        if (!key || !portRaw || !session) {
            return null
        }

        return {
            key,
            port: Number(portRaw),
            session,
        }
    }

    private createUDPSocket (): void {
        if (!this.bootstrapData) {
            throw new Error('Mosh bootstrap data missing')
        }

        this.udpSocket = dgram.createSocket('udp4')
        this.udpSocket.on('error', error => {
            this.logger.error('UDP socket error', error)
            this.emitServiceMessage('Mosh UDP transport error; this may indicate blocked UDP or unreachable host')
        })
        this.udpSocket.on('message', message => this.emitOutput(message))
        this.udpSocket.connect(this.bootstrapData.port, this.remoteHost, () => {
            this.emitServiceMessage(`Connected UDP transport to ${this.remoteHost}:${this.bootstrapData!.port}`)
            this.emitServiceMessage('SSH bootstrap succeeded; handing control over to Mosh UDP transport')
        })
    }

    resize (columns: number, rows: number): void {
        const payload = Buffer.from(`\\x1b[8;${rows};${columns}t`)
        this.write(payload)
    }

    write (data: Buffer): void {
        if (!this.udpSocket) {
            return
        }
        this.udpSocket.send(data)
    }

    kill (_signal?: string): void {
        this.udpSocket?.close()
        this.bootstrapChannel?.close()
    }

    async gracefullyKillProcess (): Promise<void> {
        this.kill('TERM')
    }

    async destroy (): Promise<void> {
        this.serviceMessage.complete()
        this.kill()
        this.ssh?.unref()
        this.ssh = null
        await super.destroy()
    }

    supportsWorkingDirectory (): boolean {
        return !!this.reportedCWD
    }

    async getWorkingDirectory (): Promise<string|null> {
        return this.reportedCWD ?? null
    }

    private emitServiceMessage (msg: string): void {
        this.serviceMessage.next(msg)
        this.logger.info(stripAnsi(msg))
    }
}
