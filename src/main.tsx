import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { create } from 'zustand'
import { BoardController } from './canvas/controller'
import type { BoardTool, BrushStyle } from './canvas/controller'
import { screenToWorld } from './core/camera'
import { objectBounds, Scene } from './core/scene'
import type { BoardChange, BoardObject, FrameObject, PageObject, Point } from './core/types'
import { BoardDocument } from './documents/store'
import { decodeFromFile, openBoardFile, saveBoardFile } from './documents/files'
import { registerPwa } from './pwa/register'
import type { BenchmarkControls } from './benchmark'
import type { BoardAsset, PortableBoard } from './documents/archive'
import type { SaveStatus } from './documents/store'
import type { PwaControls, PwaState } from './pwa/register'
import { importPdf } from './pdf/import'
import { PdfPagePreviews } from './pdf/preview'
import { exportPdf, exportPng } from './pdf/export'
import { ImagePreviews, importImage } from './ui/assets'
import { fitCamera, framesForPages } from './ui/frames'
import { backgrounds, initialFavorites, tools, Tools } from './ui/tools'
import type { Background, Dock } from './ui/tools'
import './styles.css'

interface BoardSettings {
  tool: BoardTool
  stabilizer: number
  zoomRequiresCtrl: boolean
  dock: Dock
  background: Background
  favorite: number
  favorites: readonly BrushStyle[]
}

const useSettings = create<BoardSettings>(() => ({
  tool: 'pen',
  stabilizer: 35,
  zoomRequiresCtrl: false,
  dock: 'top',
  background: 'white',
  favorite: 0,
  favorites: initialFavorites,
}))

function pickFavorite(index: number) {
  useSettings.setState(({ tool }) => ({ favorite: index, tool: tool === 'highlight' ? tool : 'pen' }))
}

function editFavorite(style: BrushStyle) {
  useSettings.setState(({ favorites, favorite }) => ({
    favorites: favorites.map((entry, index) => index === favorite ? style : entry),
  }))
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

function Board() {
  const confirmedCanvas = useRef<HTMLCanvasElement>(null)
  const liveCanvas = useRef<HTMLCanvasElement>(null)
  const controller = useRef<BoardController | null>(null)
  const sceneRef = useRef<Scene | null>(null)
  const documentRef = useRef<BoardDocument | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const assetInput = useRef<HTMLInputElement>(null)
  const fileMenu = useRef<HTMLDetailsElement>(null)
  const pwa = useRef<PwaControls | null>(null)
  const fileOperation = useRef(false)
  const filename = useRef('lousa.board')
  const frameId = useRef<string | null>(null)
  const frameName = useRef('')
  const createPdfFrames = useRef(true)
  const resetPreviews = useRef<(() => void) | null>(null)
  const [selection, setSelection] = useState<readonly BoardObject[]>([])
  const [frames, setFrames] = useState<readonly FrameObject[]>([])
  const [pdfPages, setPdfPages] = useState<readonly PageObject[]>([])
  const [activeFrame, setActiveFrame] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus | 'recovering'>('recovering')
  const [isReady, setIsReady] = useState(false)
  const [message, setMessage] = useState('')
  const [fileBusy, setFileBusy] = useState(false)
  const [history, setHistory] = useState({ undo: false, redo: false })
  const [pwaState, setPwaState] = useState<PwaState>({ offline: 'loading', canInstall: false, updateAvailable: false })
  const [zoom, setZoom] = useState(1)
  const { tool, stabilizer, zoomRequiresCtrl, dock, background, favorite, favorites } = useSettings()

  function setFrameActive(id: string | null) {
    frameId.current = id
    setActiveFrame(id)
  }

  function listFrames(): FrameObject[] {
    return (sceneRef.current?.all() ?? [])
      .filter((object): object is FrameObject => object.type === 'frame')
      .sort((first, second) => first.props.order - second.props.order)
  }

  function refreshObjects() {
    const nextFrames = listFrames()
    setFrames(nextFrames)
    setPdfPages((sceneRef.current?.all() ?? []).filter((object): object is PageObject => object.type === 'pdfPage'))
    if (!nextFrames.some(({ id }) => id === frameId.current)) setFrameActive(nextFrames[0]?.id ?? null)
    setSelection(controller.current?.getSelection() ?? [])
  }

  function applyChanges(changes: readonly BoardChange[], assets?: readonly BoardAsset[]) {
    if (changes.length === 0 || !documentRef.current) return
    documentRef.current.applyChanges(changes, assets)
    controller.current?.invalidateScene()
    refreshObjects()
    updateHistory()
    setMessage('')
  }

  function frameOrder() {
    return (listFrames().at(-1)?.props.order ?? -1) + 1
  }

  function moveToFrame(id: string | null = frameId.current) {
    const object = id ? sceneRef.current?.get(id) : undefined
    if (object?.type !== 'frame' || !controller.current) return
    setFrameActive(object.id)
    controller.current.setCamera(fitCamera(objectBounds(object), controller.current.getViewport(), 14))
  }

  function stepFrame(direction: number) {
    const ordered = listFrames()
    const index = ordered.findIndex(({ id }) => id === frameId.current)
    const next = ordered[Math.min(ordered.length - 1, Math.max(0, index + direction))]
    if (next) moveToFrame(next.id)
  }

  function createFrame() {
    const name = window.prompt('Nome do quadro 16:9', `Quadro ${listFrames().length + 1}`)
    if (!name?.trim()) return
    frameName.current = name.trim().slice(0, 120)
    useSettings.setState({ tool: 'frame' })
    setMessage('Arraste na lousa para delimitar o quadro 16:9.')
  }

  function setPageLocked(page: PageObject) {
    applyChanges([{ before: page, after: { ...page, locked: !page.locked } }])
    controller.current?.clearSelection()
  }

  function copySelection(cut = false) {
    const board = controller.current
    if (!board?.getSelection().length) return
    board.copySelection()
    void navigator.clipboard?.writeText('Seleção da lousa').catch(() => {})
    if (cut) board.deleteSelection()
    setMessage(cut ? 'Seleção recortada.' : 'Seleção copiada.')
  }

  function scaleSelection(factor: number) {
    const board = controller.current
    const items = board?.getSelection().filter(({ locked }) => !locked) ?? []
    if (!board || !items.length) return
    const bounds = items.map(objectBounds)
    const x = (Math.min(...bounds.map(({ minX }) => minX)) + Math.max(...bounds.map(({ maxX }) => maxX))) / 2
    const y = (Math.min(...bounds.map(({ minY }) => minY)) + Math.max(...bounds.map(({ maxY }) => maxY))) / 2
    board.transformSelection([factor, 0, 0, factor, x * (1 - factor), y * (1 - factor)])
  }

  function updateHistory() {
    const boardDocument = documentRef.current
    setHistory({ undo: Boolean(boardDocument?.canUndo), redo: Boolean(boardDocument?.canRedo) })
  }

  function changeHistory(action: 'undo' | 'redo') {
    if (fileOperation.current || !documentRef.current?.[action]()) return
    controller.current?.invalidateScene()
    controller.current?.clearSelection()
    refreshObjects()
    updateHistory()
  }

  async function runFileOperation(action: () => Promise<void>, errorMessage: string) {
    if (fileOperation.current || !documentRef.current) return
    fileOperation.current = true
    setFileBusy(true)
    if (fileMenu.current) fileMenu.current.open = false
    setMessage('')
    try { await action() }
    catch { setMessage(errorMessage) }
    finally { fileOperation.current = false; setFileBusy(false) }
  }

  async function replaceDocument(portable: PortableBoard, name: string) {
    const current = documentRef.current
    if (!current) return
    if (current.portable().scene.objects.length &&
      !window.confirm('Abrir este arquivo substitui a lousa atual. Se precisar dela, salve uma cópia primeiro. Deseja abrir agora?')) return

    await current.replace(portable)
    resetPreviews.current?.()
    controller.current?.clearSelection()
    filename.current = name
    controller.current?.setCamera({ x: 0, y: 0, zoom: 1 })
    controller.current?.invalidateScene()
    refreshObjects()
    updateHistory()
    setMessage('Lousa aberta')
  }

  function openFile(useUpload = false) {
    const fallbackInput = fileInput.current
    if (!fallbackInput) return
    if (useUpload) {
      if (fileMenu.current) fileMenu.current.open = false
      fallbackInput.click()
      return
    }
    void runFileOperation(async () => {
      const result = await openBoardFile(fallbackInput)
      if (result.kind === 'opened') await replaceDocument(result.board, result.filename)
    }, 'Não foi possível abrir o arquivo. A lousa atual foi preservada.')
  }

  function saveFile(download = false) {
    void runFileOperation(async () => {
      const portable = documentRef.current?.portable()
      if (!portable) return
      const result = await saveBoardFile(portable, filename.current, download)
      if (result.kind !== 'cancelled') {
        filename.current = result.filename
        setMessage(result.kind === 'saved' ? 'Arquivo salvo' : 'Download iniciado')
      }
    }, 'Não foi possível salvar o arquivo. Tente baixar uma cópia pelo menu Arquivo.')
  }

  function openAsset(accept: string) {
    if (!assetInput.current) return
    assetInput.current.accept = accept
    assetInput.current.click()
    if (fileMenu.current) fileMenu.current.open = false
  }

  function importAssets(files: readonly File[], position?: Point) {
    if (!files.length) return
    void runFileOperation(async () => {
      const scene = sceneRef.current
      const board = controller.current
      if (!scene || !board) return
      const camera = board.getCamera()
      let pos = position ?? { x: camera.x, y: camera.y }
      let zIndex = scene.nextZIndex()
      let order = frameOrder()
      let firstFrame: FrameObject | undefined
      const changes: BoardChange[] = []
      const assets: BoardAsset[] = []

      for (const file of files) {
        if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
          const { asset, pages } = await importPdf(file, pos, zIndex)
          assets.push(asset)
          changes.push(...pages.map((page) => ({ after: page })))
          zIndex += pages.length
          if (createPdfFrames.current) {
            const newFrames = framesForPages(pages, order)
            changes.push(...newFrames.map((frame) => ({ after: frame })))
            firstFrame ??= newFrames[0]
            order += newFrames.length
          }
          const lastPage = pages.at(-1)
          if (lastPage) pos = { x: pos.x, y: objectBounds(lastPage).maxY + 48 }
        } else {
          const { asset, image } = await importImage(file, pos, zIndex++)
          assets.push(asset)
          changes.push({ after: image })
          pos = { x: pos.x + 36, y: pos.y + 36 }
        }
      }
      applyChanges(changes, assets)
      if (firstFrame) moveToFrame(firstFrame.id)
      setMessage(files.length === 1 ? 'Arquivo adicionado à lousa.' : `${files.length} arquivos adicionados à lousa.`)
    }, 'Não foi possível importar. Use uma imagem local ou um PDF sem senha.')
  }

  function exportBoard(mode: 'frames' | 'all' | 'png') {
    void runFileOperation(async () => {
      const portable = documentRef.current?.portable()
      if (!portable) return
      const background = useSettings.getState().background === 'dark' ? '#171e2d' : '#ffffff'
      if (mode === 'png') {
        const id = frameId.current
        if (!id) { setMessage('Crie ou selecione um quadro para exportar PNG.'); return }
        download(await exportPng(portable, { frameId: id, background }), 'quadro.png')
        setMessage('PNG do quadro exportado.')
      } else {
        const { bytes, fallbackPages } = await exportPdf(portable, { scope: mode, background })
        download(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), 'lousa.pdf')
        setMessage(fallbackPages ? `PDF exportado. ${fallbackPages} páginas de origem usaram imagem em alta resolução.` : 'PDF exportado.')
      }
    }, 'Não foi possível exportar. Confira o conteúdo e os quadros da lousa.')
  }

  useEffect(() => {
    if (!confirmedCanvas.current || !liveCanvas.current) return

    const scene = new Scene()
    sceneRef.current = scene
    const isBenchmark = new URLSearchParams(location.search).has('benchmark')
    let benchmark: BenchmarkControls | undefined
    let disposed = false
    const redraw = () => controller.current?.invalidateScene()
    const imagePreview = () => new ImagePreviews(redraw, () => setMessage('Uma imagem da lousa não pôde ser exibida.'))
    let images = imagePreview()
    const pdfPreview = () => new PdfPagePreviews(redraw, () => setMessage('Não foi possível exibir uma página do PDF.'))
    let pdfs = pdfPreview()
    resetPreviews.current = () => {
      images.dispose()
      pdfs.dispose()
      images = imagePreview()
      pdfs = pdfPreview()
    }
    const board = new BoardController({
      scene,
      confirmedCanvas: confirmedCanvas.current,
      liveCanvas: liveCanvas.current,
      onCameraChange: (camera) => setZoom(camera.zoom),
      onBackgroundFrame: (metrics) => benchmark?.recordBackground(metrics),
      onInkFrame: (metrics) => benchmark?.recordInk(metrics),
      onSelectionChange: setSelection,
      getPageRaster: (page) => {
        const asset = documentRef.current?.asset(page.props.assetId)
        if (!asset) return undefined
        return page.type === 'pdfPage' ? pdfs.get(page, asset) : images.get(asset)
      },
      onChanges: (changes) => {
        const drawingFrame = useSettings.getState().tool === 'frame' ? frameName.current : ''
        let order = frameOrder()
        let created: FrameObject | undefined
        const named = changes.map((change) => {
          if (change.before || change.after?.type !== 'frame') return change
          created = {
            ...change.after,
            props: { ...change.after.props, order: order++, name: drawingFrame || change.after.props.name },
          }
          return { after: created }
        })
        try {
          applyChanges(named)
          if (created) setFrameActive(created.id)
          if (drawingFrame) {
            frameName.current = ''
            useSettings.setState({ tool: 'pen' })
          }
        } catch {
          setMessage('Não foi possível aplicar a edição. Tente outra vez.')
        }
      },
      onStrokeCommit: (stroke) => {
        if (documentRef.current) {
          documentRef.current.recordStroke(stroke)
          setMessage('')
        }
        updateHistory()
      },
    })

    controller.current = board
    const applySettings = ({ tool, stabilizer, zoomRequiresCtrl, background, favorite, favorites }: BoardSettings) => {
      board.setTool(tool)
      board.setStabilizer(stabilizer)
      board.setZoomRequiresCtrl(zoomRequiresCtrl)
      board.setStyle(favorites[favorite])
      board.setBackground(background)
    }
    applySettings(useSettings.getState())
    const unsubscribeSettings = useSettings.subscribe(applySettings)

    function handleShortcut(event: KeyboardEvent) {
      const target = event.target
      if (event.defaultPrevented || event.repeat && event.key.toLowerCase() === 'n' ||
        (target instanceof HTMLElement &&
          (target.matches('input, textarea, select') || target.isContentEditable))) return

      if (event.ctrlKey || event.metaKey) {
        switch (event.key.toLowerCase()) {
          case 'z': changeHistory(event.shiftKey ? 'redo' : 'undo'); break
          case 'y': changeHistory('redo'); break
          case 's': saveFile(event.shiftKey); break
          case 'o': openFile(); break
          case 'd': if (!board.getSelection().length) return; board.duplicateSelection(); break
          case 'c': if (!board.getSelection().length) return; copySelection(); break
          case 'x':
            if (!board.getSelection().length) return
            copySelection(true)
            break
          default: return
        }
        event.preventDefault()
        return
      }

      if (event.altKey) {
        if (!board.getSelection().length) return
        switch (event.key) {
          case 'ArrowLeft': board.moveSelection(-8, 0); break
          case 'ArrowRight': board.moveSelection(8, 0); break
          case 'ArrowUp': board.moveSelection(0, -8); break
          case 'ArrowDown': board.moveSelection(0, 8); break
          case '+':
          case '=': scaleSelection(1.1); break
          case '-': scaleSelection(1 / 1.1); break
          default: return
        }
        event.preventDefault()
        return
      }

      const key = event.key.toLowerCase()
      const toolShortcut = tools.find((option) => option.key.toLowerCase() === key)
      if (toolShortcut) {
        useSettings.setState({ tool: toolShortcut.id })
        event.preventDefault()
        return
      }
      if (/^[1-6]$/.test(key)) {
        pickFavorite(Number(key) - 1)
        event.preventDefault()
        return
      }
      switch (key) {
        case 'delete': if (board.getSelection().length) board.deleteSelection(); else return; break
        case 'escape':
          board.clearSelection()
          if (useSettings.getState().tool === 'frame') useSettings.setState({ tool: 'pen' })
          frameName.current = ''
          break
        case 'i': if (event.repeat) return; openAsset('image/*'); break
        case 'd': if (event.repeat) return; openAsset('application/pdf,.pdf'); break
        case 'n': createFrame(); break
        case 'g': {
          const options = Object.keys(backgrounds) as Background[]
          const index = options.indexOf(useSettings.getState().background)
          useSettings.setState({ background: options[(index + 1) % options.length] })
          break
        }
        case 'u': {
          const selected = board.getSelection().find((object) => object.type === 'pdfPage')
          const currentFrame = frameId.current && scene.get(frameId.current)
          const linkedPage = currentFrame && currentFrame.type === 'frame' && currentFrame.parentId
            ? scene.get(currentFrame.parentId) : undefined
          const page = selected ?? linkedPage
          if (page?.type !== 'pdfPage') return
          setPageLocked(page)
          break
        }
        case 'arrowleft':
        case 'arrowup': if (!listFrames().length) return; stepFrame(-1); break
        case 'arrowright':
        case 'arrowdown': if (!listFrames().length) return; stepFrame(1); break
        case 'enter':
          if (!frameId.current || target instanceof HTMLElement && target.closest('button, summary, a')) return
          moveToFrame()
          break
        case 'j': exportBoard('png'); break
        case 'y': if (event.repeat) return; exportBoard(event.shiftKey ? 'all' : 'frames'); break
        case 'r': if (!board.getSelection().length) return; board.rotateSelection(event.shiftKey ? -15 : 15); break
        case '+':
        case '=': board.zoomBy(1.2); break
        case '-': board.zoomBy(1 / 1.2); break
        case '0': board.setCamera({ x: 0, y: 0, zoom: 1 }); break
        default: return
      }
      event.preventDefault()
    }

    function handlePaste(event: ClipboardEvent) {
      if (fileOperation.current || !documentRef.current) return
      if (event.target instanceof HTMLElement && (event.target.matches('input, textarea') || event.target.isContentEditable)) return
      const files = Array.from(event.clipboardData?.files ?? [])
      if (files.length) { event.preventDefault(); importAssets(files); return }
      board.pasteSelection()
    }

    window.addEventListener('keydown', handleShortcut)
    window.addEventListener('paste', handlePaste)
    let unsubscribePwa: (() => void) | undefined
    if (isBenchmark) {
      setIsReady(true)
      void import('./benchmark').then(({ setupBenchmark }) => {
        if (!disposed) benchmark = setupBenchmark({ board, scene, canvas: liveCanvas.current! })
      })
    } else {
      pwa.current = registerPwa()
      unsubscribePwa = pwa.current.subscribe(setPwaState)
      void BoardDocument.open(scene, (status) => { if (!disposed) setSaveStatus(status) }).then((opened) => {
        if (disposed) { opened.close(); return }
        documentRef.current = opened
        board.invalidateScene()
        refreshObjects()
        updateHistory()
        setIsReady(true)
      })
    }

    const flushOnHide = () => {
      if (document.visibilityState === 'hidden') void documentRef.current?.flush().catch(() => {})
    }
    document.addEventListener('visibilitychange', flushOnHide)

    return () => {
      disposed = true
      benchmark?.destroy()
      unsubscribePwa?.()
      pwa.current?.destroy()
      documentRef.current?.close()
      documentRef.current = null
      document.removeEventListener('visibilitychange', flushOnHide)
      window.removeEventListener('keydown', handleShortcut)
      window.removeEventListener('paste', handlePaste)
      images.dispose()
      pdfs.dispose()
      resetPreviews.current = null
      sceneRef.current = null
      unsubscribeSettings()
      board.destroy()
      controller.current = null
    }
  }, [])

  return (
    <main className="app">
      <header className="toolbar">
        <h1>Lousa</h1>
        <details className="file-menu" ref={fileMenu}>
          <summary aria-label="Arquivo">Arquivo</summary>
          <div className="file-actions">
            <button type="button" disabled={fileBusy || !isReady} onClick={() => openFile()}>Abrir lousa</button>
            <button type="button" disabled={fileBusy || !isReady} onClick={() => saveFile()}>Salvar lousa</button>
            <button type="button" disabled={fileBusy || !isReady} onClick={() => openFile(true)}>Abrir via upload</button>
            <button type="button" disabled={fileBusy || !isReady} onClick={() => saveFile(true)}>Baixar cópia</button>
            <hr />
            <button type="button" disabled={fileBusy || !isReady} onClick={() => openAsset('image/*')} title="I">Inserir imagem</button>
            <button type="button" disabled={fileBusy || !isReady} onClick={() => openAsset('application/pdf,.pdf')} title="D">Importar PDF</button>
            <hr />
            <button type="button" disabled={fileBusy || !frames.length} onClick={() => exportBoard('frames')} title="Y">Exportar quadros em PDF</button>
            <button type="button" disabled={fileBusy || !isReady} onClick={() => exportBoard('all')} title="Shift+Y">Exportar tudo em PDF</button>
            <button type="button" disabled={fileBusy || !activeFrame} onClick={() => exportBoard('png')} title="J">Exportar quadro em PNG</button>
          </div>
        </details>
        <input ref={fileInput} hidden type="file" accept=".board,application/zip"
          aria-label="Arquivo de lousa" onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void runFileOperation(async () => {
              await replaceDocument(await decodeFromFile(file), file.name)
            }, 'Não foi possível abrir o arquivo. A lousa atual foi preservada.')
          }} />
        <input hidden type="file" ref={assetInput} multiple aria-label="Imagem ou PDF" onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          importAssets(files)
        }} />
        <div className="history-group" role="group" aria-label="Histórico">
          <button type="button" aria-label="Desfazer" title="Desfazer (Ctrl+Z)" disabled={!history.undo || fileBusy}
            onClick={() => changeHistory('undo')}>↶</button>
          <button type="button" aria-label="Refazer" title="Refazer (Ctrl+Y)" disabled={!history.redo || fileBusy}
            onClick={() => changeHistory('redo')}>↷</button>
        </div>
        <details className="file-menu">
          <summary title="Ações da seleção">Editar</summary>
          <div className="file-actions">
            <button type="button" disabled={!selection.length} onClick={() => copySelection()} title="Ctrl+C">Copiar</button>
            <button type="button" disabled={!selection.length} onClick={() => copySelection(true)} title="Ctrl+X">Recortar</button>
            <button type="button" onClick={() => controller.current?.pasteSelection()} title="Ctrl+V">Colar seleção</button>
            <button type="button" disabled={!selection.length} onClick={() => controller.current?.duplicateSelection()} title="Ctrl+D">Duplicar</button>
            <button type="button" disabled={!selection.length} onClick={() => controller.current?.rotateSelection(15)} title="R">Girar 15°</button>
            <button type="button" disabled={!selection.length} onClick={() => controller.current?.deleteSelection()} title="Delete">Excluir</button>
          </div>
        </details>
        <details className="file-menu">
          <summary>Quadros</summary>
          <div className="file-actions frame-actions">
            <button type="button" disabled={!isReady || fileBusy} onClick={createFrame} title="N">Criar quadro 16:9</button>
            <button type="button" disabled={!activeFrame} onClick={() => moveToFrame()} title="Enter">Enquadrar quadro</button>
            <label className="check-option"><input type="checkbox" defaultChecked onChange={(event) => { createPdfFrames.current = event.target.checked }} />Criar um quadro por página de PDF</label>
            {pdfPages.length > 0 && <div className="pdf-page-actions" aria-label="Páginas PDF">
              {pdfPages.map((page, index) => <button key={page.id} type="button" onClick={() => setPageLocked(page)}>
                {page.locked ? 'Destravar' : 'Travar'} página {index + 1}
              </button>)}
            </div>}
          </div>
        </details>
        <label className="background-setting">Fundo
          <select value={background} title="Alternar fundo (G)" onChange={(event) => useSettings.setState({ background: event.target.value as Background })}>
            {Object.entries(backgrounds).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
          </select>
        </label>
        <div className="stabilizer">
          <label htmlFor="stabilizer">Estabilizador</label>
          <input id="stabilizer" type="range" min="0" max="100" value={stabilizer}
            onChange={(event) => useSettings.setState({ stabilizer: Number(event.target.value) })} />
          <output htmlFor="stabilizer">{stabilizer}</output>
        </div>
      </header>

      <div className={`workspace dock-${dock}`}>
        <Tools dock={dock} tool={tool} favorite={favorite} favorites={favorites}
          onDock={(position) => useSettings.setState({ dock: position })}
          onTool={(next) => useSettings.setState({ tool: next })} onFavorite={pickFavorite} onEditFavorite={editFavorite} />
        <section className="surface" aria-label="Área de desenho" aria-busy={!isReady || fileBusy}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }} onDrop={(event) => {
            event.preventDefault()
            const board = controller.current
            const rect = event.currentTarget.getBoundingClientRect()
            const pos = board ? screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, board.getCamera(), board.getViewport()) : undefined
            importAssets(Array.from(event.dataTransfer.files), pos)
          }}>
          <canvas ref={confirmedCanvas} aria-hidden="true" />
          <canvas ref={liveCanvas} className="live-surface" data-tool={tool}
            aria-label="Lousa interativa" tabIndex={0} />
        </section>
      </div>

      <footer className="status-bar">
        {frames.length > 0 && <div className="frame-navigation" role="group" aria-label="Navegar pelos quadros">
          <button type="button" aria-label="Quadro anterior" title="Seta para esquerda" onClick={() => stepFrame(-1)}>‹</button>
          <select aria-label="Quadro atual" value={activeFrame ?? ''} onChange={(event) => moveToFrame(event.target.value)}>
            {frames.map(({ id, props }) => <option key={id} value={id}>{props.name}</option>)}
          </select>
          <button type="button" aria-label="Próximo quadro" title="Seta para direita" onClick={() => stepFrame(1)}>›</button>
        </div>}
        <div className="document-status" role="status" data-save-status={saveStatus}>
          {message || ({ saved: 'Salvo neste navegador', saving: 'Salvando…',
            error: 'Falha ao salvar no navegador. Baixe uma cópia.', recovering: 'Abrindo a lousa…' })[saveStatus]}
        </div>
        <div className="pwa-group" data-offline={pwaState.offline}>
          {pwaState.offline === 'ready' && <span>Pronto offline</span>}
          {pwaState.canInstall && <button type="button" onClick={() => {
            void pwa.current?.install().catch(() => setMessage('Não foi possível instalar a lousa.'))
          }}>Instalar</button>}
          {pwaState.updateAvailable && <button type="button" disabled={fileBusy} onClick={() => {
            void runFileOperation(async () => {
              await pwa.current?.activateUpdate(async () => { await documentRef.current?.flush() })
            }, 'Salve uma cópia antes de atualizar a lousa.')
          }}>Atualizar</button>}
        </div>
        <label className="scroll-setting">
          <input type="checkbox" checked={zoomRequiresCtrl}
            onChange={(event) => useSettings.setState({ zoomRequiresCtrl: event.target.checked })} />
          Exigir Ctrl para zoom
        </label>
        <div className="zoom-group" role="group" aria-label="Zoom">
          <button type="button" aria-label="Diminuir zoom" onClick={() => controller.current?.zoomBy(1 / 1.2)}>−</button>
          <button type="button" aria-label="Voltar à origem e ao zoom de 100%"
            title="Voltar à origem (0)" onClick={() => controller.current?.setCamera({ x: 0, y: 0, zoom: 1 })}>
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" aria-label="Aumentar zoom" onClick={() => controller.current?.zoomBy(1.2)}>+</button>
        </div>
      </footer>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Board />)
