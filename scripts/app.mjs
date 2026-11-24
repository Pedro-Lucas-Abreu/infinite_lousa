import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { cp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = await realpath(fileURLToPath(new URL('..', import.meta.url)))
const dist = join(root, 'dist')
const equationAliases = {
  '#default-font/svg/default.js': '@mathjax/mathjax-stix2-font/js/svg/default.js',
}

async function exists(path) {
  try { return await realpath(path) } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

async function compile() {
  const existingOutput = await exists(dist)
  if (existingOutput) {
    if (existingOutput !== dist || relative(root, existingOutput) !== 'dist') {
      throw new Error('The build output resolves outside the expected directory.')
    }
    await rm(dist, { recursive: true })
  }

  const options = {
    absWorkingDir: root,
    outdir: join(dist, 'assets'),
    bundle: true, minify: true, format: 'esm', target: 'es2022',
    legalComments: 'linked', metafile: true,
  }
  const worker = await exists(join(root, 'src/documents/archive.worker.ts'))
  const workerOutput = worker && (await build({
    ...options, entryPoints: { 'document-archive': worker }, entryNames: '[name]-[hash]',
  })).metafile
  const workerUrl = workerOutput ? `./${Object.keys(workerOutput.outputs).find((file) => file.endsWith('.js')).split('/').at(-1)}` : ''
  const { metafile } = await build({
    ...options,
    entryPoints: { main: 'src/main.tsx' },
    entryNames: '[name]-[hash]', chunkNames: '[name]-[hash]',
    splitting: true, jsx: 'automatic',
    alias: equationAliases,
    define: { 'process.env.NODE_ENV': '"production"', __DOCUMENT_WORKER__: JSON.stringify(workerUrl) },
  })

  if (await exists(join(root, 'public'))) await cp(join(root, 'public'), dist, { recursive: true })
  await copyPdfAssets()

  const entry = Object.entries(metafile.outputs).find(([, details]) => details.entryPoint === 'src/main.tsx')
  if (!entry) throw new Error('No application entry was generated.')
  const [js, { cssBundle }] = entry
  const distPath = (path) => `./${relative(dist, resolve(root, path)).split(sep).join('/')}`
  const markup = [
    cssBundle && `<link rel="stylesheet" href="${distPath(cssBundle)}" />`,
    `<script type="module" src="${distPath(js)}"></script>`,
  ].filter(Boolean).join('\n    ')
  const html = await readFile(join(root, 'index.html'), 'utf8')
  await writeFile(join(dist, 'index.html'), html.replace('<!-- app entry -->', markup))
  await writeNotices([metafile, workerOutput].filter(Boolean))
  await writePrecache()
  console.log('Static build written to dist/')
}

async function copyPdfAssets() {
  const source = join(root, 'node_modules', 'pdfjs-dist')
  const target = join(dist, 'pdfjs')
  await mkdir(target)
  await cp(join(source, 'LICENSE'), join(target, 'LICENSE'))
  for (const name of ['pdf.worker', 'pdf.renderer']) {
    await cp(join(source, 'build', `${name}.min.mjs`), join(target, `${name}.mjs`))
  }
  const permitted = {
    cmaps: (name) => name === 'LICENSE' || name.endsWith('.bcmap'),
    standard_fonts: (name) => name === 'LICENSE_FOXIT' || /^Foxit[A-Za-z]+\.pfb$/.test(name),
    wasm: (name) => /^(?:LICENSE_(?:PDFJS_)?(?:JBIG2|OPENJPEG|QCMS)|(?:jbig2|openjpeg)(?:\.wasm|_nowasm_fallback\.js)|qcms_bg\.wasm)$/.test(name),
  }
  for (const [directory, include] of Object.entries(permitted)) {
    await mkdir(join(target, directory))
    for (const name of (await readdir(join(source, directory))).filter(include)) {
      await cp(join(source, directory, name), join(target, directory, name))
    }
  }
}

async function writeNotices(metafiles) {
  const packageRoots = new Set()
  for (const input of metafiles.flatMap((metafile) => Object.keys(metafile.inputs))) {
    const normalized = input.replaceAll('\\', '/')
    const match = normalized.match(/^(.*(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+)\//)
    if (match) packageRoots.add(resolve(root, match[1]))
  }
  const notices = ['# Third-party software notices']
  for (const path of [...packageRoots].sort()) {
    const pkg = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'))
    if (pkg.name === '@mathjax/mathjax-stix2-font') {
      notices.push(
        `## ${pkg.name} ${pkg.version} (Apache-2.0 module code, OFL-1.1 STIX Two glyph data)`,
        await readFile(join(root, 'node_modules/@mathjax/src/LICENSE'), 'utf8'),
        await readFile(join(root, 'src/equations/STIX-OFL.txt'), 'utf8'),
      )
      continue
    }
    const licenseFile = (await readdir(path)).find((name) => /^licen[cs]e(?:\.(md|txt))?$/i.test(name))
    if (!licenseFile) throw new Error(`Missing license text for ${pkg.name}.`)
    notices.push(`## ${pkg.name} ${pkg.version} (${pkg.license})`, await readFile(join(path, licenseFile), 'utf8'))
  }
  await writeFile(join(dist, 'THIRD_PARTY_LICENSES.md'), notices.join('\n\n'))
}

async function writePrecache() {
  const path = join(dist, 'sw.js')
  if (!await exists(path)) return
  const template = await readFile(path, 'utf8')
  const files = (await readdir(dist, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dist, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter((name) => name !== 'sw.js')
    .sort()
  const hash = createHash('sha256').update(template)
  for (const file of files) hash.update(file).update(await readFile(join(dist, file)))
  const precache = { version: hash.digest('hex').slice(0, 16), assets: files.map((file) => `./${file}`) }
  if (!template.includes('/* Build manifest */ null')) throw new Error('Missing precache placeholder.')
  await writeFile(path, template.replace('/* Build manifest */ null', JSON.stringify(precache)))
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json',
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
}

export async function serve(port = 0) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost')
      const name = decodeURIComponent(url.pathname.slice(1)) || 'index.html'
      const path = resolve(dist, name)
      if (!path.startsWith(`${dist}${sep}`)) { response.writeHead(404).end(); return }
      const contents = await readFile(path)
      response.writeHead(200, { 'Content-Type': mimeTypes[extname(path)] ?? 'application/octet-stream' })
      response.end(contents)
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise((done, fail) => server.once('error', fail).listen(port, '127.0.0.1', done))
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}

async function test() {
  const entries = (await readdir(join(root, 'src'), { recursive: true }))
    .filter((name) => name.endsWith('.test.ts'))
    .map((name) => join(root, 'src', name))
  const result = await build({
    entryPoints: entries, outdir: join(root, 'test-results', 'unit'),
    bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' },
    alias: equationAliases,
    metafile: true,
  })
  const outputs = Object.keys(result.metafile.outputs)
  process.exitCode = spawnSync(process.execPath, ['--test', ...outputs], { cwd: root, stdio: 'inherit' }).status ?? 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , command] = process.argv
  if (command === 'test') await test()
  else if (command === 'build') await compile()
  else if (command === 'dev' || command === 'preview') {
    if (command === 'dev') await compile()
    const { url } = await serve(command === 'dev' ? 5173 : 4173)
    console.log(`Lousa: ${url}`)
  } else throw new Error('Use build, dev, preview, or test.')
}
