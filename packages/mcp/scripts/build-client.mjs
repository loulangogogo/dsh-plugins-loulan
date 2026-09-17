#!/usr/bin/env node
/**
 * 构建 dsh-loulan-mcp 的浏览器半侧 bundle。
 *
 * 不复用 harness 的 tsdown preset：它按 harness workspace 的两级包目录查找包
 * manifest，本仓库不在其中。这里用 esbuild 直接产出 harness 客户端模块系统约定的
 * closure-factory CJS 产物。
 */
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// 包根目录：脚本所在目录（packages/mcp/scripts/）的上一级。
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// 包名：写入 __ModuleLoader__.load 的 id。
const PKG_ID = 'dsh-loulan-mcp'

/** harness 平台模块表（packages/client/web/src/platform.ts 的 PLATFORM_MODULES）。 */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/**
 * 把 NodeNext 风格的 `./x.js` 说明符映射回 `./x.ts` / `./x.tsx` 源文件。
 * esbuild 不做该映射，而仓库统一使用 `.js` 扩展名导入。
 */
const jsToTs = {
  name: 'js-to-ts',
  setup(buildApi) {
    buildApi.onResolve({ filter: /^\.{1,2}\/.*\.js$/ }, (args) => {
      const base = resolve(args.resolveDir, args.path.slice(0, -3))
      for (const ext of ['.ts', '.tsx']) {
        if (existsSync(base + ext)) return { path: base + ext }
      }
      return null
    })
  },
}

await build({
  entryPoints: [resolve(ROOT, 'src/client/index.ts')],
  outfile: resolve(ROOT, 'lib/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  jsx: 'automatic',
  sourcemap: true,
  external: PLATFORM_MODULES,
  plugins: [jsToTs],
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PKG_ID)}, factory: (require) => {\n`
      + 'var module = { exports: {} }; var exports = module.exports;',
  },
  footer: { js: 'return module.exports; } });' },
})

console.log(`[build-client] 已产出 ${resolve(ROOT, 'lib/client.js')}`)
