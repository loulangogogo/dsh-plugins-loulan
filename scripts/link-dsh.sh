#!/usr/bin/env bash
# -e：任一命令失败立即退出；-u：引用未定义变量报错；-o pipefail：管道任一环失败即失败。
set -euo pipefail

# 把 DeepSeek Harness 工作区里的 @deepseek-ai/* 包软链到本项目的 node_modules，
# 使插件源码能像 monorepo 内插件一样 import 这些包。
#
# Node 在解析 ESM 时会跟随软链到真实路径，因此每个被链接包的传递依赖
# 会在 harness 自己的 node_modules 中继续解析，无需重复安装。
#
# 用法：
#   bash scripts/link-dsh.sh /path/to/deepseek-harness
#   或  DSH_HARNESS=/path/to/deepseek-harness bash scripts/link-dsh.sh

# harness 路径：优先取 DSH_HARNESS 环境变量，其次取第 1 个位置参数。
HARNESS="${DSH_HARNESS:-$HOME/.dsh/deepseek-harness}"
# 两者都未提供时打印用法并退出。
if [[ -z "$HARNESS" ]]; then
  echo "用法: $0 <path-to-deepseek-harness>" >&2
  echo "  或: DSH_HARNESS=/path/to/deepseek-harness $0" >&2
  exit 1
fi

# 统一为绝对路径（cd + pwd），避免相对路径导致软链指向错误。
HARNESS="$(cd "$HARNESS" && pwd)"
# 项目根目录：脚本所在目录的上一级。
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 软链目标目录：项目 node_modules 下的 @deepseek-ai 命名空间。
DEST="$ROOT/node_modules/@deepseek-ai"

# 确保目标命名空间目录存在。
mkdir -p "$DEST"

# 待链接包清单，格式：name:相对于 harness 根目录的路径（name 用于 @deepseek-ai/<name>）。
declare -a PACKAGES=(
  "cordis:vendor/cordis"
  "cosmokit:vendor/cosmokit"
  "schemastery:vendor/schemastery"
  "dsh-agent:packages/core/agent"
  "dsh-scope:packages/core/scope"
  "dsh-tools:packages/core/tools"
  "dsh-session:packages/core/session"
  "dsh-system-prompt:packages/core/system-prompt"
  "dsh-llm:packages/llm/llm"
  "dsh-subprocess:packages/subprocess/subprocess"
  "dsh-timeout:packages/util/timeout"
  "dsh-attachment:packages/attachment/attachment"
  "dsh-invariants:packages/runtime-diagnostics/invariants"
  "dsh-user-approval:packages/interaction/user-approval"
  "dsh-code-runtime:packages/code-runtime/code-runtime"
  "dsh-mcp-client:packages/mcp/mcp-client"
  "dsh-commands:packages/interaction/commands"
)

# 逐包建立软链；缺失的包告警跳过，不中断整体流程。
for entry in "${PACKAGES[@]}"; do
  # 拆出包名（冒号前）与相对路径（冒号后）。
  name="${entry%%:*}"
  rel="${entry##*:}"
  # 软链真实目标（harness 内绝对路径）与链接位置（项目 node_modules 内）。
  target="$HARNESS/$rel"
  link="$DEST/$name"
  # 目标目录不存在则跳过，避免 ln 失败中断整个循环。
  if [[ ! -d "$target" ]]; then
    echo "!! 未找到 harness 包（跳过）: $rel" >&2
    continue
  fi
  # 先删除旧链接再重建，保证幂等（可重复执行）。
  rm -f "$link"
  ln -s "$target" "$link"
  echo "linked @deepseek-ai/$name -> $target"
done

# 汇总：统计最终链接数量。
echo "完成。共链接 $(ls -1 "$DEST" | wc -l | tr -d ' ') 个包。"
