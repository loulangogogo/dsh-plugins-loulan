/**
 * @fileoverview 「MCP」标签页的运行时状态与控制面。
 *
 * 取代原 registry.ts：既保存各会话的挂载句柄（进程内，不写会话日志），也承载
 * 「刷新」（全局增量重挂 + 本会话重挂）与「添加」（上传 .mcp.json 内容挂到当前
 * 会话）两个动作。所有挂载句柄都留在内存，绝不把 env / headers 等配置外发。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { dirname } from 'node:path'
import { MAX_UPLOAD_BYTES, type McpLoadState, type McpMountedData, type McpMountGroup, type McpSkippedEntry } from './contract.js'
import type { MountedHandle, MountedServer } from './mount.js'
import { buildMountPayload, handlesToServers, mountFile, mountServers, settleMounts, toMountGroup } from './mount.js'
import { parseMcpServersText, readMcpServers } from './parse.js'
import { agentToken, mapServer } from './server-name.js'

/** 激活历史会话后，等待其挂载登记落地的默认上限（毫秒）：MCP 子进程冷启动通常在这个量级内。 */
const DEFAULT_ACTIVATE_WAIT_MS = 20_000

/** 等待登记的轮询间隔（毫秒）。 */
const RECORD_POLL_MS = 200

/** 浏览器上传的 .mcp.json 内容（保留原始文本供刷新时重挂）。 */
export interface UploadedFile {
  /** 浏览器给出的文件名（同时作为该手动分组的来源展示）。 */
  name: string
  /** 文件原始文本内容。 */
  content: string
}

/**
 * 全局增量重挂计划。
 *
 * 四类服务名互不重叠，且合起来覆盖新旧两份配置的全部服务名。
 */
export interface GlobalPlan {
  /** 配置未变，保留原 fiber。 */
  keep: string[]
  /** 新增，需新挂载。 */
  mount: string[]
  /** 配置变更，需先卸载旧 fiber 再挂载。 */
  remount: string[]
  /** 已从配置删除，需卸载。 */
  dispose: string[]
}

/**
 * 比较新旧全局配置指纹，得出增量重挂计划。
 *
 * @param current - 当前已挂载服务：服务名 → 配置指纹
 * @param next - 新配置解析结果：服务名 → 配置指纹
 * @returns 四类服务名清单（顺序：按 next 的键序，再按 current 的键序）
 */
export function planGlobalRefresh(
  current: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
): GlobalPlan {
  const keep: string[] = []
  const mount: string[] = []
  const remount: string[] = []
  const dispose: string[] = []
  for (const [name, key] of next) {
    const previous = current.get(name)
    if (previous === undefined) mount.push(name)
    else if (previous === key) keep.push(name)
    else remount.push(name)
  }
  for (const name of current.keys()) {
    if (!next.has(name)) dispose.push(name)
  }
  return { keep, mount, remount, dispose }
}

/** 控制面动作结果：成功携带新载荷，失败携带 HTTP 状态码与文案。 */
export type ActionResult =
  | { ok: true; data: McpMountedData }
  | { ok: false; code: number; message: string }

/** 「MCP」标签页运行时：会话状态 + 刷新/添加控制面。 */
export interface MountsRuntime {
  /**
   * 记录启动时已挂载的全局共享服务句柄。
   *
   * @param handles - mountFile 返回的全局句柄（已完成启动并含工具名）
   * @param skipped - 全局来源未挂载成功的服务及原因
   */
  seedGlobal(handles: MountedHandle[], skipped?: readonly McpSkippedEntry[]): void
  /**
   * 读取当前全局共享分组。
   *
   * @returns 全局分组的展示快照
   */
  globalGroup(): McpMountGroup
  /**
   * 标记/清除「该会话正在挂载」。
   *
   * 由 agent/created 的挂载流程调用：登记要等挂载结束才写入，此标记让读取路径能把
   * 「正在挂载」与「该会话未激活」区分开。
   *
   * @param sessionId - 会话 id
   * @param value - true 表示开始挂载，false 表示挂载已结束
   */
  setMounting(sessionId: string, value: boolean): void
  /**
   * 记录某会话的工作区挂载句柄。
   *
   * @param agent - 该会话的 agent（刷新时需要其 ctx 与工作区目录）
   * @param workspaceFile - 该会话工作区 .mcp.json 路径；无则 undefined
   * @param handles - 工作区挂载句柄
   * @param skipped - 工作区来源未挂载成功的服务及原因
   */
  track(agent: Agent, workspaceFile: string | undefined, handles: MountedHandle[], skipped?: readonly McpSkippedEntry[]): void
  /**
   * 清除某会话的全部记录（agent 销毁时；agent.ctx 卸载会自行释放 fiber）。
   *
   * @param sessionId - 会话 id
   */
  forget(sessionId: string): void
  /**
   * 读取某会话的三组挂载载荷与加载状态。
   *
   * @param sessionId - 会话 id；缺失为 null
   * @returns 三组载荷与 state；未跟踪的会话只带全局分组（state 为 inactive 或 mounting）
   */
  read(sessionId: string | null): McpMountedData
  /**
   * 同步全局 .mcp.json 的磁盘现状：内容变更增量重挂，文件消失则卸载全部全局服务。
   *
   * 拉取清单（GET）与刷新都会调用；有会话正在运行时**静默跳过**，避免读路径打断
   * 运行中的会话；并发调用复用同一次同步，避免重复挂载/释放同一批 fiber。
   *
   * @returns 同步完成的 Promise；失败时 reject，由调用方决定是否影响本次响应
   */
  syncGlobal(): Promise<void>
  /**
   * 是否有任何会话正在运行。
   *
   * @returns true 表示存在 agent.status === 'running' 的会话
   */
  isBusy(): boolean
  /**
   * 刷新：全局增量重挂 + 本会话（工作区 + 手动）重挂。
   *
   * 本会话在当前进程里没有存活 agent 时（历史会话、agent 已释放、插件重载后记录丢失），
   * 先尝试经注入的 `activate` 激活该会话，再等其自行挂载登记（上限见 `activateWaitMs`）；
   * 激活失败或超时则与读取路径一致地降级为「只同步全局」。同一会话的并发刷新复用同一次
   * 执行，避免重挂出同名 mcp-client 实例。
   *
   * @param sessionId - 会话 id；缺失为 null
   * @returns 成功时携带新载荷；空闲保护触发时为 409，缺少会话标识为 400
   */
  refresh(sessionId: string | null): Promise<ActionResult>
  /**
   * 添加：校验上传内容并挂载到当前会话。
   *
   * @param sessionId - 会话 id；缺失为 null
   * @param name - 上传文件名
   * @param content - 上传文件文本内容
   * @returns 成功时携带新载荷；校验失败为 400，空闲保护触发时为 409
   */
  addUpload(sessionId: string | null, name: unknown, content: unknown): Promise<ActionResult>
  /**
   * 卸载某会话的一个来源分组。
   *
   * 语义（已与用户确认）：
   * - `global` 一律拒绝（400）——全局共享服务只能靠重启改变，且界面不给入口；
   * - `workspace` 为**临时停用**：释放句柄但保留来源，下一次刷新会重新读取并挂回；
   * - `manual` 会**连同保留的上传内容一起丢弃**，刷新不会带回。
   *
   * @param sessionId - 会话 id；缺失为 null
   * @param group - 目标分组；仅 workspace / manual 合法
   * @returns 成功时携带新载荷；目标不合法或会话未跟踪为 400，空闲保护为 409
   */
  unload(sessionId: string | null, group: unknown): Promise<ActionResult>
}

/** 单个会话的挂载状态。 */
interface SessionRecord {
  /** 该会话的 agent（其 ctx 是工作区/手动挂载的宿主）。 */
  agent: Agent
  /** 工作区 .mcp.json 路径；无则 undefined。 */
  workspaceFile: string | undefined
  /** 当前工作区挂载句柄。 */
  workspaceHandles: MountedHandle[]
  /** 工作区来源未挂载成功的服务及原因（展示用）。 */
  workspaceSkipped: McpSkippedEntry[]
  /** 已上传的文件（保留内容供刷新重挂）。 */
  uploads: UploadedFile[]
  /** 当前手动挂载句柄。 */
  uploadHandles: MountedHandle[]
  /** 手动来源未挂载成功的服务及原因（展示用）。 */
  uploadSkipped: McpSkippedEntry[]
}

/**
 * 创建一个进程内运行时。
 *
 * @param options - 依赖注入：插件上下文、全局 .mcp.json 解析函数、可替换的挂载实现
 * @returns 运行时实例
 */
export function createMountsRuntime(options: {
  /** 插件上下文（全局挂载与会话挂载的宿主）。 */
  ctx: Context
  /** 解析当前全局 .mcp.json 路径；不存在返回 undefined。 */
  resolveGlobalFile: () => string | undefined
  /**
   * 列出当前存活的 agent（空闲保护用）。
   *
   * 必须由调用方经**可选注入**提供：本插件未声明 `agents` 服务，直接读
   * `ctx.agents` 会被 cordis 拒绝（`cannot get property "agents" without inject`）。
   * 缺省视为「没有会话在运行」。
   */
  listAgents?: () => readonly { readonly status: string }[]
  /**
   * 刷新时激活（解析或恢复）历史会话：返回是否已激活。
   *
   * 由插件经 `ctx.get('sessionController')` 注入；缺省视为不具备该能力，
   * 此时未登记会话的刷新只同步全局配置。
   */
  activate?: (sessionId: string) => Promise<boolean>
  /**
   * 激活后等待该会话登记落地的上限（毫秒）。
   *
   * agent/created 会自行挂载并登记，挂载含 MCP 子进程冷启动，故默认给足时间；
   * 仅测试需要缩短。
   */
  activateWaitMs?: number
  /** 挂载实现（默认 mountFile），测试可注入桩。 */
  mount?: (
    ctx: Context,
    file: string,
    suffix?: string,
    exclude?: ReadonlySet<string>,
    skipped?: McpSkippedEntry[],
  ) => Promise<MountedHandle[]>
}): MountsRuntime {
  const mount = options.mount ?? mountFile
  const listAgents = options.listAgents ?? ((): readonly { readonly status: string }[] => [])
  const sessions = new Map<string, SessionRecord>()
  /** 当前全局挂载：服务名 → 句柄。 */
  const globalHandles = new Map<string, MountedHandle>()
  /** 进行中的全局同步：并发调用复用同一 Promise，避免重复动同一批 fiber。 */
  let globalSync: Promise<void> | null = null
  /**
   * 进行中的本会话刷新：同一会话的并发刷新复用同一次。
   *
   * 刷新会「先释放再重挂」本会话的服务，同一会话并发执行会重挂出同名 mcp-client
   * 实例（serverName 冲突）；页面多标签、重复点击都可触发，故按会话去重。
   */
  const sessionRefreshes = new Map<string, Promise<ActionResult>>()
  /** 正在挂载的会话：read 用它把「挂载中」与「未激活」区分开。 */
  const mounting = new Set<string>()
  /** 当前全局来源未挂载成功的服务及原因（展示用）。 */
  let globalSkipped: McpSkippedEntry[] = []

  /** 取当前全局服务明细。 */
  const globalServers = (): MountedServer[] => handlesToServers([...globalHandles.values()])

  /** 是否有任何会话正在运行（刷新/添加的空闲保护）。 */
  const isBusy = (): boolean => listAgents().some(agent => agent.status === 'running')

  /** 只带全局分组的载荷（未登记/挂载中会话的降级形态）。 */
  const globalOnlyPayload = (state: McpLoadState): McpMountedData =>
    buildMountPayload(globalServers(), [], [], { state, globalSkipped })

  /** 由三组明细组装载荷。 */
  const payloadOf = (record: SessionRecord): McpMountedData =>
    buildMountPayload(globalServers(), handlesToServers(record.workspaceHandles), handlesToServers(record.uploadHandles), {
      state: 'loaded',
      globalSkipped,
      workSkipped: record.workspaceSkipped,
      manualSkipped: record.uploadSkipped,
    })

  /** 某会话工作区目录（手动挂载 stdio 的默认 cwd）。 */
  const projectDirOf = (record: SessionRecord): string => record.agent.session.header.cwd ?? process.cwd()

  /** 手动挂载的 serverName 后缀：工作区后缀再加 "u"，避免与工作区同名服务冲突。 */
  const manualSuffix = (sessionId: string): string => `${agentToken(sessionId)}u`

  /**
   * 逐个释放一组句柄：记录每个失败项并返回释放失败的 serverName 集合。
   *
   * 释放失败意味着旧 fiber 仍存活且同名服务无法安全重挂，故失败者本轮不再挂载。
   *
   * @param handles - 待释放的挂载句柄
   * @returns 释放失败的 serverName 集合
   */
  const disposeHandles = async (handles: readonly MountedHandle[]): Promise<Set<string>> => {
    const failed = new Set<string>()
    for (const handle of handles) {
      try {
        await handle.fiber.dispose()
      } catch (error) {
        console.error(`[dsh-loulan-mcp] 释放 MCP server "${handle.mounted.serverName}" 失败:`, error)
        failed.add(handle.mounted.serverName)
      }
    }
    return failed
  }

  /** 释放失败时记录一条告警（这些名字本轮不再重挂）。 */
  const warnDisposeFailures = (failed: ReadonlySet<string>): void => {
    if (failed.size === 0) return
    console.warn(`[dsh-loulan-mcp] 以下 MCP server 释放失败，本轮跳过重挂: ${[...failed].join(', ')}`)
  }

  /**
   * 全局增量重挂：仅对新增/变更/删除的服务动 fiber，未变的原样保留。
   *
   * 文件不存在视为配置清空：卸载全部现存全局挂载（文件重新出现时按新内容挂回）。
   * 解析失败仍保守处理（保留现存挂载并告警），避免编辑中的半截文件把服务清空。
   */
  const refreshGlobal = async (): Promise<void> => {
    const file = options.resolveGlobalFile()
    if (file === undefined) {
      // 本来就没有全局挂载时不告警，避免每次拉取清单都刷屏。
      if (globalHandles.size === 0) return
      const stale = [...globalHandles.values()]
      const failedDispose = await disposeHandles(stale)
      warnDisposeFailures(failedDispose)
      console.warn(`[dsh-loulan-mcp] 全局 .mcp.json 已不存在，卸载 ${stale.length} 个全局 MCP server`)
      // 释放成功的从表中移除；释放失败的保留（旧 fiber 仍存活且句柄不能丢），供后续刷新重试。
      for (const handle of stale) {
        if (!failedDispose.has(handle.mounted.serverName)) globalHandles.delete(handle.mounted.serverName)
      }
      globalSkipped = []
      return
    }
    let servers: Record<string, unknown>
    try {
      servers = await readMcpServers(file)
    } catch (error) {
      console.error(`[dsh-loulan-mcp] 解析 ${file} 失败，保留现有全局挂载:`, error)
      return
    }

    // 先只映射（不挂载）算出各服务的新配置指纹，据此得出增量计划。
    const projectDir = dirname(file)
    const nextKeys = new Map<string, string>()
    const skipped: McpSkippedEntry[] = []
    for (const [serverName, raw] of Object.entries(servers)) {
      const mapped = mapServer(serverName, raw, projectDir)
      if (!mapped.ok) {
        console.warn(`[dsh-loulan-mcp] ${mapped.reason}`)
        skipped.push({ name: serverName, reason: mapped.reason })
        continue
      }
      nextKeys.set(mapped.config.serverName, JSON.stringify(mapped.config))
    }
    const currentKeys = new Map<string, string>()
    for (const [name, handle] of globalHandles) currentKeys.set(name, handle.configKey)
    const plan = planGlobalRefresh(currentKeys, nextKeys)

    // 先卸载（含变更项的旧 fiber），再挂载新增与变更项。
    const staleNames = [...plan.dispose, ...plan.remount]
    const stale = staleNames
      .map(name => globalHandles.get(name))
      .filter((handle): handle is MountedHandle => handle !== undefined)
    const failedDispose = await disposeHandles(stale)
    warnDisposeFailures(failedDispose)
    // 释放成功的名字从表中移除；释放失败的保留（旧 fiber 仍存活且句柄不能丢），
    // 以便后续刷新再次尝试释放，同时本轮不重挂同名服务。
    for (const name of staleNames) {
      if (!failedDispose.has(name)) globalHandles.delete(name)
    }

    const freshNames = [...plan.mount, ...plan.remount].filter(name => !failedDispose.has(name))
    if (freshNames.length > 0) {
      const subset: Record<string, unknown> = {}
      for (const name of freshNames) subset[name] = servers[name]
      const fresh = await settleMounts(options.ctx, mountServers(options.ctx, subset, file, projectDir), skipped)
      for (const handle of fresh) globalHandles.set(handle.mounted.serverName, handle)
    }
    globalSkipped = skipped
  }

  /**
   * 挂载该会话的全部已上传文件，返回新句柄。
   *
   * @param record - 会话记录
   * @param exclude - 需跳过的挂载名集合（上一次 dispose 失败的名字）
   * @returns 新挂载的句柄
   */
  const mountUploads = async (
    record: SessionRecord,
    exclude?: ReadonlySet<string>,
    skipped: McpSkippedEntry[] = [],
  ): Promise<MountedHandle[]> => {
    const projectDir = projectDirOf(record)
    const suffix = manualSuffix(record.agent.id)
    const handles: MountedHandle[] = []
    for (const upload of record.uploads) {
      const servers = parseMcpServersText(upload.content)
      handles.push(...await settleMounts(
        record.agent.ctx,
        mountServers(record.agent.ctx, servers, upload.name, projectDir, suffix, exclude, skipped),
        skipped,
      ))
    }
    return handles
  }

  /** 本会话重挂：卸载并重挂工作区与手动添加的句柄，只影响本会话。 */
  const refreshSession = async (record: SessionRecord): Promise<void> => {
    const failedDispose = await disposeHandles([...record.workspaceHandles, ...record.uploadHandles])
    warnDisposeFailures(failedDispose)
    // 释放失败的句柄保留在记录中（旧 fiber 仍存活），供后续刷新重试释放。
    const keptWork = record.workspaceHandles.filter(handle => failedDispose.has(handle.mounted.serverName))
    const keptUploads = record.uploadHandles.filter(handle => failedDispose.has(handle.mounted.serverName))
    record.workspaceHandles = keptWork
    record.uploadHandles = keptUploads
    const workSkipped: McpSkippedEntry[] = []
    if (record.workspaceFile !== undefined) {
      const fresh = await mount(record.agent.ctx, record.workspaceFile, agentToken(record.agent.id), failedDispose, workSkipped)
      record.workspaceHandles = [...keptWork, ...fresh]
    }
    record.workspaceSkipped = workSkipped
    const uploadSkipped: McpSkippedEntry[] = []
    record.uploadHandles = [...keptUploads, ...await mountUploads(record, failedDispose, uploadSkipped)]
    record.uploadSkipped = uploadSkipped
  }

  /**
   * 同步全局配置：忙时静默跳过，并发调用复用同一次同步。
   *
   * @returns 同步完成的 Promise；失败时 reject，由调用方决定是否影响本次响应
   */
  const syncGlobal = (): Promise<void> => {
    // 忙时静默跳过：拉取清单是读路径，不得打断运行中的会话。
    if (isBusy()) return Promise.resolve()
    // 并发（页面重载、多标签页、React 双订阅）复用同一次同步；结束后归零以便下次重新判断。
    globalSync ??= refreshGlobal().finally(() => { globalSync = null })
    return globalSync
  }

  /**
   * 等待该会话登记落地。
   *
   * 激活历史会话后，挂载与登记由 agent/created 异步完成（含 MCP 子进程冷启动），
   * 这里只观察登记结果，不参与挂载。
   *
   * @param sessionId - 会话 id
   * @returns 记录；超过等待上限仍未登记时为 undefined
   */
  const waitForRecord = async (sessionId: string): Promise<SessionRecord | undefined> => {
    const deadline = Date.now() + (options.activateWaitMs ?? DEFAULT_ACTIVATE_WAIT_MS)
    for (;;) {
      const record = sessions.get(sessionId)
      if (record !== undefined) return record
      if (Date.now() >= deadline) return undefined
      await new Promise(resolve => setTimeout(resolve, RECORD_POLL_MS))
    }
  }

  /**
   * 单会话刷新：已登记的重新挂载；未登记的先激活会话，等其自行挂载登记。
   *
   * @param sessionId - 会话 id（非空）
   * @returns 刷新结果
   */
  const runRefresh = async (sessionId: string): Promise<ActionResult> => {
    const known = sessions.get(sessionId)
    if (known !== undefined) {
      if (isBusy()) return { ok: false, code: 409, message: '有会话正在运行，请稍后再刷新' }
      // 走到这里必然不忙，故 syncGlobal 必定真正执行（同时复用其并发去重）。
      await syncGlobal()
      await refreshSession(known)
      return { ok: true, data: payloadOf(known) }
    }
    // 未登记：该会话在当前进程里没有存活 agent（历史会话、agent 已释放、插件重载后未激活）。
    // 先尝试激活它；激活会触发 agent/created，挂载与登记由监听器完成，这里只等结果——
    // 绝不自行补挂载，否则会与飞行中的挂载撞出同名 mcp-client 实例（serverName 已占用）。
    let activated = false
    try {
      activated = await options.activate?.(sessionId) ?? false
    } catch (error) {
      console.warn(`[dsh-loulan-mcp] 激活会话 ${sessionId} 失败，本轮只同步全局配置:`, error)
    }
    const record = activated ? await waitForRecord(sessionId) : undefined
    if (record !== undefined) {
      await syncGlobal()
      return { ok: true, data: payloadOf(record) }
    }
    // 激活失败、或在等待上限内仍未登记：与读路径一致地降级为「只有全局共享」，
    // 不报「会话未加载 MCP 服务」。syncGlobal 忙时自行静默跳过，故此处不给 409。
    await syncGlobal()
    return { ok: true, data: globalOnlyPayload(mounting.has(sessionId) ? 'mounting' : 'inactive') }
  }

  return {
    seedGlobal: (handles, skipped = []) => {
      for (const handle of handles) globalHandles.set(handle.mounted.serverName, handle)
      globalSkipped = [...skipped]
    },
    globalGroup: () => toMountGroup(globalServers(), globalSkipped),
    setMounting: (sessionId, value) => {
      if (value) mounting.add(sessionId)
      else mounting.delete(sessionId)
    },
    track: (agent, workspaceFile, handles, skipped = []) => {
      sessions.set(agent.id, {
        agent,
        workspaceFile,
        workspaceHandles: handles,
        workspaceSkipped: [...skipped],
        uploads: [],
        uploadHandles: [],
        uploadSkipped: [],
      })
    },
    forget: (sessionId) => {
      sessions.delete(sessionId)
    },
    read: (sessionId) => {
      const record = sessionId === null ? undefined : sessions.get(sessionId)
      if (record !== undefined) return payloadOf(record)
      return globalOnlyPayload(sessionId !== null && mounting.has(sessionId) ? 'mounting' : 'inactive')
    },
    isBusy,
    syncGlobal,
    refresh: async (sessionId) => {
      // 缺少会话标识属于请求本身不合法（客户端未带上会话），保持 400，不降级掩盖。
      if (sessionId === null || sessionId.length === 0) {
        return { ok: false, code: 400, message: '会话未加载 MCP 服务，无法刷新' }
      }
      const pending = sessionRefreshes.get(sessionId)
      if (pending !== undefined) return await pending
      const task = runRefresh(sessionId).finally(() => { sessionRefreshes.delete(sessionId) })
      sessionRefreshes.set(sessionId, task)
      return await task
    },
    addUpload: async (sessionId, name, content) => {
      const record = sessionId === null || sessionId.length === 0 ? undefined : sessions.get(sessionId)
      if (record === undefined) return { ok: false, code: 400, message: '会话未加载 MCP 服务，无法添加' }
      // 空闲保护优先于内容校验：忙时一律 409，不因文件非法改判 400。
      if (isBusy()) return { ok: false, code: 409, message: '有会话正在运行，请稍后再添加' }
      if (typeof name !== 'string' || name.length === 0) {
        return { ok: false, code: 400, message: '文件名不能为空' }
      }
      if (typeof content !== 'string') return { ok: false, code: 400, message: '文件内容必须是字符串' }
      if (Buffer.byteLength(content, 'utf8') > MAX_UPLOAD_BYTES) {
        return { ok: false, code: 400, message: `文件过大（上限 ${MAX_UPLOAD_BYTES} 字节）` }
      }
      let servers: Record<string, unknown>
      try {
        servers = parseMcpServersText(content)
      } catch {
        return { ok: false, code: 400, message: '文件不是合法 JSON' }
      }
      if (Object.keys(servers).length === 0) {
        return { ok: false, code: 400, message: '文件中没有 mcpServers' }
      }
      const skipped: McpSkippedEntry[] = []
      const handles = await settleMounts(
        record.agent.ctx,
        mountServers(record.agent.ctx, servers, name, projectDirOf(record), manualSuffix(record.agent.id), undefined, skipped),
        skipped,
      )
      record.uploads.push({ name, content })
      record.uploadHandles.push(...handles)
      // 只替换本次文件里出现的名字，避免后续添加把先前文件的未挂载原因挤掉。
      const names = new Set(Object.keys(servers))
      record.uploadSkipped = [...record.uploadSkipped.filter(item => !names.has(item.name)), ...skipped]
      return { ok: true, data: payloadOf(record) }
    },
    unload: async (sessionId, group) => {
      const record = sessionId === null || sessionId.length === 0 ? undefined : sessions.get(sessionId)
      if (record === undefined) return { ok: false, code: 400, message: '会话未加载 MCP 服务，无法卸载' }
      // 目标合法性先于空闲保护：全局共享永远是 400，不会被暂时的 409 掩盖。
      if (group === 'global') return { ok: false, code: 400, message: '全局共享服务不可卸载' }
      if (group !== 'workspace' && group !== 'manual') {
        return { ok: false, code: 400, message: '未知的卸载目标' }
      }
      if (isBusy()) return { ok: false, code: 409, message: '有会话正在运行，请稍后再卸载' }

      if (group === 'workspace') {
        // 临时停用：只释放句柄，保留 workspaceFile，刷新会重新读取并挂回。
        const failed = await disposeHandles(record.workspaceHandles)
        warnDisposeFailures(failed)
        record.workspaceHandles = record.workspaceHandles.filter(
          handle => failed.has(handle.mounted.serverName),
        )
      } else {
        // 手动添加：连保留的上传内容一起丢弃，刷新不会带回。
        const failed = await disposeHandles(record.uploadHandles)
        warnDisposeFailures(failed)
        record.uploadHandles = record.uploadHandles.filter(
          handle => failed.has(handle.mounted.serverName),
        )
        record.uploads = []
      }
      return { ok: true, data: payloadOf(record) }
    },
  }
}
