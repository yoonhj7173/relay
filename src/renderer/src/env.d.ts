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

declare global {
  interface Window {
    relay: {
      getSettings: () => Promise<Settings>
      saveSettings: (settings: Settings) => Promise<{ success: boolean }>
      connectNotion: () => Promise<{ status: string }>
      writeToNotion: (pageId: string, draft: string) => Promise<{ status: string }>
      listApps: () => Promise<AppInfo[]>
      setWhitelist: (apps: string[]) => Promise<{ status: string }>
      triggerSnapshot: () => Promise<{ status: string; draft?: string }>
      onNotionConnected: (callback: () => void) => void
      onSnapshotReady: (callback: (draft: string) => void) => void
      setHeight: (height: number) => void
      quit: () => void
    }
  }
}
