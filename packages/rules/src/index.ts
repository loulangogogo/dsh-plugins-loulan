/**
 * @fileoverview rules 插件入口。
 *
 * 在会话第一次进入的 `agent/pre-step`，读取全局 `$DSH_HOME/rules` 与项目
 * `<cwd>/.dsh/rules` 下的所有规则文件，组合成一条 user 角色的
 * `<system-reminder>`，折入本次请求的消息批次（紧随用户直接输入之后）。
 * 规则随历史持久保留，因此后续每次请求都会携带；恢复会话时若历史中已有本
 * 插件的规则消息则不再重复注入。
 *
 * @module dsh-loulan-rules
 */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type Message } from '@deepseek-ai/dsh-llm'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { globalDisplayDir, resolveConfig, type RulesConfig } from './config.js'
import { loadRules, type RuleDirRef } from './load.js'
import { renderRules } from './render.js'

export type { RulesConfig } from './config.js'

/** 插件名，须与 cordis.yml 中的 id 对应。 */
export const name = 'rules'

/** 一条消息是否来自本插件。 */
function isRulesMessage(message: Message): boolean {
  const source = message.source
  return source.kind === 'plugin' && source.plugin === name
}

/** 可见历史或本轮已领取消息里是否已有本插件的规则上下文。 */
function hasRulesContext(agent: Agent, claimed: readonly Message[]): boolean {
  if (claimed.some(isRulesMessage)) return true
  return agent.session.deriveMessages().some(isRulesMessage)
}

/** 计算全局与项目规则目录。 */
function rulesDirs(config: ReturnType<typeof resolveConfig>, cwd: string): RuleDirRef[] {
  return [
    { absoluteDir: join(config.dshHome, 'rules'), displayDir: globalDisplayDir(config.dshHome) },
    { absoluteDir: join(cwd, '.dsh', 'rules'), displayDir: '.dsh/rules' },
  ]
}

/**
 * 注册规则注入钩子。
 *
 * @param ctx - 插件上下文。
 * @param config - 可选配置（dshHome / maxBytes / maxSourceBytes）。
 */
export function apply(ctx: Context, config: RulesConfig = {}): void {
  const resolved = resolveConfig(config)
  ctx.on('agent/pre-step', async ({ agent, messages, step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    if (!(resolved.maxBytes > 0) || !Number.isFinite(resolved.maxBytes)) return decision
    // 空的首批进入不会发起请求，没有可附着的步骤，保持原样。
    if (step === 1 && decision.messages.length === 0) return decision
    if (hasRulesContext(agent, decision.messages)) return decision

    const cwd = agent.session.header.cwd ?? process.cwd()
    const loaded = await loadRules(rulesDirs(resolved, cwd), {
      maxBytes: resolved.maxBytes,
      maxSourceBytes: resolved.maxSourceBytes,
      signal,
    })
    if (loaded.files.length === 0) return decision
    const text = renderRules(loaded.files, loaded.omitted)
    if (text.length === 0) return decision

    const context = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: name, form: 'instructions' },
    })
    // 折在已领取批次之后：用户直接输入在前，驱动追加的运行时上下文在后。
    let insertAt = decision.messages.length
    for (let index = decision.messages.length - 1; index >= 0; index -= 1) {
      if (messages.includes(decision.messages[index]!)) {
        insertAt = index + 1
        break
      }
    }
    return {
      ...decision,
      messages: [...decision.messages.slice(0, insertAt), context, ...decision.messages.slice(insertAt)],
    }
  })
}
