import test from 'node:test'
import assert from 'node:assert/strict'
import { SSHTabComponent } from './sshTab.component'

function buildTab (transport: 'ssh'|'mosh') {
    const tab = new SSHTabComponent({} as any, {} as any, {} as any, {} as any, {} as any)
    tab.profile = { options: { transport } } as any
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

test('initializeSession retries without multiplex when first attempt fails', async () => {
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
