/**
 * @fileoverview load.ts 的单元测试：目录递归、排序、单文件上限与总预算。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectRuleFiles, loadRules } from '../src/load.js'
import { renderRules } from '../src/render.js'

/** 创建并返回一个临时目录；调用方负责用 withTempDir 清理。 */
function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-rules-'))
}

test('collectRuleFiles 递归收集普通文件并按路径排序', async () => {
  const dir = tempDir()
  try {
    writeFileSync(join(dir, 'b.md'), 'B')
    writeFileSync(join(dir, 'a.md'), 'A')
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'c.md'), 'C')
    const files = await collectRuleFiles(dir)
    assert.deepEqual(files, [join(dir, 'a.md'), join(dir, 'b.md'), join(dir, 'sub', 'c.md')])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('collectRuleFiles 跳过符号链接目录，避免环路', async () => {
  const dir = tempDir()
  const outside = tempDir()
  try {
    writeFileSync(join(outside, 'loop.md'), 'LOOP')
    symlinkSync(outside, join(dir, 'link'), 'dir')
    assert.deepEqual(await collectRuleFiles(dir), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('collectRuleFiles 目录不存在时返回空数组', async () => {
  assert.deepEqual(await collectRuleFiles(join(tmpdir(), 'dsh-rules-missing-' + Date.now())), [])
})

test('loadRules 读取多个规则目录，全局在前、项目在后', async () => {
  const home = tempDir()
  const project = tempDir()
  try {
    writeFileSync(join(home, 'global.md'), '全局规则')
    writeFileSync(join(project, 'project.md'), '项目规则')
    const loaded = await loadRules([
      { absoluteDir: home, displayDir: '~/.dsh/rules' },
      { absoluteDir: project, displayDir: '.dsh/rules' },
    ], { maxBytes: 65536, maxSourceBytes: 262144 })
    assert.deepEqual(loaded.files.map(file => file.displayPath), ['~/.dsh/rules/global.md', '.dsh/rules/project.md'])
    assert.deepEqual(loaded.files.map(file => file.content), ['全局规则', '项目规则'])
    assert.deepEqual(loaded.omitted, [])
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})

test('loadRules 单文件超过 maxSourceBytes 时省略', async () => {
  const dir = tempDir()
  try {
    writeFileSync(join(dir, 'big.md'), 'X'.repeat(200))
    writeFileSync(join(dir, 'small.md'), 'ok')
    const loaded = await loadRules([{ absoluteDir: dir, displayDir: '.dsh/rules' }], { maxBytes: 65536, maxSourceBytes: 10 })
    assert.deepEqual(loaded.files.map(file => file.displayPath), ['.dsh/rules/small.md'])
    assert.deepEqual(loaded.omitted, ['.dsh/rules/big.md'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadRules 总预算放不下的文件被省略，后面的小文件仍可注入', async () => {
  const dir = tempDir()
  try {
    writeFileSync(join(dir, 'a-small.md'), 'short')
    writeFileSync(join(dir, 'b-huge.md'), 'Y'.repeat(5000))
    writeFileSync(join(dir, 'c-small.md'), 'tiny')
    const loaded = await loadRules([{ absoluteDir: dir, displayDir: '.dsh/rules' }], { maxBytes: 1000, maxSourceBytes: 65536 })
    assert.deepEqual(loaded.files.map(file => file.displayPath), ['.dsh/rules/a-small.md', '.dsh/rules/c-small.md'])
    assert.deepEqual(loaded.omitted, ['.dsh/rules/b-huge.md'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadRules 目录不存在时返回空结果', async () => {
  const loaded = await loadRules([{ absoluteDir: join(tmpdir(), 'dsh-rules-none-' + Date.now()), displayDir: '.dsh/rules' }], { maxBytes: 65536, maxSourceBytes: 65536 })
  assert.deepEqual(loaded, { files: [], omitted: [] })
})

test('loadRules 结果恰好不超过 maxBytes（渲染后字节数）', async () => {
  const dir = tempDir()
  try {
    writeFileSync(join(dir, 'a.md'), 'a'.repeat(200))
    writeFileSync(join(dir, 'b.md'), 'b'.repeat(200))
    const maxBytes = 800
    const loaded = await loadRules([{ absoluteDir: dir, displayDir: '.dsh/rules' }], { maxBytes, maxSourceBytes: 65536 })
    assert.ok(loaded.files.length >= 1, '至少保留一个文件')
    assert.ok(Buffer.byteLength(renderRules(loaded.files, loaded.omitted), 'utf8') <= maxBytes)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** 占位：避免 renderRules 在本文件未被引用时被 lint 误判。 */
void renderRules
