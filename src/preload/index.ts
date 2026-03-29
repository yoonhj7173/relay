import { contextBridge, ipcRenderer } from 'electron'

export type Settings = {
  notionConnected: boolean
  notionToken: string | null
  selectedBoard: string | null
  frequency: string
  checkBeforeUpdating: boolean
  aiProvider: 'claude' | 'ollama'
  windowSelected: boolean
  selectedWindowId: string | null
  selectedWindowTitle: string | null
  lastUpdated: string | null
}

export type WindowInfo = {
  id: string
  name: string
  thumbnail: string
}

contextBridge.exposeInMainWorld('relay', {
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Settings): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('settings:save', settings),
  connectNotion: (): Promise<{ status: string }> => ipcRenderer.invoke('notion:connect'),
  listWindows: (): Promise<WindowInfo[]> => ipcRenderer.invoke('window:list'),
  selectWindow: (window: WindowInfo): Promise<{ status: string }> =>
    ipcRenderer.invoke('window:select', window),
  triggerSnapshot: (): Promise<{ status: string; draft?: string }> =>
    ipcRenderer.invoke('snapshot:trigger'),
  onNotionConnected: (callback: () => void) => ipcRenderer.on('notion:connected', callback),
  setHeight: (height: number) => ipcRenderer.send('window:setHeight', height),
  quit: () => ipcRenderer.send('app:quit'),
})
