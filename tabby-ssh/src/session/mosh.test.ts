import test from 'node:test'
import assert from 'node:assert/strict'
import { SSHMoshSession } from './mosh'

function parser () {
    return (SSHMoshSession.prototype as any).tryParseBootstrap.bind({})
}

test('parses standard mosh-server bootstrap output', () => {
    const parse = parser()
    const parsed = parse('MOSH CONNECT 60001 abcdef1234\nMOSH KEY key123\n')
    assert.deepEqual(parsed, {
        key: 'key123',
        port: 60001,
        session: 'abcdef1234',
    })
})

test('parses bootstrap output with ANSI noise and extra lines', () => {
    const parse = parser()
    const parsed = parse('\u001b[32mstarting\u001b[0m\nMOSH CONNECT 62000 sess-1\nnote\nMOSH KEY secret\n')
    assert.deepEqual(parsed, {
        key: 'secret',
        port: 62000,
        session: 'sess-1',
    })
})

test('returns null when CONNECT or KEY lines are missing', () => {
    const parse = parser()
    assert.equal(parse('MOSH KEY only-key\n'), null)
    assert.equal(parse('MOSH CONNECT 62000 sess-only\n'), null)
})

function buildBootstrapCommandFor (mosh: any) {
    return (SSHMoshSession.prototype as any).buildBootstrapCommand.call({
        profile: { options: { mosh } },
        resolvePortArguments: (SSHMoshSession.prototype as any).resolvePortArguments,
        commandSupportsPredictAndEscape: (SSHMoshSession.prototype as any).commandSupportsPredictAndEscape,
        escapeShellArg: (SSHMoshSession.prototype as any).escapeShellArg,
        normalizePortRange: (SSHMoshSession.prototype as any).normalizePortRange,
        emitServiceMessage: () => null,
    })
}

test('builds mosh-server bootstrap command with a fixed port', () => {
    const command = buildBootstrapCommandFor({
        serverCommand: 'mosh-server',
        port: 60001,
        portRange: null,
        predict: 'always',
        escapeKey: '~',
    })
    assert.equal(command, '\'mosh-server\' \'new\' \'-s\' \'-p\' \'60001\'')
})

test('builds command for mosh runtime with predict and escape options', () => {
    const command = buildBootstrapCommandFor({
        serverCommand: 'mosh --server=mosh-server',
        port: null,
        portRange: '60000-61000',
        predict: 'adaptive',
        escapeKey: '^Z',
    })
    assert.equal(command, '\'mosh --server=mosh-server\' \'new\' \'-s\' \'-p\' \'60000:61000\' \'--predict=adaptive\' \'--escape=^Z\'')
})

test('uses fixed port when both fixed port and range are set', () => {
    const messages: string[] = []
    const result = (SSHMoshSession.prototype as any).resolvePortArguments.call({
        emitServiceMessage: (message: string) => messages.push(message),
        normalizePortRange: (SSHMoshSession.prototype as any).normalizePortRange,
    }, { port: 60001, portRange: '60000:61000' })

    assert.deepEqual(result, ['-p', '60001'])
    assert.match(messages[0], /fixed port will be used/i)
})

test('rejects malformed port ranges', () => {
    const messages: string[] = []
    const result = (SSHMoshSession.prototype as any).resolvePortArguments.call({
        emitServiceMessage: (message: string) => messages.push(message),
        normalizePortRange: (SSHMoshSession.prototype as any).normalizePortRange,
    }, { port: null, portRange: '70000:60000' })

    assert.equal(result, null)
    assert.match(messages[0], /invalid port range/i)
})
