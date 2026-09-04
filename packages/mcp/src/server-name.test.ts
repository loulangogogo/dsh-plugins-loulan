import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentToken, suffixedServerName, SERVER_NAME_PATTERN } from './server-name.js'

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
