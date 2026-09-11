import { createApp } from 'vue'
import App from './App.vue'
import type { HostApi } from './hostApi'

export type MountOptions = {
  onEvent?: (msg: Record<string, unknown>) => void
}

/** Inline mount for Design Board — same document, no nested iframe / postMessage bridge. */
export async function mountBndzOpenPencil(container: HTMLElement, opts?: MountOptions): Promise<HostApi> {
  container.replaceChildren()
  const mountPoint = document.createElement('div')
  mountPoint.className = 'bndz-op-inline-root'
  mountPoint.style.width = '100%'
  mountPoint.style.height = '100%'
  container.appendChild(mountPoint)

  return new Promise((resolve, reject) => {
    const app = createApp(App, {
      inlineHost: true,
      onHostEvent: (msg: Record<string, unknown>) => opts?.onEvent?.(msg),
      onApiReady: (api: HostApi) => {
        ;(window as any).__BNDZ_OP_ENGINE__ = api
        resolve(api)
      },
      onBootError: (message: string) => reject(new Error(message)),
    })
    app.mount(mountPoint)
  })
}
