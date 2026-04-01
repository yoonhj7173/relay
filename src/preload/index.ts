import { contextBridge, ipcRenderer } from 'electron'

export type Settings = {
  notionConnected: boolean
  notionToken: string | null
  selectedBoard: string | null
  frequency: string
  checkBeforeUpdating: boolean
  aiProvider: 'claude' | 'ollama'
  whitelistedApps: string[]
  lastUpdated: string | null
}

export type AppInfo = {
  pid: number
  app: string
}

contextBridge.exposeInMainWorld('relay', {
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Settings): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('settings:save', settings),
  connectNotion: (): Promise<{ status: string }> => ipcRenderer.invoke('notion:connect'),
  writeToNotion: (pageId: string, draft: string): Promise<{ status: string }> =>
    ipcRenderer.invoke('notion:write', { pageId, draft }),
  listApps: (): Promise<AppInfo[]> => ipcRenderer.invoke('apps:list'),
  setWhitelist: (apps: string[]): Promise<{ status: string }> =>
    ipcRenderer.invoke('apps:setWhitelist', apps),
  triggerSnapshot: (): Promise<{ status: string; draft?: string }> =>
    ipcRenderer.invoke('snapshot:trigger'),
  onNotionConnected: (callback: () => void) => ipcRenderer.on('notion:connected', callback),
  onSnapshotReady: (callback: (draft: string) => void) =>
    ipcRenderer.on('snapshot:ready', (_event, draft) => callback(draft)),
  setHeight: (height: number) => ipcRenderer.send('window:setHeight', height),
  quit: () => ipcRenderer.send('app:quit'),
})
