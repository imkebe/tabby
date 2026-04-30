import test from 'node:test'
import assert from 'node:assert/strict'
import { getSSHTransportCapabilities } from './capabilities'

function capabilitiesFor (transport: 'ssh'|'mosh') {
    return getSSHTransportCapabilities({ options: { transport } } as any)
}

test('SSH transport enables all helper capabilities', () => {
    assert.deepEqual(capabilitiesFor('ssh'), {
        sftp: true,
        winSCP: true,
        x11: true,
        portForwarding: true,
        sessionReuse: true,
    })
})

test('Mosh transport disables auxiliary SSH helper capabilities', () => {
    assert.deepEqual(capabilitiesFor('mosh'), {
        sftp: false,
        winSCP: false,
        x11: false,
        portForwarding: false,
        sessionReuse: false,
    })
})
