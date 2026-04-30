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
