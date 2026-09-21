/**
 * @fileoverview 「MCP」视图的数据源与控制面：拉取端点、刷新、上传添加、卸载分组（不依赖 React）。
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {
  McpMountedData, McpMountGroup, McpServerEntry, UnloadableMountGroup,
} from '../contract.js'

/** 视图快照：端点返回的载荷；null 表示尚未取得。 */
export type McpSnapshot = McpMountedData | null

/** 控制面动作结果：ok 为 false 时 message 为可展示的失败原因（可能缺省）。 */
export interface MountControlResult {
  ok: boolean
  message?: string
}

/** 控制面依赖的端点调用（由 apply 注入，便于测试替换）。 */
export interface MountControlIo {
  /** 拉取某会话的挂载清单（GET /mounts）。 */
  fetchMounts: (sessionId: string) => Promise<unknown>
  /** 刷新（POST /refresh）。 */
  refresh: (sessionId: string) => Promise<unknown>
  /** 上传添加（POST /add）。 */
  add: (sessionId: string, name: string, content: string) => Promise<unknown>
  /** 卸载某个来源分组（POST /unload）；全局共享不在可卸载范围内。 */
  unload: (sessionId: string, group: UnloadableMountGroup) => Promise<unknown>
}

/** 某会话的数据源与控制动作。 */
export interface MountControl {
  /** 供视图订阅的快照源。 */
  source: ObservableSnapshot<McpSnapshot>
  /**
   * 刷新：成功后用响应更新快照并通知订阅者。
   *
   * @returns 成功为 { ok: true }；失败携带可展示的原因
   */
  refresh(): Promise<MountControlResult>
  /**
   * 上传一个 .mcp.json 并挂到当前会话。
   *
   * @param file - 浏览器给出的文件名与文本内容
   * @returns 成功为 { ok: true }；失败携带可展示的原因
   */
  addUpload(file: { name: string; content: string }): Promise<MountControlResult>
  /**
   * 卸载某个来源分组（本工作区为临时停用，刷新会挂回；手动添加会连内容一起清掉）。
   *
   * @param group - 目标分组：workspace 或 manual
   * @returns 成功为 { ok: true }；失败携带可展示的原因
   */
  unload(group: UnloadableMountGroup): Promise<MountControlResult>
}

/**
 * 把工具名列表格式化为一行文案。
 *
 * @param tools - 工具名数组
 * @param separator - 工具名之间的分隔符（已本地化）
 * @returns 以 separator 连接的文案；无工具时返回 null（由组件本地化）
 */
export function toolsText(tools: readonly string[], separator: string): string | null {
  return tools.length > 0 ? tools.join(separator) : null
}

/** 判断是否为普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 校验并归一化单个服务条目。 */
function normalizeServer(raw: unknown): McpServerEntry | null {
  if (!isRecord(raw)) return null
  const { name, transport, tools } = raw
  if (typeof name !== 'string') return null
  if (transport !== 'stdio' && transport !== 'streamable-http') return null
  if (!Array.isArray(tools) || tools.some(item => typeof item !== 'string')) return null
  return { name, transport, tools: tools as string[] }
}

/** 校验并归一化一个分组。 */
function normalizeGroup(raw: unknown): McpMountGroup | null {
  if (!isRecord(raw)) return null
  if (!Array.isArray(raw.servers)) return null
  const servers: McpServerEntry[] = []
  for (const item of raw.servers) {
    const server = normalizeServer(item)
    if (server === null) return null
    servers.push(server)
  }
  const file = raw.file
  return { ...(typeof file === 'string' ? { file } : {}), servers }
}

/**
 * 防御式归一化端点响应。
 *
 * 为兼容尚未改版的旧载荷，缺失的 manual 分组按空组处理。
 *
 * @param raw - 未知响应体
 * @returns 合法载荷；畸形时返回 null（视图显示空态）
 */
export function normalizeMounts(raw: unknown): McpSnapshot {
  if (!isRecord(raw)) return null
  const global = normalizeGroup(raw.global)
  const workspace = normalizeGroup(raw.workspace)
  const manual = raw.manual === undefined ? { servers: [] } : normalizeGroup(raw.manual)
  return global === null || workspace === null || manual === null ? null : { global, workspace, manual }
}

/** 快照存储：当前值与订阅者集合（数据源与控制面共用一个实例）。 */
interface SnapshotStore {
  /** 只读快照源。 */
  readonly source: ObservableSnapshot<McpSnapshot>
  /** 写入快照并通知全部订阅者。 */
  publish(value: McpSnapshot): void
}

/**
 * 创建一个空快照存储。
 *
 * @returns 存储实例（初始快照为 null）
 */
function createSnapshotStore(): SnapshotStore {
  let snapshot: McpSnapshot = null
  const listeners = new Set<() => void>()
  return {
    source: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    publish: (value) => {
      snapshot = value
      for (const notify of listeners) notify()
    },
  }
}

/**
 * 判断载荷是否可能仍是「挂载尚未写入运行时」的中间态。
 *
 * 工作区与手动两组都为空时一律视为中间态，下次订阅重新拉取：启动期全局尚未挂载完
 * 会是三组全空，若当成终态，页面会永久停在空态（切走标签页再切回也不会自愈）。
 *
 * @param data - 已归一化的载荷
 * @returns true 表示下次订阅应重新拉取
 */
function isIncomplete(data: McpMountedData): boolean {
  return data.workspace.servers.length === 0 && data.manual.servers.length === 0
}

/**
 * 创建一个按需拉取的快照源。
 *
 * 初次订阅时拉取一次并发布：拉取失败或呈中间态都不锁死，后续订阅
 * （如标签页切回）会再次拉取，避免会话永久停在空态。
 *
 * @param sessionId - 会话 id
 * @param fetchMounts - 拉取函数
 * @param store - 共用的快照存储
 * @returns 可订阅的快照源
 */
function createLazySource(
  sessionId: string,
  fetchMounts: (sessionId: string) => Promise<unknown>,
  store: SnapshotStore,
): ObservableSnapshot<McpSnapshot> {
  let started = false
  return {
    getSnapshot: store.source.getSnapshot,
    subscribe: (listener) => {
      const unsubscribe = store.source.subscribe(listener)
      if (!started) {
        started = true
        void fetchMounts(sessionId).then(
          (payload) => {
            const normalized = normalizeMounts(payload)
            if (normalized === null) {
              started = false
              return
            }
            store.publish(normalized)
            if (isIncomplete(normalized)) started = false
          },
          () => {
            // 失败不锁死：下次订阅（如标签页切回）会重新拉取。
            started = false
          },
        )
      }
      return unsubscribe
    },
  }
}

/**
 * 创建某会话的数据源与控制面。
 *
 * 数据源与控制动作共用同一份快照：动作成功后立即用响应更新快照并通知订阅者，
 * 失败只返回原因（HTTP 400/409 的 error 文案），不改动快照。
 *
 * @param sessionId - 会话 id
 * @param io - 端点调用集合
 * @returns 数据源与控制动作
 */
export function createMountControl(sessionId: string, io: MountControlIo): MountControl {
  const store = createSnapshotStore()

  /**
   * 执行一次控制动作：成功时发布新快照，失败时返回原因。
   *
   * @param call - 端点调用
   * @returns 动作结果
   */
  const run = async (call: () => Promise<unknown>): Promise<MountControlResult> => {
    try {
      const payload = await call()
      const normalized = normalizeMounts(payload)
      if (normalized === null) return { ok: false }
      store.publish(normalized)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  return {
    source: createLazySource(sessionId, io.fetchMounts, store),
    refresh: () => run(() => io.refresh(sessionId)),
    addUpload: file => run(() => io.add(sessionId, file.name, file.content)),
    unload: group => run(() => io.unload(sessionId, group)),
  }
}
