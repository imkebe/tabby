import test from 'node:test'
import assert from 'node:assert/strict'
import { SSHProfilesService } from './profiles'

function createService (): SSHProfilesService {
    const passwordStorage = { deletePassword: () => undefined } as any
    const translate = { instant: (x: string) => x } as any
    const injector = { get: () => [] } as any
    return new SSHProfilesService(passwordStorage, translate, injector)
}

test('SSHProfilesService defaults include SSH transport and Mosh defaults', () => {
    const service = createService()
    assert.equal(service.configDefaults.options.transport, 'ssh')
    assert.deepEqual(service.configDefaults.options.mosh, {
        serverCommand: 'mosh-server',
        port: null,
        portRange: null,
        predict: 'adaptive',
        escapeKey: 'Ctrl+^',
        fallbackToSSH: true,
    })
})

test('config merge keeps Mosh defaults for missing legacy fields', () => {
    const service = createService()
    const migrated = {
        ...service.configDefaults.options,
        ...{
            transport: 'mosh',
            mosh: {
                serverCommand: 'custom-mosh-server',
            },
        },
    }

    const mergedMosh = {
        ...service.configDefaults.options.mosh,
        ...migrated.mosh,
    }

    assert.equal(migrated.transport, 'mosh')
    assert.deepEqual(mergedMosh, {
        serverCommand: 'custom-mosh-server',
        port: null,
        portRange: null,
        predict: 'adaptive',
        escapeKey: 'Ctrl+^',
        fallbackToSSH: true,
    })
})
