import assert from 'node:assert/strict'
import test from 'node:test'
import { textBoxDimensions } from './text'

test('text box measures the widest line and preserves blank lines', () => {
  assert.deepEqual(textBoxDimensions('a\n\nmais longo', 20, (line) => line.length * 10), { width: 100, height: 75 })
  assert.deepEqual(textBoxDimensions('', 20, () => 0), { width: 1, height: 25 })
})
