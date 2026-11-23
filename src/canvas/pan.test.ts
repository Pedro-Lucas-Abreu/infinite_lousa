import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldStartPan } from './pan'

test('the left button starts panning only with Ctrl, Space or the Hand tool', () => {
  assert.equal(shouldStartPan(0, false, false, false), false)
  assert.equal(shouldStartPan(0, true, false, false), true)
  assert.equal(shouldStartPan(0, false, true, false), true)
  assert.equal(shouldStartPan(0, false, false, true), true)
})

test('the middle button is inert, including when pan modifiers are active', () => {
  assert.equal(shouldStartPan(1, false, false, false), false)
  assert.equal(shouldStartPan(1, true, true, true), false)
})

test('the right button always starts a pan when available for a new gesture', () => {
  assert.equal(shouldStartPan(2, false, false, false), true)
  assert.equal(shouldStartPan(2, true, true, true), true)
})
