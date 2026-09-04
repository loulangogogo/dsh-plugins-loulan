import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentToken, suffixedServerName, mapServer, SERVER_NAME_PATTERN } from '../src/server-name.js'

test('agentToken 生成 12 位十六进制且对相同输入稳定', () => {
  const t = agentToken('agent-abc')
  assert.match(t, /^[0-9a-f]{12}$/)
  assert.equal(agentToken('agent-abc'), t)
})

test('suffixedServerName 保持在 32 位以内且符合字符集', () => {
  const name = suffixedServerName('postgres', 'abcdef123456')
  assert.ok(SERVER_NAME_PATTERN.test(name))
  assert.ok(name.length <= 32)
})

test('suffixedServerName 对超长 base 截断以容纳后缀', () => {
  const name = suffixedServerName('mcp-server-with-a-very-long-name-xyz', 'abcdef123456')
  assert.ok(SERVER_NAME_PATTERN.test(name))
  assert.equal(name.length, 32)
})

test('mapServer 有 command 映射为 stdio', () => {
  const r = mapServer('postgres', { command: 'uvx', args: ['x'] }, '/proj')
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.config.transport, 'stdio')
    assert.equal(r.config.serverName, 'postgres')
    assert.equal(r.config.command, 'uvx')
  }
})

test('mapServer 有 url 映射为 streamable-http', () => {
  const r = mapServer('api', { url: 'http://x' }, '/proj')
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.config.transport, 'streamable-http')
})

test('mapServer 带后缀时 serverName 唯一', () => {
  const r = mapServer('postgres', { command: 'uvx' }, '/proj', 'abcdef123456')
  assert.equal(r.ok, true)
  if (r.ok) assert.ok(r.config.serverName.endsWith('_abcdef123456'))
})

test('mapServer 无 command 无 url 返回失败', () => {
  const r = mapServer('x', {}, '/proj')
  assert.equal(r.ok, false)
})
