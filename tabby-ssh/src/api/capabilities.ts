import { SSHProfile } from './interfaces'

export interface SSHTransportCapabilities {
    sftp: boolean
    winSCP: boolean
    x11: boolean
    portForwarding: boolean
    sessionReuse: boolean
}

const SSH_TRANSPORT_CAPABILITIES: Record<string, SSHTransportCapabilities> = {
    ssh: {
        sftp: true,
        winSCP: true,
        x11: true,
        portForwarding: true,
        sessionReuse: true,
    },
    mosh: {
        sftp: false,
        winSCP: false,
        x11: false,
        portForwarding: false,
        sessionReuse: false,
    },
}

const DEFAULT_SSH_TRANSPORT_CAPABILITIES = SSH_TRANSPORT_CAPABILITIES.ssh

export function getSSHTransportCapabilities (profile: Pick<SSHProfile, 'options'>): SSHTransportCapabilities {
    return SSH_TRANSPORT_CAPABILITIES[profile.options.transport] ?? DEFAULT_SSH_TRANSPORT_CAPABILITIES
}
