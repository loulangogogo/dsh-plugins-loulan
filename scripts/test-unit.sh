#!/usr/bin/env bash
# -e：任一命令失败立即退出；-u：引用未定义变量报错；-o pipefail：管道任一环失败即失败。
set -euo pipefail

# 用 tsx 运行 dsh-loulan-mcp 的单元测试。
# Node 24 原生类型擦除不会把 .js 后缀映射到 .ts，因此 node --test 无法解析源码里
# NodeNext 风格的 .js 相对导入；tsx 会正确地把 .js 解析到对应的 .ts。
# 这里复用 harness 自带的 tsx，不额外引入项目 devDependency。

# 项目根目录：脚本所在目录（scripts/）的上一级。
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 引用统一环境配置：读取 DSH_HARNESS（缺省 ~/.dsh/deepseek-harness）。
source "$ROOT/scripts/dsh.env"

# harness 自带 tsx 的可执行文件路径。
TSX="$DSH_HARNESS/node_modules/.bin/tsx"

# 前置校验：tsx 必须存在，否则给出提示并退出。
if [[ ! -x "$TSX" ]]; then
  echo "未找到 harness 自带的 tsx：$TSX" >&2
  echo "请确认 DSH_HARNESS 指向正确的 deepseek-harness checkout。" >&2
  exit 1
fi

# exec 用 tsx 进程替换当前 shell；--test 走 Node 测试运行器，
# 匹配 mcp 包 test 目录下的所有 *.test.ts。
exec "$TSX" --test "$ROOT/packages/mcp/test/"*.test.ts
