import test from 'node:test'
import assert from 'node:assert/strict'
import { SSHTabComponent } from './sshTab.component'

function buildTab (transport: 'ssh'|'mosh', fallbackToSSH = true) {
    const tab = new SSHTabComponent({} as any, {} as any, {} as any, {} as any, {} as any)
    tab.profile = { options: { transport, mosh: { fallbackToSSH } } } as any
    return tab
}

test('supportsSFTPAndPortForwarding is true for SSH transport', () => {
    const tab = buildTab('ssh')
    assert.equal(tab.supportsSFTPAndPortForwarding, true)
})

test('supportsSFTPAndPortForwarding is false for Mosh transport', () => {
    const tab = buildTab('mosh')
    assert.equal(tab.supportsSFTPAndPortForwarding, false)
})

test('initializeSession retries without multiplex when first SSH attempt fails', async () => {
    const tab = buildTab('ssh')
    const calls: boolean[] = []

    ;(tab as any).initializeSessionMaybeMultiplex = async (multiplex: boolean) => {
        calls.push(multiplex)
        if (multiplex) {
            throw new Error('first attempt failure')
        }
    }

    await tab.initializeSession()
    assert.deepEqual(calls, [true, false])
})

test('initializeSession falls back to SSH shell when mosh startup fails and fallback is enabled', async () => {
    const tab = buildTab('mosh', true)
    const calls: Array<{ multiplex: boolean, forceShell?: boolean }> = []
    const messages: string[] = []

    tab.write = (msg: string) => messages.push(msg)
    ;(tab as any).initializeSessionMaybeMultiplex = async (multiplex: boolean, forceShell = false) => {
        calls.push({ multiplex, forceShell })
        if (!forceShell) {
            ;(tab as any).sshSession = { open: true }
            throw new Error('mosh bootstrap timed out')
        }
    }

    await tab.initializeSession()

    assert.deepEqual(calls, [
        { multiplex: true, forceShell: false },
        { multiplex: true, forceShell: true },
    ])
    assert.ok(messages.some(x => x.includes('Mosh startup failed. Falling back to SSH shell session.')))
})

test('initializeSession stops with terminal error when mosh startup fails and fallback is disabled', async () => {
    const tab = buildTab('mosh', false)
    const calls: Array<{ multiplex: boolean, forceShell?: boolean }> = []
    const messages: string[] = []

    tab.write = (msg: string) => messages.push(msg)
    ;(tab as any).initializeSessionMaybeMultiplex = async (multiplex: boolean, forceShell = false) => {
        calls.push({ multiplex, forceShell })
        ;(tab as any).sshSession = { open: true }
        throw new Error('mosh bootstrap timed out')
    }

    await tab.initializeSession()

    assert.deepEqual(calls, [{ multiplex: true, forceShell: false }])
    assert.ok(messages.some(x => x.includes('Mosh startup failed and fallback to SSH is disabled.')))
    assert.ok(messages.some(x => x.includes('mosh bootstrap timed out')))
})
