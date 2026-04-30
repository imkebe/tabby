import { Platform } from 'tabby-core'
import which from 'which'

export interface MoshCapabilityCheckResult {
    available: boolean
    binaryPath?: string
    error?: string
}

export function checkMoshClientAvailability (platform: Platform): MoshCapabilityCheckResult {
    try {
        const binary = platform === Platform.Windows ? 'mosh-client.exe' : 'mosh-client'
        const binaryPath = which.sync(binary, { nothrow: true }) ?? which.sync('mosh-client', { nothrow: true })
        if (binaryPath) {
            return {
                available: true,
                binaryPath,
            }
        }
    } catch {
        // handled below
    }

    const installHint = platform === Platform.Windows
        ? 'Install Mosh for Windows and ensure mosh-client.exe is available in PATH.'
        : platform === Platform.macOS
            ? 'Install Mosh (e.g. `brew install mobile-shell`) and ensure mosh-client is in PATH.'
            : 'Install Mosh from your distro package manager and ensure mosh-client is in PATH.'

    return {
        available: false,
        error: `Mosh transport requires the external mosh-client binary. ${installHint}`,
    }
}
