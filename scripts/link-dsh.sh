#!/usr/bin/env bash
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

HARNESS="${DSH_HARNESS:-${1:-}}"
if [[ -z "$HARNESS" ]]; then
  echo "用法: $0 <path-to-deepseek-harness>" >&2
  echo "  或: DSH_HARNESS=/path/to/deepseek-harness $0" >&2
  exit 1
fi

HARNESS="$(cd "$HARNESS" && pwd)"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/node_modules/@deepseek-ai"

mkdir -p "$DEST"

# name:相对于 harness 根目录的路径（name 用于 @deepseek-ai/<name>）
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
)

for entry in "${PACKAGES[@]}"; do
  name="${entry%%:*}"
  rel="${entry##*:}"
  target="$HARNESS/$rel"
  link="$DEST/$name"
  if [[ ! -d "$target" ]]; then
    echo "!! 未找到 harness 包（跳过）: $rel" >&2
    continue
  fi
  rm -f "$link"
  ln -s "$target" "$link"
  echo "linked @deepseek-ai/$name -> $target"
done

echo "完成。共链接 $(ls -1 "$DEST" | wc -l | tr -d ' ') 个包。"
