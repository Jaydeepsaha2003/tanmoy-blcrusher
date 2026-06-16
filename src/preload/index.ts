import { contextBridge, ipcRenderer } from 'electron'

const api = {
  call: <T = unknown>(method: string, payload?: unknown): Promise<T> =>
    ipcRenderer.invoke('api', method, payload) as Promise<T>
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (fallback)
  window.api = api
}

export type Api = typeof api
