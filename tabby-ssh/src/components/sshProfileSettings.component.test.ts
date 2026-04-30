import test from 'node:test'
import assert from 'node:assert/strict'
import { SSHProfileSettingsComponent } from './sshProfileSettings.component'
import { SSHAlgorithmType } from '../api'

function buildComponent () {
    const c = new SSHProfileSettingsComponent({} as any, {} as any, {} as any, {} as any, {} as any)
    c.loginScriptsSettings = { save: () => undefined } as any
    c.algorithms = {
        [SSHAlgorithmType.HMAC]: {},
        [SSHAlgorithmType.KEX]: {},
        [SSHAlgorithmType.CIPHER]: {},
        [SSHAlgorithmType.SERVER_HOST_KEY]: {},
        [SSHAlgorithmType.COMPRESSION]: {},
    }
    return c
}

test('save() resets Mosh options and switches to SSH when mode is not mosh', () => {
    const c = buildComponent()
    c.connectionMode = 'direct'
    c.profile = {
        options: {
            transport: 'mosh',
            jumpHost: 'jump',
            proxyCommand: 'nc host 22',
            socksProxyHost: 'proxy',
            socksProxyPort: 1080,
            httpProxyHost: 'proxy',
            httpProxyPort: 3128,
            mosh: {
                serverCommand: 'custom-server',
                port: 60000,
                portRange: '60000:61000',
                predict: 'always',
                escapeKey: 'Ctrl+g',
                fallbackToSSH: false,
            },
            algorithms: c.algorithms as any,
            forwardedPorts: [],
        },
    } as any

    c.save()

    assert.equal(c.profile.options.transport, 'ssh')
    assert.deepEqual(c.profile.options.mosh, {
        serverCommand: 'mosh-server',
        port: null,
        portRange: null,
        predict: 'adaptive',
        escapeKey: 'Ctrl+g',
        fallbackToSSH: true,
    })
})

test('save() clears incompatible proxy/jump settings when mode is mosh', () => {
    const c = buildComponent()
    c.connectionMode = 'mosh'
    c.profile = {
        options: {
            transport: 'ssh',
            jumpHost: 'jump',
            proxyCommand: 'nc host 22',
            socksProxyHost: 'proxy',
            socksProxyPort: 1080,
            httpProxyHost: 'proxy',
            httpProxyPort: 3128,
            mosh: {
                serverCommand: 'mosh-server',
                port: null,
                portRange: null,
                predict: 'adaptive',
                escapeKey: 'Ctrl+^',
                fallbackToSSH: true,
            },
            algorithms: c.algorithms as any,
            forwardedPorts: [],
        },
    } as any

    c.save()

    assert.equal(c.profile.options.transport, 'mosh')
    assert.equal(c.profile.options.proxyCommand, null)
    assert.equal(c.profile.options.jumpHost, null)
    assert.equal(c.profile.options.socksProxyHost, null)
    assert.equal(c.profile.options.socksProxyPort, null)
    assert.equal(c.profile.options.httpProxyHost, null)
    assert.equal(c.profile.options.httpProxyPort, null)
})
