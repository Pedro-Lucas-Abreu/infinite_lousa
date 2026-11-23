import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { arch, cpus, release } from 'node:os'
import { join, resolve } from 'node:path'
import { serve } from './app.mjs'
import { launchChromium } from './chromium.mjs'

const [mode, ...args] = process.argv.slice(2)
if (!['smoke', 'benchmark', 'documents'].includes(mode)) throw new Error('Use smoke, documents, or benchmark.')

const channels = args.filter((arg) => arg === 'chrome' || arg === 'msedge')
const selectedChannels = channels.length ? channels : ['chrome', 'msedge']
const modes = args.includes('--hidpi') ? [1, 2] : [1]
const repetitions = mode === 'benchmark' && !args.includes('--quick') ? 3 : 1
const viewport = { width: 1920, height: 1080 }
const headless = !args.includes('--headed')

function percentile(samples, fraction) {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]
}

function stats(samples) {
  return { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), p99: percentile(samples, 0.99) }
}

function summarizeMotion({ frameIntervals, rendering }) {
  assert.equal(frameIntervals.length, 120)
  assert.equal(rendering.length, frameIntervals.length)
  const visible = rendering.map(({ visibleStrokes }) => visibleStrokes)
  return {
    fps: 1000 * frameIntervals.length / frameIntervals.reduce((sum, time) => sum + time, 0),
    delayedFrames: frameIntervals.filter((time) => time > 1000 / 60 * 1.5).length,
    frameMs: stats(frameIntervals),
    drawMs: stats(rendering.map(({ renderMs }) => renderMs)),
    visibleMin: Math.min(...visible),
    visibleMax: Math.max(...visible),
    pathMisses: rendering.reduce((sum, frame) => sum + frame.cacheMisses, 0),
  }
}

async function penGesture(page, steps, pace, offset = 0) {
  const surface = await page.evaluate(() => document.querySelector('.live-surface').getBoundingClientRect().toJSON())
  assert.ok(surface)
  const left = surface.x + surface.width * 0.3
  const top = surface.y + surface.height * (0.37 + offset)
  await mouse(page, 'mouseMoved', left, top)
  await mouse(page, 'mousePressed', left, top, 'left', 1)
  for (let index = 1; index <= steps; index += 1) {
    await mouse(page, 'mouseMoved', left + 2.75 * index, top + 45 * Math.sin(index / 13), 'none', 1)
    if (pace) await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  }
  await mouse(page, 'mouseReleased', left + 2.75 * steps, top + 45 * Math.sin(steps / 13), 'left')
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
}

async function documentSmoke(page, url, channel) {
  const surfaceReady = () => document.querySelector('.surface')?.getAttribute('aria-busy') === 'false'
  const saved = () => document.querySelector('[data-save-status="saved"]') !== null
  const undo = () => document.querySelector('button[aria-label="Desfazer"]')
  const redo = () => document.querySelector('button[aria-label="Refazer"]')
  const inkRegions = () => {
    const canvas = document.querySelector('.surface canvas')
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    const split = Math.floor(canvas.height * 0.46) * canvas.width * 4
    let upper = false
    let lower = false
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] === 0) continue
      if (index < split) upper = true
      else lower = true
      if (upper && lower) break
    }
    return { upper, lower }
  }
  const click = (label) => page.evaluate((text) => [...document.querySelectorAll('button')]
    .find((button) => button.textContent.trim() === text).click(), label)
  async function waitForInk(hasLowerStroke) {
    let ink
    for (let attempt = 0; attempt < 50; attempt += 1) {
      ink = await page.evaluate(inkRegions)
      if (ink.upper && ink.lower === hasLowerStroke) return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`Expected lower stroke ${hasLowerStroke}, saw ${JSON.stringify(ink)}.`)
  }
  const downloadDir = await mkdtemp(join(resolve('test-results'), `${channel}-files-`))
  await page.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir })
  await page.navigate(`${url}/`)
  await waitFor(page, surfaceReady)
  await waitFor(page, () => document.querySelector('[data-offline="ready"]') !== null)
  const pwa = await page.evaluate(async () => {
    const response = await fetch(document.querySelector('link[rel="manifest"]').href)
    const manifest = await response.json()
    return { display: manifest.display, icons: manifest.icons.length, worker: Boolean(navigator.serviceWorker.controller) }
  })
  assert.ok(pwa.display === 'standalone' && pwa.icons >= 2 && pwa.worker)

  await penGesture(page, 42, false)
  await waitForInk(false)
  await waitFor(page, saved)
  await penGesture(page, 57, false, 0.18)
  await waitForInk(true)
  await waitFor(page, saved)

  await page.evaluate(`(${undo})().click()`)
  await waitFor(page, saved)
  await waitForInk(false)
  await page.send('Network.enable')
  await page.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
  await page.navigate(`${url}/?offline-test`)
  await waitFor(page, surfaceReady)
  assert.equal(await page.evaluate(() => navigator.onLine), false)
  await waitForInk(false)
  await page.evaluate(`(${redo})().click()`)
  await waitFor(page, saved)
  await waitForInk(true)

  await click('Baixar cópia')
  const downloaded = join(downloadDir, 'lousa.board')
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await access(downloaded).then(() => true, () => false)) break
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  await access(downloaded)
  await page.evaluate(`(${undo})().click()`)
  await waitFor(page, saved)
  await waitForInk(false)
  await page.evaluate(() => { window.confirm = () => true })
  const { root } = await page.send('DOM.getDocument')
  const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type="file"]' })
  await page.send('DOM.setFileInputFiles', { nodeId, files: [downloaded] })
  await waitFor(page, () => document.querySelector('[role="status"]').textContent === 'Lousa aberta')
  await waitForInk(true)
  const invalid = join(downloadDir, 'invalid.board')
  await writeFile(invalid, 'invalid archive')
  await page.send('DOM.setFileInputFiles', { nodeId, files: [invalid] })
  await waitFor(page, () => document.querySelector('[role="status"]').textContent.includes('foi preservada'))
  assert.deepEqual(await page.evaluate(inkRegions), { upper: true, lower: true })
}

function mouse(page, type, x, y, button = 'none', buttons = 0, modifiers = 0) {
  return page.send('Input.dispatchMouseEvent', { type, x, y, button, buttons, modifiers, clickCount: 1 })
}

async function key(page, key, code, windowsVirtualKeyCode, type = 'rawKeyDown') {
  await page.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode })
}

async function waitFor(page, predicate, ...args) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (await page.evaluate(predicate, ...args)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for ${predicate}`)
}

async function smoke(page) {
  assert.equal(await page.evaluate(() => document.title), 'Lousa')
  const penSelected = () => document.querySelector('[aria-keyshortcuts="P"]').getAttribute('aria-pressed')
  assert.equal(await page.evaluate(penSelected), 'true')
  await page.evaluate(() => document.getElementById('stabilizer').focus())
  await key(page, 'End', 'End', 35)
  await key(page, 'End', 'End', 35, 'keyUp')
  await waitFor(page, () => document.getElementById('stabilizer').value === '100')
  await key(page, 'Home', 'Home', 36)
  await key(page, 'Home', 'Home', 36, 'keyUp')
  await waitFor(page, () => document.getElementById('stabilizer').value === '0')

  await penGesture(page, 42, false)
  await waitFor(page, () => window.whiteboardBenchmark.objectCount() === 1)
  const inkVisible = await page.evaluate(() => {
    const canvas = document.querySelector('.surface canvas')
    const context = canvas.getContext('2d')
    return context.getImageData(0, 0, canvas.width, canvas.height).data
      .some((value, index) => index % 4 === 3 && value > 0)
  })
  assert.ok(inkVisible, 'Confirmed canvas should contain ink')

  const surface = await page.evaluate(() => document.querySelector('.live-surface').getBoundingClientRect().toJSON())
  assert.ok(surface)
  const x = surface.x + surface.width / 2
  const y = surface.y + surface.height / 2
  for (const gesture of ['right', 'Space', 'Control', 'hand']) {
    const before = await page.evaluate(() => window.whiteboardBenchmark.camera())
    if (gesture === 'hand') await page.evaluate(() => document.querySelector('[aria-keyshortcuts="M"]').click())
    if (gesture === 'Space') await key(page, ' ', 'Space', 32)
    const button = gesture === 'right' ? 'right' : 'left'
    const buttons = button === 'right' ? 2 : 1
    const modifiers = gesture === 'Control' ? 2 : 0
    await mouse(page, 'mousePressed', x, y, button, buttons, modifiers)
    await mouse(page, 'mouseMoved', x + 60, y + 22, 'none', buttons, modifiers)
    await mouse(page, 'mouseReleased', x + 60, y + 22, button, 0, modifiers)
    if (gesture === 'Space') await key(page, ' ', 'Space', 32, 'keyUp')
    await waitFor(page, ({ x, y }) => {
      const camera = window.whiteboardBenchmark.camera()
      return camera.x !== x || camera.y !== y
    }, before)
  }
  assert.equal(await page.evaluate(() => window.whiteboardBenchmark.objectCount()), 1)
  await key(page, 'p', 'KeyP', 80)
  await key(page, 'p', 'KeyP', 80, 'keyUp')
  await waitFor(page, () => document.querySelector('[aria-keyshortcuts="P"]').getAttribute('aria-pressed') === 'true')

  const wheel = (modifiers) => page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: -120, modifiers })
  await wheel(0)
  await waitFor(page, () => window.whiteboardBenchmark.camera().zoom > 1)
  await page.evaluate(() => document.querySelector('.scroll-setting input').click())
  const zoom = await page.evaluate(() => window.whiteboardBenchmark.camera().zoom)
  await wheel(0)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  assert.equal(await page.evaluate(() => window.whiteboardBenchmark.camera().zoom), zoom)
  await wheel(2)
  await waitFor(page, (previous) => window.whiteboardBenchmark.camera().zoom > previous, zoom)
  await page.evaluate(() => document.querySelector('.zoom-group button:nth-child(2)').click())
  await waitFor(page, () => document.querySelector('.zoom-group button:nth-child(2)').textContent.trim() === '100%')
  assert.deepEqual(await page.evaluate(() => window.whiteboardBenchmark.camera()), { x: 0, y: 0, zoom: 1 })
}

async function benchmark(page) {
  const results = []
  const configuration = await page.evaluate(() => window.whiteboardBenchmark.configuration)
  for (const fixture of ['distributed', 'dense']) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const load = await page.evaluate((layout) => window.whiteboardBenchmark.load(layout), fixture)
      assert.ok(load.cold)
      const pan = summarizeMotion(await page.evaluate(() => window.whiteboardBenchmark.move('pan')))
      const zoom = summarizeMotion(await page.evaluate(() => window.whiteboardBenchmark.move('zoom')))
      if (fixture === 'dense') {
        assert.equal(pan.visibleMin, configuration.strokeCount)
        assert.equal(zoom.visibleMin, configuration.strokeCount)
      }
      await page.evaluate(() => window.whiteboardBenchmark.beginInk())
      await penGesture(page, 120, true)
      const ink = await page.evaluate(() => window.whiteboardBenchmark.endInk())
      const live = ink.filter(({ committed }) => !committed)
      assert.ok(live.length > 30)
      assert.ok(ink.some(({ committed }) => committed))
      const resultsRow = {
        fixture, repetition, ...load, pan, zoom,
        ink: {
          samples: live.length,
          eventToRenderMs: stats(live.map(({ eventToRenderMs }) => eventToRenderMs)),
          drawMs: stats(live.map(({ renderMs }) => renderMs)),
        },
      }
      results.push(resultsRow)
      console.log(JSON.stringify(resultsRow))
    }
  }
  return { configuration, results }
}

const publishedUrl = args.find((arg) => arg.startsWith('--url='))?.slice(6)
const deployment = publishedUrl ? { url: publishedUrl.replace(/\/$/, '') } : await serve()
const { server, url } = deployment
await mkdir('test-results', { recursive: true })

try {
  for (const channel of selectedChannels) {
    for (const dpr of modes) {
      const browser = await launchChromium(channel, { headless, viewport, dpr })
      const { gpu, page, browserVersion } = browser
      try {
        if (mode === 'documents') {
          await documentSmoke(page, url, channel)
          console.log(`${mode}: ${channel} ${dpr}x passed`)
          continue
        }
        await page.navigate(`${url}/?benchmark`)
        await waitFor(page, () => Boolean(window.whiteboardBenchmark))
        if (mode === 'smoke') {
          await smoke(page)
          const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
          await writeFile(`test-results/smoke-${channel}-${dpr}x.png`, Buffer.from(data, 'base64'))
        } else {
          const environment = {
            channel, version: browserVersion, headless, dpr, viewport,
            system: `${process.platform} ${release()} ${arch()}`, cpu: cpus()[0]?.model,
            logicalProcessors: cpus().length, gpu,
          }
          console.log(JSON.stringify({ channel, version: environment.version, dpr }))
          const measurements = await benchmark(page)
          await writeFile(`test-results/perf-${channel}-${dpr}x.json`, JSON.stringify({ environment, ...measurements }, null, 2))
        }
        console.log(`${mode}: ${channel} ${dpr}x passed`)
      } finally {
        await browser.close()
      }
    }
  }
} finally {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}
