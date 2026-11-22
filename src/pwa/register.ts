export interface PwaState {
  offline: 'loading' | 'ready' | 'unavailable'
  canInstall: boolean
  updateAvailable: boolean
}

export interface PwaControls {
  subscribe(listener: (state: PwaState) => void): () => void
  install(): Promise<boolean>
  activateUpdate(beforeReload: () => Promise<void>): Promise<void>
  destroy(): void
}

interface InstallPrompt extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function registerPwa(): PwaControls {
  const listeners = new Set<(state: PwaState) => void>()
  const lifecycle = new AbortController()
  const { signal } = lifecycle
  const workers = navigator.serviceWorker
  let registration: ServiceWorkerRegistration | undefined
  let installPrompt: InstallPrompt | undefined
  let preparingUpdate = false
  let reloadOnActivation = false
  let state: PwaState = {
    offline: workers?.controller ? 'ready' : workers ? 'loading' : 'unavailable',
    canInstall: false,
    updateAvailable: false,
  }

  function publish(changes: Partial<PwaState>): void {
    const next = { ...state, ...changes }
    if (next.offline === state.offline && next.canInstall === state.canInstall &&
      next.updateAvailable === state.updateAvailable) return

    state = next
    for (const listener of listeners) listener(state)
  }

  function refreshState(): void {
    publish({
      offline: workers.controller ? 'ready' : state.offline,
      updateAvailable: Boolean(registration?.waiting && workers.controller),
    })
  }

  function observe(worker: ServiceWorker | null): void {
    worker?.addEventListener('statechange', () => {
      refreshState()
      if (worker.state === 'redundant' && !workers.controller && !registration?.installing) {
        publish({ offline: 'unavailable' })
      }
    }, { signal })
  }

  if (workers) {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault()
      installPrompt = event as InstallPrompt
      publish({ canInstall: true })
    }, { signal })

    window.addEventListener('appinstalled', () => {
      installPrompt = undefined
      publish({ canInstall: false })
    }, { signal })

    workers.addEventListener('controllerchange', () => {
      refreshState()
      if (reloadOnActivation) window.location.reload()
    }, { signal })

    void workers.register(new URL('./sw.js', document.baseURI), { updateViaCache: 'none' }).then((result) => {
      if (signal.aborted) return
      registration = result
      registration.addEventListener('updatefound', () => observe(result.installing), { signal })
      observe(result.installing)
      refreshState()
    }).catch(() => publish({ offline: workers.controller ? 'ready' : 'unavailable' }))
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },

    async install() {
      const prompt = installPrompt
      if (!prompt) return false
      installPrompt = undefined
      publish({ canInstall: false })
      return (await prompt.prompt()).outcome === 'accepted'
    },

    async activateUpdate(beforeReload) {
      if (!registration?.waiting || preparingUpdate || reloadOnActivation) return
      preparingUpdate = true
      try {
        await beforeReload()
        if (!registration.waiting || signal.aborted) return
        reloadOnActivation = true
        registration.waiting.postMessage('activate-update')
      } catch (error) {
        reloadOnActivation = false
        throw error
      } finally {
        preparingUpdate = false
      }
    },

    destroy() {
      lifecycle.abort()
      listeners.clear()
    },
  }
}
