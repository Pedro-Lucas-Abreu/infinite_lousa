import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const commandTimeoutMs = 30_000

async function executableFor(channel) {
  const browsers = {
    chrome: ['Google', 'Chrome', 'Application', 'chrome.exe'],
    msedge: ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
  }
  if (!Object.hasOwn(browsers, channel)) throw new Error(`Unknown browser channel: ${channel}`)
  const override = process.env[channel === 'chrome' ? 'CHROME_EXECUTABLE' : 'EDGE_EXECUTABLE']
  if (override) return override
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
  for (const root of roots.filter(Boolean)) {
    const candidate = join(root, ...browsers[channel])
    try {
      await access(candidate)
      return candidate
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  throw new Error(`Could not find a local Windows installation of ${channel}.`)
}

async function devToolsEndpoint(profile, child, getSpawnError) {
  const deadline = Date.now() + commandTimeoutMs
  while (Date.now() < deadline) {
    if (getSpawnError()) throw getSpawnError()
    // The Edge launcher can hand off startup to another process and exit successfully.
    if (child.exitCode !== null && child.exitCode !== 0) {
      throw new Error(`Browser exited before startup (${child.exitCode}).`)
    }
    try {
      const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/)
      if (/^\d+$/.test(port) && path?.startsWith('/devtools/browser/')) {
        return `ws://127.0.0.1:${port}${path}`
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await delay(100)
  }
  throw new Error('Timed out waiting for the browser debugging endpoint.')
}

async function connect(endpoint) {
  const socket = new WebSocket(endpoint)
  const pending = new Map()
  let nextId = 0
  const abort = new AbortController()
  const openTimeout = setTimeout(() => abort.abort(), commandTimeoutMs)

  function closePending() {
    for (const { finish } of pending.values()) finish(new Error('The browser connection closed.'))
  }

  socket.addEventListener('close', closePending)
  socket.addEventListener('error', closePending)
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    const request = pending.get(message.id)
    if (!request) return
    request.finish(message.error ? new Error(`${request.method}: ${message.error.message}`) : null, message.result)
  })

  try {
    await once(socket, 'open', { signal: abort.signal })
  } catch (error) {
    socket.close()
    throw error
  } finally {
    clearTimeout(openTimeout)
  }

  return {
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        if (socket.readyState !== WebSocket.OPEN) {
          reject(new Error('The browser connection is unavailable.'))
          return
        }
        const id = ++nextId
        function finish(error, result) {
          clearTimeout(timeout)
          pending.delete(id)
          if (error) reject(error)
          else resolve(result)
        }
        const timeout = setTimeout(() => finish(new Error(`${method} timed out.`)), commandTimeoutMs)
        pending.set(id, { method, finish })
        try {
          socket.send(JSON.stringify({ id, method, params, sessionId }))
        } catch (error) {
          finish(error)
        }
      })
    },
    close() { socket.close() },
  }
}

export async function launchChromium(channel, { headless = true, viewport, dpr = 1 }) {
  const executable = await executableFor(channel)
  const profile = await mkdtemp(join(tmpdir(), 'whiteboard-browser-'))
  const { width, height } = viewport
  const flags = [
    `--user-data-dir=${profile}`,
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    `--window-size=${width},${height}`,
  ]
  if (headless) flags.push('--headless=new')
  const child = spawn(executable, [...flags, 'about:blank'], { stdio: 'ignore', windowsHide: headless })
  let spawnError
  child.once('error', (error) => { spawnError = error })
  const exited = Promise.race([once(child, 'exit'), once(child, 'error')]).catch(() => {})
  let cdp
  let closing

  function close() {
    closing ??= (async () => {
      if (cdp) {
        await Promise.race([cdp.send('Browser.close').catch(() => {}), delay(2_000)])
        cdp.close()
      }
      const stopped = await Promise.race([exited.then(() => true), delay(2_000, false)])
      if (!stopped) child.kill()
      await exited
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })()
    return closing
  }

  try {
    cdp = await connect(await devToolsEndpoint(profile, child, () => spawnError))
    const [{ product }, { gpu }, { targetId }] = await Promise.all([
      cdp.send('Browser.getVersion'),
      cdp.send('SystemInfo.getInfo'),
      cdp.send('Target.createTarget', { url: 'about:blank' }),
    ])
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    const send = (method, params) => cdp.send(method, params, sessionId)
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false })
    await cdp.send('Target.activateTarget', { targetId })

    async function evaluate(expression, ...args) {
      if (typeof expression === 'function') {
        const argumentsList = args.map((arg) => JSON.stringify(arg) ?? 'undefined').join(', ')
        expression = `(${String(expression)})(${argumentsList})`
      }
      const { result, exceptionDetails } = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
      return result.value
    }

    const page = {
      evaluate,
      send,
      async navigate(url) {
        const navigation = await send('Page.navigate', { url })
        if (navigation.errorText) throw new Error(`${url}: ${navigation.errorText}`)
        const deadline = Date.now() + commandTimeoutMs
        while (Date.now() < deadline) {
          const ready = await evaluate((expected) => location.href === expected && document.readyState === 'complete', url)
          if (ready) return
          await delay(50)
        }
        throw new Error(`Timed out waiting for ${url}.`)
      },
      async close() { await cdp.send('Target.closeTarget', { targetId }) },
    }
    return { browserVersion: product, gpu, page, close }
  } catch (error) {
    await close()
    throw error
  }
}
