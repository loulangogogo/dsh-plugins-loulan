/**
 * @fileoverview index.ts 的单元测试：pre-step 注入时机、位置与去重。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { apply, name } from '../src/index.js'

/** pre-step 处理器签名（测试用简化版）。 */
type Handler = (payload: never, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>

/** 用一个假 Context 挂载插件，返回注册好的 pre-step 处理器。 */
function mount(config: { dshHome: string }): Handler {
  const handlers = new Map<string, Handler>()
  const ctx = {
    on: (event: string, handler: Handler) => { handlers.set(event, handler) },
  } as unknown as Context
  apply(ctx, config)
  const handler = handlers.get('agent/pre-step')
  assert.ok(handler, 'apply 必须注册 agent/pre-step')
  return handler
}

/** 构造只暴露 session.header.cwd 与 deriveMessages 的 agent 桩。 */
function stubAgent(cwd: string, visible: UserMessage[]): Agent {
  return {
    session: {
      header: { cwd },
      deriveMessages: () => visible,
    },
  } as unknown as Agent
}

/** 组装测试用 pre-step 载荷。 */
function payload(agent: Agent, messages: UserMessage[], step: number): never {
  return { agent, messages, step, signal: new AbortController().signal } as never
}

/** 取出消息里全部文本块拼接结果。 */
function textOf(message: UserMessage): string {
  return message.content.map(block => (block.type === 'text' ? block.text : '')).join('')
}

test('首次 pre-step 把规则注入到 claimed 消息之后', async () => {
  const project = mkdtempSync(join(tmpdir(), 'dsh-rules-proj-'))
  const home = mkdtempSync(join(tmpdir(), 'dsh-rules-home-'))
  try {
    mkdirSync(join(project, '.dsh', 'rules'), { recursive: true })
    writeFileSync(join(project, '.dsh', 'rules', 'team.md'), '提交前必须跑测试')
    const handler = mount({ dshHome: home })

    const prompt = createUserMessage({ content: [{ type: 'text', text: '帮我改代码' }], source: { kind: 'user' } })
    const decision = await handler(
      payload(stubAgent(project, []), [prompt], 1),
      async () => ({ kind: 'enter', messages: [prompt] }),
    )

    assert.equal(decision.kind, 'enter')
    if (decision.kind !== 'enter') return
    assert.equal(decision.messages.length, 2)
    assert.equal(decision.messages[0], prompt)
    assert.deepEqual(decision.messages[1]?.source, { kind: 'plugin', plugin: name, form: 'instructions' })
    assert.ok(textOf(decision.messages[1]!).includes('提交前必须跑测试'))
  } finally {
    rmSync(project, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

test('可见历史已有规则消息时不重复注入', async () => {
  const project = mkdtempSync(join(tmpdir(), 'dsh-rules-proj-'))
  const home = mkdtempSync(join(tmpdir(), 'dsh-rules-home-'))
  try {
    mkdirSync(join(project, '.dsh', 'rules'), { recursive: true })
    writeFileSync(join(project, '.dsh', 'rules', 'team.md'), '只注入一次')
    const handler = mount({ dshHome: home })

    const prompt = createUserMessage({ content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } })
    const existing = createUserMessage({ content: [{ type: 'text', text: '旧规则' }], source: { kind: 'plugin', plugin: name, form: 'instructions' } })
    const decision = await handler(
      payload(stubAgent(project, [existing]), [prompt], 2),
      async () => ({ kind: 'enter', messages: [prompt] }),
    )
    assert.equal(decision.kind, 'enter')
    if (decision.kind !== 'enter') return
    assert.deepEqual(decision.messages, [prompt])
  } finally {
    rmSync(project, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

test('规则目录不存在时不注入', async () => {
  const project = mkdtempSync(join(tmpdir(), 'dsh-rules-proj-'))
  const home = mkdtempSync(join(tmpdir(), 'dsh-rules-home-'))
  try {
    const handler = mount({ dshHome: home })
    const prompt = createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })
    const decision = await handler(
      payload(stubAgent(project, []), [prompt], 1),
      async () => ({ kind: 'enter', messages: [prompt] }),
    )
    assert.deepEqual(decision, { kind: 'enter', messages: [prompt] })
  } finally {
    rmSync(project, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})
