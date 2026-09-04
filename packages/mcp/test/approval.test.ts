import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decisionFor,
  setDecision,
  clearDecision,
  pendingOf,
  setPending,
  clearPending,
  askForApproval,
} from '../src/approval.js'
import { mountAndNotify } from '../src/approval.js'
import type { MountedServer } from '../src/mount.js'

type Ctx = Parameters<typeof askForApproval>[0]
type Agt = Parameters<typeof askForApproval>[1]

test('decisionFor/setDecision/clearDecision 状态机', () => {
  setDecision('a1', 'pending')
  assert.equal(decisionFor('a1'), 'pending')
  setDecision('a1', 'approved')
  assert.equal(decisionFor('a1'), 'approved')
  clearDecision('a1')
  assert.equal(decisionFor('a1'), undefined)
})

test('pendingOf/setPending/clearPending 状态机', () => {
  setPending('a1', { file: '/x/.mcp.json' })
  assert.deepEqual(pendingOf('a1'), { file: '/x/.mcp.json' })
  clearPending('a1')
  assert.equal(pendingOf('a1'), undefined)
})

test('askForApproval 无审批服务 fail-closed 返回 rejected', async () => {
  const ctx = { get: () => undefined } as unknown as Ctx
  const agent = { id: 'a1' } as unknown as Agt
  const d = await askForApproval(ctx, agent, '/x/.mcp.json', { postgres: {} })
  assert.equal(d, 'rejected')
})

test('askForApproval allowed-once 返回 approved', async () => {
  const ctx = { get: () => ({ request: async () => 'allowed-once' }) } as unknown as Ctx
  const agent = { id: 'a1' } as unknown as Agt
  const d = await askForApproval(ctx, agent, '/x/.mcp.json', { postgres: {} })
  assert.equal(d, 'approved')
})

test('askForApproval rejected 返回 rejected', async () => {
  const ctx = { get: () => ({ request: async () => 'rejected' }) } as unknown as Ctx
  const d = await askForApproval(ctx, { id: 'a1' } as unknown as Agt, '/x/.mcp.json', { postgres: {} })
  assert.equal(d, 'rejected')
})

test('askForApproval request 抛错返回 rejected', async () => {
  const ctx = { get: () => ({ request: async () => { throw new Error('boom') } }) } as unknown as Ctx
  const d = await askForApproval(ctx, { id: 'a1' } as unknown as Agt, '/x/.mcp.json', { postgres: {} })
  assert.equal(d, 'rejected')
})

test('mountAndNotify 挂载成功且会话空则注入', async () => {
  const calls: unknown[] = []
  const agent = {
    id: 'a1',
    ctx: {},
    session: { surface: { nodes: [] } },
    followup: (m: unknown): void => { calls.push(m) },
  } as unknown as Parameters<typeof mountAndNotify>[0]
  const work: MountedServer[] = [{ serverName: 'memory', rawName: 'memory', transport: 'stdio', file: '/x/.mcp.json', tools: ['t1'] }]
  await mountAndNotify(agent, '/x/.mcp.json', [], async () => work)
  assert.equal(calls.length, 1)
})

test('mountAndNotify 会话已有消息则不注入', async () => {
  const calls: unknown[] = []
  const agent = {
    id: 'a1',
    ctx: {},
    session: { surface: { nodes: [1] } },
    followup: (m: unknown): void => { calls.push(m) },
  } as unknown as Parameters<typeof mountAndNotify>[0]
  await mountAndNotify(agent, '/x/.mcp.json', [], async () => [{ serverName: 'memory', rawName: 'memory', transport: 'stdio', file: '/x/.mcp.json', tools: ['t1'] }])
  assert.equal(calls.length, 0)
})

test('mountAndNotify 挂载为空则不注入', async () => {
  const calls: unknown[] = []
  const agent = {
    id: 'a1',
    ctx: {},
    session: { surface: { nodes: [] } },
    followup: (m: unknown): void => { calls.push(m) },
  } as unknown as Parameters<typeof mountAndNotify>[0]
  await mountAndNotify(agent, '/x/.mcp.json', [], async () => [])
  assert.equal(calls.length, 0)
})
