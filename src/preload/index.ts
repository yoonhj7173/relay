import { contextBridge, ipcRenderer } from 'electron'

export type Settings = {
  notionConnected: boolean
  notionToken: string | null
  selectedBoard: string | null
  frequency: string
  checkBeforeUpdating: boolean
  aiProvider: 'claude' | 'ollama'
  whitelistedApps: string[]
  activeCards: { id: string; title: string }[]
  lastUpdated: string | null
}

export type AppInfo = {
  pid: number
  app: string
}

export type NotionCard = {
  id: string
  title: string
}

export type DraftItem = {
  cardId: string
  cardTitle: string
  text: string
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
  triggerSnapshot: (): Promise<{ status: string; drafts?: DraftItem[]; unreadableApps?: string[] }> =>
    ipcRenderer.invoke('snapshot:trigger'),
  getNotionCards: (): Promise<NotionCard[]> =>
    ipcRenderer.invoke('notion:getCards'),
  getDatabases: (): Promise<{ id: string; title: string }[]> =>
    ipcRenderer.invoke('notion:getDatabases'),
  onNotionConnected: (callback: () => void) => ipcRenderer.on('notion:connected', callback),
  onSnapshotReady: (callback: (payload: { drafts: DraftItem[]; unreadableApps: string[] }) => void) =>
    ipcRenderer.on('snapshot:ready', (_event, payload) => callback(payload)),
  setHeight: (height: number) => ipcRenderer.send('window:setHeight', height),
  quit: () => ipcRenderer.send('app:quit'),
  checkAccessibility: (): Promise<boolean> => ipcRenderer.invoke('accessibility:check'),
  openAccessibilitySettings: () => ipcRenderer.send('accessibility:openSettings'),
  getDrafts: (): Promise<DraftItem[]> => ipcRenderer.invoke('drafts:get'),
  clearDrafts: () => ipcRenderer.send('drafts:clear'),
})
