# dsh-loulan-mcp 工作区挂载前审批（设计文档）

- 日期：2026-09-04
- 状态：已确认
- 前置基础：`8f2bf81`（工作区 MCP 按 agent 唯一挂载、避免 `already in use` 冲突）

## 1. 背景与目标

`dsh-loulan-mcp` 目前会在每个 agent 创建时**自动挂载**其工作区 `.mcp.json` 里的全部 MCP 服务。用户希望：**在挂载前征求用户同意**，列明将挂载哪些 MCP 服务；同意才挂载，拒绝则不挂载。

本次改动同时要求把当前集中在 `src/index.ts` 的插件源码**按业务功能拆分文件**。

## 2. 需求（已确认）

1. **每次新建 agent 都询问**：每个 `agent/created`，若该 agent 工作区存在 `.mcp.json`（且 ≠ 全局根 `.dsh/.mcp.json`），则记为"待决定"，**不立即挂载**；无 `.mcp.json` 则不询问、不挂载。
2. **首 turn 弹审批**：在该 agent 的**首个对话 turn**（`agent/request` 瀑布点，满足 `ApprovalService.request` 的 open turn 要求）弹出审批，展示待挂载的 MCP 服务列表。
3. **同意 → 挂载**（沿用方案 B：为每个 agent 生成唯一 `serverName`，如 `postgres_<token>`）；**拒绝/取消/不可用 → 不挂载**。
4. **不做全局记忆**：每个新 agent 都独立询问一次；同一 agent 内部只问一次（`agentDecisions: Map<agentId, 'pending'|'approved'|'rejected'>`）。
5. **全局根 `.mcp.json` 不询问**，仍自动挂载（不带后缀）。

## 3. 行为决策（已确认）

- **无审批服务**（`ctx.get('approval')` 为 undefined）：`fail-closed`——不挂载该工作区并告警。默认如此。
- **同一 agent 已决定**后，其后续 turn 不再询问（该 agent 生命周期内记住）。
- **`.mcp.json` 解析失败**：记该 agent `rejected`，告警，不挂载。
- 该 agent 决定为 `approved` 时挂载一次；重复触发 `agent/created`（同一 agentId）不重复挂载。

## 4. 架构与数据流

```
agent/created (agentId, cwd)
  → file = findMcpJson(cwd)
  → file === undefined || file === rootFile  ⇒ 结束（不询问）
  → servers = readMcpServers(file)  // 名字列表供 reason 用
  → agentDecisions.set(agentId, 'pending')
  → 不挂载，结束

agent/request 瀑布点（open turn）
  → 若 agentDecisions.get(agentId) === 'pending'
  → outcome = askForApproval(ctx, agent, file, servers)
      'allowed-once' → agentDecisions.set(agentId,'approved'); mountFile(agent.ctx, file, agentToken(agentId))
      'rejected'/'cancelled' → agentDecisions.set(agentId,'rejected'); 不挂载
      'unavailable' → agentDecisions.set(agentId,'rejected'); 不挂载并告警
  → next()（无论结果都继续）

agent/disposed → agentDecisions.delete(agentId)
```

## 5. 文件结构（按业务功能拆分）

```
packages/mcp/src/
├── index.ts        # 插件入口：name + apply()；生命周期编排（探测 → 首turn审批 → 挂载）；注册 agent/created、agent/request、agent/disposed
├── config.ts       # Config 接口 + Schema（cwd；可选 approval 相关开关）
├── discover.ts     # 发现：findMcpJson、dshHome；工作区/全局根 .mcp.json 定位
├── parse.ts        # 解析/防御：isRecord、asStringArray、asStringRecord、readMcpServers(file)
├── server-name.ts  # serverName：SERVER_NAME_PATTERN、DEFAULT_TOOL_CALL_TIMEOUT_MS、agentToken、suffixedServerName、mapServer、Mapped
├── mount.ts        # 挂载：mountFile(ctx, file, uniqueSuffix?)
└── approval.ts     # 审批：askForApproval(ctx, agent, file, servers)（封装 approval.request）；agentDecisions 状态
```

说明：
- `tsconfig.json` / `tsconfig.build.json` 的 `include` 已是 `src/**/*.ts`，无需改。
- `mapServer` / `mountFile` / `agentToken` / `suffixedServerName` 从当前 `index.ts` 抽出；`index.ts` 只保留编排与事件注册。

## 6. 对外行为变化

- 工作区 MCP 的挂载由"自动挂载"改为"首 turn 审批后挂载"。
- 审批的 `ApprovalRequest` 使用合成 `toolName`（如 `dsh-loulan-mcp:mount`），`reason` 列出待挂载服务（含 serverName 与传输类型）。呈现由 DSH UI 的 `ApprovalPanel` 负责。
- 全局根 `.mcp.json` 行为不变（自动挂载）。

## 7. 错误处理

- `approval.request()` 抛错（无 open turn 等）→ catch 后记 `rejected`、不挂载、不阻断 `next()`。
- 审批被 abort（agent 销毁/用户取消）→ `cancelled` → 不挂载。
- 多个待决定 agent 各自在自身 turn 询问，互不阻塞。
- 解析失败 → 记 `rejected` 并告警。

## 8. 测试

- **单元**：`discover`（findMcpJson 命中/未命中）、`parse`（readMcpServers 正常/畸形）、`server-name`（appendSuffix 长度/字符集/截断）、`approval`（askForApproval 对各 ApprovalOutcome 的分支、agentDecisions 状态机）。
- **集成**（`pnpm test-mcp`）：在 `test02` 开会话 → 首个 turn 弹出审批 → 批准后 MCP 工具可见可用；拒绝后工具不可见；**同工作区再新建**会话会**再次**询问。

## 9. 验收标准

- 工作区含 `.mcp.json` 时，首个 turn 弹出审批且列明服务列表；同意后工具可用，拒绝后不可用。
- 同工作区新建第二个 agent 会再次询问（无全局记忆）。
- 无 `.mcp.json` 的工作区不询问、不挂载。
- 全局根 `.mcp.json` 自动挂载、不询问。
- 源码按第 5 节结构拆分，`pnpm typecheck` / `pnpm --filter dsh-loulan-mcp build` 通过。
