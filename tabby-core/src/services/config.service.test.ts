import test from 'node:test'
import assert from 'node:assert/strict'
import { ConfigService, ensureSSHTransportDefaults } from './config.service'

function migrateConfig (config): void {
    const migrate = (ConfigService.prototype as any).migrate as (config: any) => void
    migrate(config)
}

test('migrates legacy SSH profile defaults to include transport and full mosh defaults', () => {
    const config = {
        version: 8,
        profileDefaults: {
            ssh: {
                options: {
                    host: 'legacy.example.com',
                    mosh: {
                        serverCommand: 'legacy-mosh-server',
                    },
                },
            },
        },
    }

    migrateConfig(config)

    assert.equal(config.version, 9)
    assert.equal(config.profileDefaults.ssh.options.transport, 'ssh')
    assert.equal(config.profileDefaults.ssh.options.host, 'legacy.example.com')
    assert.deepEqual(config.profileDefaults.ssh.options.mosh, {
        serverCommand: 'legacy-mosh-server',
        port: null,
        portRange: null,
        predict: 'adaptive',
        escapeKey: 'Ctrl+^',
        fallbackToSSH: true,
    })
})

test('migrates legacy SSH profiles and preserves unrelated options', () => {
    const config = {
        version: 8,
        profiles: [
            {
                id: 'ssh:legacy',
                type: 'ssh',
                options: {
                    host: 'profile.example.com',
                    port: 2222,
                    privateKeys: ['/tmp/key'],
                    jumpHost: 'ssh:gateway',
                    mosh: {
                        predict: 'always',
                    },
                },
            },
        ],
    }

    migrateConfig(config)

    assert.equal(config.version, 9)
    assert.equal(config.profiles[0].options.transport, 'ssh')
    assert.equal(config.profiles[0].options.host, 'profile.example.com')
    assert.equal(config.profiles[0].options.port, 2222)
    assert.deepEqual(config.profiles[0].options.privateKeys, ['/tmp/key'])
    assert.equal(config.profiles[0].options.jumpHost, 'ssh:gateway')
    assert.deepEqual(config.profiles[0].options.mosh, {
        serverCommand: 'mosh-server',
        port: null,
        portRange: null,
        predict: 'always',
        escapeKey: 'Ctrl+^',
        fallbackToSSH: true,
    })
})

test('ensureSSHTransportDefaults is a no-op for missing options', () => {
    assert.doesNotThrow(() => ensureSSHTransportDefaults(undefined))
    assert.doesNotThrow(() => ensureSSHTransportDefaults(null))
})
