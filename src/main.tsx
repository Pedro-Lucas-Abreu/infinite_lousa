import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { create } from 'zustand'
import { BoardController } from './canvas/controller'
import { Scene } from './core/scene'
import { BoardDocument } from './documents/store'
import { decodeFromFile, openBoardFile, saveBoardFile } from './documents/files'
import { registerPwa } from './pwa/register'
import type { BenchmarkControls } from './benchmark'
import type { PortableBoard } from './documents/archive'
import type { SaveStatus } from './documents/store'
import type { PwaControls, PwaState } from './pwa/register'
import './styles.css'

type Tool = 'pen' | 'hand'

interface BoardSettings {
  tool: Tool
  stabilizer: number
  zoomRequiresCtrl: boolean
}

const useSettings = create<BoardSettings>(() => ({
  tool: 'pen',
  stabilizer: 35,
  zoomRequiresCtrl: false,
}))

function Board() {
  const confirmedCanvas = useRef<HTMLCanvasElement>(null)
  const liveCanvas = useRef<HTMLCanvasElement>(null)
  const controller = useRef<BoardController | null>(null)
  const documentRef = useRef<BoardDocument | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const fileMenu = useRef<HTMLDetailsElement>(null)
  const pwa = useRef<PwaControls | null>(null)
  const fileOperation = useRef(false)
  const filename = useRef('lousa.board')
  const [saveStatus, setSaveStatus] = useState<SaveStatus | 'recovering'>('recovering')
  const [isReady, setIsReady] = useState(false)
  const [message, setMessage] = useState('')
  const [fileBusy, setFileBusy] = useState(false)
  const [history, setHistory] = useState({ undo: false, redo: false })
  const [pwaState, setPwaState] = useState<PwaState>({ offline: 'loading', canInstall: false, updateAvailable: false })
  const [zoom, setZoom] = useState(1)
  const { tool, stabilizer, zoomRequiresCtrl } = useSettings()

  function updateHistory() {
    const boardDocument = documentRef.current
    setHistory({ undo: Boolean(boardDocument?.canUndo), redo: Boolean(boardDocument?.canRedo) })
  }

  function changeHistory(action: 'undo' | 'redo') {
    if (fileOperation.current || !documentRef.current?.[action]()) return
    controller.current?.invalidateScene()
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
    filename.current = name
    controller.current?.setCamera({ x: 0, y: 0, zoom: 1 })
    controller.current?.invalidateScene()
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

  useEffect(() => {
    if (!confirmedCanvas.current || !liveCanvas.current) return

    const scene = new Scene()
    const isBenchmark = new URLSearchParams(location.search).has('benchmark')
    let benchmark: BenchmarkControls | undefined
    let disposed = false
    const board = new BoardController({
      scene,
      confirmedCanvas: confirmedCanvas.current,
      liveCanvas: liveCanvas.current,
      onCameraChange: (camera) => setZoom(camera.zoom),
      onBackgroundFrame: (metrics) => benchmark?.recordBackground(metrics),
      onInkFrame: (metrics) => benchmark?.recordInk(metrics),
      onStrokeCommit: (stroke) => {
        if (documentRef.current) {
          documentRef.current.recordStroke(stroke)
          setMessage('')
        }
        updateHistory()
      },
    })

    controller.current = board
    board.setStyle({ color: '#192038', size: 3.5 })
    const applySettings = ({ tool, stabilizer, zoomRequiresCtrl }: BoardSettings) => {
      board.setTool(tool)
      board.setStabilizer(stabilizer)
      board.setZoomRequiresCtrl(zoomRequiresCtrl)
    }
    applySettings(useSettings.getState())
    const unsubscribeSettings = useSettings.subscribe(applySettings)

    function handleShortcut(event: KeyboardEvent) {
      const target = event.target
      if (event.defaultPrevented || event.altKey ||
        (target instanceof HTMLElement &&
          (target.matches('input, textarea, select') || target.isContentEditable))) return

      if (event.ctrlKey || event.metaKey) {
        switch (event.key.toLowerCase()) {
          case 'z': changeHistory(event.shiftKey ? 'redo' : 'undo'); break
          case 'y': changeHistory('redo'); break
          case 's': saveFile(); break
          case 'o': openFile(); break
          default: return
        }
        event.preventDefault()
        return
      }

      switch (event.key.toLowerCase()) {
        case 'p': useSettings.setState({ tool: 'pen' }); break
        case 'm': useSettings.setState({ tool: 'hand' }); break
        case '+':
        case '=': board.zoomBy(1.2); break
        case '-': board.zoomBy(1 / 1.2); break
        case '0': board.setCamera({ x: 0, y: 0, zoom: 1 }); break
        default: return
      }
      event.preventDefault()
    }

    window.addEventListener('keydown', handleShortcut)
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
        <div className="history-group" role="group" aria-label="Histórico">
          <button type="button" aria-label="Desfazer" title="Desfazer (Ctrl+Z)" disabled={!history.undo || fileBusy}
            onClick={() => changeHistory('undo')}>↶</button>
          <button type="button" aria-label="Refazer" title="Refazer (Ctrl+Y)" disabled={!history.redo || fileBusy}
            onClick={() => changeHistory('redo')}>↷</button>
        </div>
        <div className="tool-group" role="group" aria-label="Ferramentas">
          <button type="button" aria-pressed={tool === 'pen'} aria-keyshortcuts="P"
            title="Caneta (P)" onClick={() => useSettings.setState({ tool: 'pen' })}>
            <span className="pen-icon" aria-hidden="true" />Caneta
          </button>
          <button type="button" aria-pressed={tool === 'hand'} aria-keyshortcuts="M"
            title="Mão (M)" onClick={() => useSettings.setState({ tool: 'hand' })}>
            <span className="hand-icon" aria-hidden="true">✥</span>Mão
          </button>
        </div>
        <div className="stabilizer">
          <label htmlFor="stabilizer">Estabilizador</label>
          <input id="stabilizer" type="range" min="0" max="100" value={stabilizer}
            onChange={(event) => useSettings.setState({ stabilizer: Number(event.target.value) })} />
          <output htmlFor="stabilizer">{stabilizer}</output>
        </div>
      </header>

      <section className="surface" aria-label="Área de desenho" aria-busy={!isReady || fileBusy}>
        <canvas ref={confirmedCanvas} aria-hidden="true" />
        <canvas ref={liveCanvas} className="live-surface" data-tool={tool}
          aria-label="Lousa interativa" tabIndex={0} />
      </section>

      <footer className="status-bar">
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
