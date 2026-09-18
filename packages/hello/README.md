# dsh-plugin-hello

注册全局斜杠命令 `/hello`，在聊天界面输出「你好」。纯命令插件：不经过模型、无参数解析、无副作用状态。

## 安装

作为 DeepSeek Harness（DSH）组合包（bundle）安装：

```sh
dsh plugin --profile <profile> add dsh-plugin-hello
```

或从本地 tarball 安装：

```sh
pnpm pack
dsh plugin --profile <profile> add ./dsh-plugin-hello-0.1.0.tgz
```

重新启动对应 profile 后，在聊天框输入 `/hello` 即返回「你好」。

## 本地开发

本仓库根目录的 `cordis.yml` 已把本插件以源码入口（`./packages/hello/src/index.ts`）插入组合，
`pnpm dev` 启动后即生效。

`package.json` 的 `dsh.bundle.patch` 指向包内 `./cordis.patch.yml`，发布为 bundle 后由
`dsh plugin add` 自动追加进 profile 的 `dsh.profile.bundles`。

## 配置

无配置项。

## 开发与发布

```sh
bash scripts/test-unit.sh   # Node 测试运行器（经 harness 自带 tsx）
pnpm build                  # tsc 产出 lib/
pnpm pack                   # prepack 自动 build，生成 dsh-plugin-hello-<version>.tgz
pnpm release                # 登录并发布到 npm
```

## 说明

- 插件入口为编译产物 `lib/index.js`：DSH 从 profile 的 `node_modules` 加载插件，而 Node 拒绝为
  `node_modules` 下的 `.ts` 源码擦除类型（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`），
  因此必须发布编译后的 JS。
- `@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-commands` 仅用于类型；编译后的入口不使用任何运行时 import。
