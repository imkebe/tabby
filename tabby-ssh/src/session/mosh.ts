import { Injector } from '@angular/core'
import { SSHProfile } from '../api'
import { SSHSession } from './ssh'
import { SSHShellSession } from './shell'

export interface MoshConnectionInfo {
    port: number
    key: string
    ip?: string
}

/**
 * Dedicated interactive session object for Mosh transport.
 *
 * Transport bootstrap currently relies on an authenticated SSH session and
 * emits parsed connection metadata for consumers.
 */
export class MoshSession extends SSHShellSession {
    connectionInfo: MoshConnectionInfo|null = null

    constructor (injector: Injector, ssh: SSHSession, profile: SSHProfile) {
        super(injector, ssh, profile)
    }

    registerBootstrapMetadata (metadataLine: string): void {
        const match = metadataLine.match(/MOSH CONNECT (\d+) ([^\s]+)(?:\s+([\d.:a-fA-F]+))?/) ??
            metadataLine.match(/MOSH CONNECT\s+port=(\d+)\s+key=([^\s]+)(?:\s+ip=([^\s]+))?/) ??
            null
        if (!match) {
            return
        }
        this.connectionInfo = {
            port: Number(match[1]),
            key: match[2],
            ip: match[3],
        }
    }
}
