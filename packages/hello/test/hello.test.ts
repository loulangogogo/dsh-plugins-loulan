/**
 * @fileoverview index.ts 的单元测试：注册的命令名与处理器返回值。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { apply, name } from '../src/index.js'

/** 命令注册表里被登记的一条命令（测试用最小结构）。 */
interface RegisteredCommand {
  /** 命令名（不带斜杠）。 */
  name: string
  /** 斜杠菜单展示的描述。 */
  description: string
  /** 命令处理器。 */
  handler: () => CommandResult
}

/**
 * 用一个只实现 commands.register 的假 Context 挂载插件。
 *
 * @returns 插件注册进命令注册表的全部条目。
 */
function mount(): RegisteredCommand[] {
  const registered: RegisteredCommand[] = []
  const ctx = {
    commands: {
      register: (command: RegisteredCommand) => { registered.push(command) },
    },
  } as unknown as Context
  apply(ctx)
  return registered
}

test('apply 注册 hello 命令，handler 返回「你好」', () => {
  const registered = mount()
  assert.equal(registered.length, 1)
  const command = registered[0]!
  assert.equal(command.name, 'hello')
  assert.equal(command.name, name)
  assert.deepEqual(command.handler(), { kind: 'success', text: '你好' })
})
