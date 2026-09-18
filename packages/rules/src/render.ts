/**
 * @fileoverview 规则渲染：把已读取的规则组合成一条 user 角色的
 * `<system-reminder>` 文本；指令内容里的闭合标签会被转义。
 */

/** 一份已读取的规则文件。 */
export interface RuleFile {
  /** 文件的绝对路径（用于读取与去重）。 */
  absolutePath: string
  /** 模型可见的路径（如 `~/.dsh/rules/a.md`、`.dsh/rules/b.md`）。 */
  displayPath: string
  /** 文件原文。 */
  content: string
}

const FRAME_OPEN = '<system-reminder>'
const FRAME_CLOSE = '</system-reminder>'

// 这个是中文提示词
/*const INTRO:string = '从现在开始，请将我接下来提供的内容视为本次对话的**持续性行为规则**。\n' +
    '这些规则不是针对当前问题的临时要求，而是适用于**本次对话后续所有消息和任务**的长期规则。\n' +
    '在后续对话中：\n' +
    '1. 必须始终遵守我接下来提供的规则。\n' +
    '2. 除非我明确要求修改、删除或停止某条规则，否则不得自行忽略、修改或降低规则的约束。\n' +
    '3. 每次处理我的请求时，都应先判断当前任务是否受到这些规则约束，并按照规则执行。\n' +
    '4. 如果我的后续请求与这些规则存在冲突，应优先遵守这些规则，并明确指出冲突所在。\n' +
    '5. 不要因为对话主题发生变化，就认为这些规则失效。\n' +
    '6. 如果规则中存在歧义，不要擅自猜测其含义；应指出歧义并在必要时向我询问。\n' +
    '7. 如果后续我补充新的规则，应将其与之前的规则一起执行；如果新规则与旧规则冲突，应明确指出冲突并等待我的确认。\n' +
    '8. 不要仅在回答中口头声明“已遵守规则”，而应直接将规则落实到实际行为中。\n' +
    '**下面开始是需要你持续遵守的规则：**\n\n'*/

// 这个是英文提示词
const INTRO:string = 'From this point forward, please treat the content I provide next as the **persistent behavioral rules for this conversation**.\n' +
    'These rules are not temporary requirements for the current request. They are **long-term rules that apply to all subsequent messages and tasks in this conversation**.\n' +
    'For all subsequent interactions:\n' +
    '1. You must consistently follow the rules I provide below.\n' +
    '2. Unless I explicitly ask you to modify, remove, or stop following a specific rule, you must not ignore, modify, weaken, or otherwise reduce its constraints on your own.\n' +
    '3. Before handling each request, determine whether the current task is subject to these rules and perform the task accordingly.\n' +
    '4. If a subsequent request conflicts with these rules, follow the rules and clearly identify the conflict.\n' +
    '5. Do not assume that these rules no longer apply simply because the topic of the conversation changes.\n' +
    '6. If any rule is ambiguous, do not make assumptions about its intended meaning. Point out the ambiguity and ask for clarification when necessary.\n' +
    '7. If I provide additional rules later, apply them together with the existing rules. If a new rule conflicts with an existing rule, clearly identify the conflict and wait for my confirmation.\n' +
    '8. Do not merely state that you are "following the rules." Instead, demonstrate compliance by applying the rules directly to your actual behavior and responses.\n' +
    '**The following content defines the rules you must continue to follow:**\n\n'

/** 转义正文里的闭合标签，防止仓库文本提前关闭插件控制的框架。 */
function escapeFrame(body: string): string {
  return body.replaceAll(FRAME_CLOSE, '<\\/system-reminder>')
}

/** 生成预算省略说明；没有省略时返回空串。 */
function omittedNotice(omitted: readonly string[]): string {
  return omitted.length === 0 ? '' : `（已省略超出预算或过大的规则文件：${omitted.join('、')}）`
}

/**
 * 把规则文件渲染成一条完整的 <system-reminder> 消息文本。
 *
 * @param files - 已读取的规则文件（调用方保证顺序为全局在前、项目在后）。
 * @param omitted - 因超预算或超大而省略的模型可见路径。
 * @returns 模型可见文本；没有文件时返回空串（调用方据此跳过注入）。
 */
export function renderRules(files: readonly RuleFile[], omitted: readonly string[] = []): string {
  if (files.length === 0) return ''
  const body = [
    INTRO,
    omittedNotice(omitted),
    ...files.map(file => `Rules from: ${file.displayPath}\n\n${file.content}`),
  ].filter(block => block.length > 0).join('\n\n')
  return [FRAME_OPEN, escapeFrame(body), FRAME_CLOSE].join('\n')
}
