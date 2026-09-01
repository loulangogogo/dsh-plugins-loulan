#!/usr/bin/env bash
set -euo pipefail

# 用本项目的 cordis.yml 作为 patch overlay 启动 DSH Web UI。
# 通过 DSH_HARNESS 指定 harness checkout 位置（默认 ~/.dsh/deepseek-harness）。

HARNESS="${DSH_HARNESS:-$HOME/.dsh/deepseek-harness}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ ! -d "$HARNESS" ]]; then
  echo "未找到 DeepSeek Harness：$HARNESS" >&2
  echo "请设置 DSH_HARNESS=/path/to/deepseek-harness 后重试。" >&2
  exit 1
fi

cd "$HARNESS"
exec pnpm dsh web --patch "$ROOT/cordis.yml" "$@"
