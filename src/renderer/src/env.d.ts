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

declare global {
  interface Window {
    relay: {
      getSettings: () => Promise<Settings>
      saveSettings: (settings: Settings) => Promise<{ success: boolean }>
      connectNotion: () => Promise<{ status: string }>
      writeToNotion: (pageId: string, draft: string) => Promise<{ status: string }>
      listApps: () => Promise<AppInfo[]>
      setWhitelist: (apps: string[]) => Promise<{ status: string }>
      triggerSnapshot: () => Promise<{ status: string; drafts?: DraftItem[]; unreadableApps?: string[] }>
      getNotionCards: () => Promise<NotionCard[]>
      getDatabases: () => Promise<{ id: string; title: string }[]>
      onNotionConnected: (callback: () => void) => void
      onSnapshotReady: (callback: (payload: { drafts: DraftItem[]; unreadableApps: string[] }) => void) => void
      setHeight: (height: number) => void
      quit: () => void
      checkAccessibility: () => Promise<boolean>
      openAccessibilitySettings: () => void
      getDrafts: () => Promise<DraftItem[]>
      clearDrafts: () => void
    }
  }
}
