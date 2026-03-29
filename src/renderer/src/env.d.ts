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

declare global {
  interface Window {
    relay: {
      getSettings: () => Promise<Settings>
      saveSettings: (settings: Settings) => Promise<{ success: boolean }>
      connectNotion: () => Promise<{ status: string }>
      listWindows: () => Promise<WindowInfo[]>
      selectWindow: (window: WindowInfo) => Promise<{ status: string }>
      triggerSnapshot: () => Promise<{ status: string; draft?: string }>
      onNotionConnected: (callback: () => void) => void
      setHeight: (height: number) => void
      quit: () => void
    }
  }
}
