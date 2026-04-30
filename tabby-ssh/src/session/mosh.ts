import { Injector } from '@angular/core'
import { Observable, Subject } from 'rxjs'
import stripAnsi from 'strip-ansi'
import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { LogService, ProfilesService } from 'tabby-core'
import { BaseSession, InputProcessor, UTF8SplitterMiddleware } from 'tabby-terminal'
import { SSHProfile } from '../api'
import { SSHSession } from './ssh'
import * as russh from 'russh'

interface MoshBootstrapData {
    key: string
    port: number
    session: string
}

interface MoshBootstrapParseResult {
    data: MoshBootstrapData|null
    error?: string
}

interface MoshServerPortConfig {
    port: number|null
    portRange: string|null
}

export class SSHMoshSession extends BaseSession {
    bootstrapChannel?: russh.Channel
    moshClient?: ChildProcessWithoutNullStreams

    private serviceMessage = new Subject<string>()
    private ssh: SSHSession|null
    private bootstrapData?: MoshBootstrapData
    private remoteHost = ''

    get serviceMessage$ (): Observable<string> { return this.serviceMessage }

    constructor (
        private injector: Injector,
        ssh: SSHSession,
        private profile: SSHProfile,
    ) {
        super(injector.get(LogService).create(`ssh-mosh-${profile.options.host}-${profile.options.port}`))
        this.ssh = ssh
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
        this.remoteHost = await this.resolveRemoteHost()
        this.open = true
        this.spawnMoshClient()
    }

    private async resolveRemoteHost (): Promise<string> {
        if (!this.profile.options.jumpHost) {
            return this.profile.options.host
        }

        const profiles = await this.injector.get(ProfilesService).getProfiles()
        const jumpProfile = profiles.find(x => x.id === this.profile.options.jumpHost)
        if (!jumpProfile) {
            this.emitServiceMessage(`Mosh settings: jump host profile "${this.profile.options.jumpHost}" not found; UDP will still target destination host ${this.profile.options.host}.`)
            return this.profile.options.host
        }

        this.emitServiceMessage(`Mosh settings: SSH bootstrap is tunneled via jump host ${jumpProfile.name ?? jumpProfile.options?.host ?? this.profile.options.jumpHost}, but UDP transport targets destination host ${this.profile.options.host}. Ensure direct UDP reachability from client to destination.`)
        return this.profile.options.host
    }

    private async bootstrapMoshServer (): Promise<MoshBootstrapData> {
        let channel: russh.Channel
        try {
            channel = await this.ssh!.openShellChannel({ x11: false })
        } catch (error: any) {
            const message = String(error?.message ?? error ?? '')
            if (/host key|auth|authentication|permission denied|handshake/i.test(message)) {
                throw error
            }
            throw new Error(`Unable to open SSH shell channel for Mosh bootstrap: ${message}`)
        }
        this.bootstrapChannel = channel
        const command = this.buildBootstrapCommand()
        if (!command) {
            throw new Error('Invalid Mosh configuration')
        }
        channel.write(new Uint8Array(Buffer.from(`${command}\n`)) )

        const output = await new Promise<string>((resolve, reject) => {
            let acc = ''
            const timer = setTimeout(() => reject(new Error('Mosh bootstrap timed out after 15s while waiting for MOSH CONNECT/MOSH KEY tokens. Verify remote shell startup scripts and mosh-server availability.')), 15000)

            channel.data$.subscribe(data => {
                acc += Buffer.from(data).toString('utf-8')
                const parsed = this.tryParseBootstrap(acc)
                if (parsed.data) {
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
                reject(new Error('SSH channel closed before Mosh bootstrap tokens were received. Verify login shell startup scripts (MOTD/banner), remote command policy, and mosh-server execution permissions.'))
            })
        })

        const parsed = this.tryParseBootstrap(output)
        if (!parsed.data) {
            throw new Error(`Unable to parse mosh-server bootstrap output${parsed.error ? `: ${parsed.error}` : ''}`)
        }

        this.emitServiceMessage(`Mosh bootstrap complete: session ${parsed.data.session}, UDP port ${parsed.data.port}`)
        return parsed.data
    }

    private buildBootstrapCommand (): string|null {
        const options = this.profile.options.mosh
        const serverCommand = options.serverCommand.trim() || 'mosh-server'
        const args = [serverCommand, 'new', '-s']
        const portArgs = this.resolvePortArguments({
            port: options.port,
            portRange: options.portRange,
        })
        if (!portArgs) {
            return null
        }
        args.push(...portArgs)

        if (this.commandSupportsPredictAndEscape(serverCommand)) {
            if (options.predict) {
                args.push(`--predict=${options.predict}`)
            }
            if (options.escapeKey.trim()) {
                args.push(`--escape=${options.escapeKey.trim()}`)
            }
        }

        return args.map(x => this.escapeShellArg(x)).join(' ')
    }

    private resolvePortArguments (config: MoshServerPortConfig): string[]|null {
        const { port, portRange } = config
        if (port !== null && portRange) {
            this.emitServiceMessage('Mosh settings: both fixed port and port range are set; fixed port will be used.')
        }

        if (port !== null) {
            if (!Number.isInteger(port) || port < 1 || port > 65535) {
                this.emitServiceMessage(`Mosh settings: invalid fixed port "${port}". Port must be between 1 and 65535.`)
                return null
            }
            return ['-p', String(port)]
        }

        if (!portRange) {
            return []
        }

        const normalizedRange = this.normalizePortRange(portRange)
        if (!normalizedRange) {
            this.emitServiceMessage(`Mosh settings: invalid port range "${portRange}". Use "start:end" (for example "60000:61000").`)
            return null
        }
        return ['-p', normalizedRange]
    }

    private normalizePortRange (portRange: string): string|null {
        const trimmed = portRange.trim()
        const match = /^(\d{1,5})\s*[:-]\s*(\d{1,5})$/.exec(trimmed)
        if (!match) {
            return null
        }
        const start = Number(match[1])
        const end = Number(match[2])
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1 || start > 65535 || end > 65535 || start > end) {
            return null
        }
        return `${start}:${end}`
    }

    private commandSupportsPredictAndEscape (command: string): boolean {
        const normalized = command.trim()
        return /^mosh(\s|$)/.test(normalized)
    }

    private escapeShellArg (value: string): string {
        return `'${value.replace(/'/g, `'\\''`)}'`
    }

    private tryParseBootstrap (output: string): MoshBootstrapParseResult {
        const sanitized = stripAnsi(output)
        let key: string|undefined
        let portRaw: string|undefined
        let session: string|undefined

        for (const line of sanitized.split(/\r?\n/)) {
            const trimmed = line.trim()
            if (!trimmed) {
                continue
            }
            const connectMatch = /^MOSH CONNECT\s+(\d{1,5})\s+([A-Za-z0-9._~+\-=/]+)\s*$/.exec(trimmed)
            if (connectMatch) {
                portRaw = connectMatch[1]
                session = connectMatch[2]
                continue
            }

            const keyMatch = /^MOSH KEY\s+([A-Za-z0-9._~+\-=/]+)\s*$/.exec(trimmed)
            if (keyMatch) {
                key = keyMatch[1]
            }
        }

        if (!key && !portRaw && !session) {
            return { data: null }
        }
        if (!portRaw) {
            return { data: null, error: 'missing MOSH CONNECT token' }
        }
        if (!session) {
            return { data: null, error: 'missing session token in MOSH CONNECT line' }
        }
        if (!key) {
            return { data: null, error: 'missing MOSH KEY token' }
        }
        const port = Number(portRaw)
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            return { data: null, error: `invalid MOSH CONNECT port "${portRaw}"` }
        }

        return { data: { key, port, session } }
    }

    private spawnMoshClient (): void {
        if (!this.bootstrapData) {
            throw new Error('Mosh bootstrap data missing')
        }

        const args = [
            this.remoteHost,
            String(this.bootstrapData.port),
        ]

        this.moshClient = spawn('mosh-client', args, {
            env: {
                ...process.env,
                MOSH_KEY: this.bootstrapData.key,
                TERM: process.env.TERM || 'xterm-256color',
            },
            stdio: 'pipe',
            windowsHide: true,
        })

        this.moshClient.stdout.on('data', data => this.emitOutput(data))
        this.moshClient.stderr.on('data', data => this.emitServiceMessage(stripAnsi(data.toString('utf-8')).trim()))
        this.moshClient.on('error', error => {
            this.logger.error('mosh-client error', error)
            this.emitServiceMessage('Unable to start mosh-client. Install Mosh locally and ensure mosh-client is in PATH.')
        })
        this.moshClient.on('exit', (code, signal) => {
            this.emitServiceMessage(`mosh-client exited${code !== null ? ` with code ${code}` : ''}${signal ? ` (${signal})` : ''}`)
            this.destroy()
        })

        this.emitServiceMessage(`Connected mosh-client to ${this.remoteHost}:${this.bootstrapData.port} using encrypted Mosh protocol transport`)
        this.emitServiceMessage('Mosh roaming/reconnect is handled by mosh-client; terminal may pause briefly during network changes')
    }


    emitServiceMessage (msg: string): void {
        this.serviceMessage.next(stripAnsi(msg))
    }

    resize (_columns: number, _rows: number): void {
        this.emitServiceMessage('Mosh resize updates are managed by mosh-client terminal state tracking')
    }

    write (data: Buffer): void {
        this.moshClient?.stdin.write(data)
    }

    kill (_signal?: string): void {
        this.moshClient?.kill('SIGTERM')
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

    async getWorkingDirectory (): Promise<string | null> {
        return this.reportedCWD || null
    }
}
