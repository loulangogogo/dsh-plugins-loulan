#!/usr/bin/env bash
# -e：任一命令失败立即退出；-u：引用未定义变量报错；-o pipefail：管道任一环失败即失败。
set -euo pipefail

# 用本项目的 cordis.yml 作为 patch overlay 启动 DSH Web UI。
# 通过 DSH_HARNESS 指定 harness checkout 位置（默认 ~/.dsh/deepseek-harness）。

# harness checkout 目录：优先取 DSH_HARNESS 环境变量，缺省回退到 ~/.dsh/deepseek-harness。
HARNESS="${DSH_HARNESS:-$HOME/.dsh/deepseek-harness}"
# 项目根目录：脚本所在目录（scripts/）的上一级。
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 前置校验：harness 目录必须存在，否则给出提示并退出。
if [[ ! -d "$HARNESS" ]]; then
  echo "未找到 DeepSeek Harness：$HARNESS" >&2
  echo "请设置 DSH_HARNESS=/path/to/deepseek-harness 后重试。" >&2
  exit 1
fi

# 切到 harness 目录后启动：loader 以该目录解析 cordis.yml 中的路径。
cd "$HARNESS"
# exec 用 dsh 进程替换当前 shell；--patch 注入本项目 cordis.yml，
# --port 13080 固定端口（避开默认 3080），其余参数 "$@" 透传。
exec pnpm dsh web  --patch "$ROOT/cordis.yml" "$@" --port 13080
