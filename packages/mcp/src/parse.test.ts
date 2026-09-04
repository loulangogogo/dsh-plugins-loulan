import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRecord, asStringArray, asStringRecord } from './parse.js'

test('isRecord 仅接受普通对象', () => {
  assert.equal(isRecord({}), true)
  assert.equal(isRecord(null), false)
  assert.equal(isRecord([]), false)
})

test('asStringArray 过滤非字符串元素', () => {
  assert.deepEqual(asStringArray(['a', 1, null, 'b']), ['a', 'b'])
  assert.deepEqual(asStringArray('x'), [])
})

test('asStringRecord 仅保留字符串值', () => {
  assert.deepEqual(asStringRecord({ a: '1', b: 2, c: true }), { a: '1' })
  assert.deepEqual(asStringRecord(null), {})
})
