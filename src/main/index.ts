import { app, BrowserWindow, Tray, nativeImage, ipcMain, screen, shell, Notification, systemPreferences, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { createServer } from 'http'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { is } from '@electron-toolkit/utils'

const execFileAsync = promisify(execFile)

let tray: Tray | null = null
let win: BrowserWindow | null = null
let snapshotTimer: ReturnType<typeof setInterval> | null = null

const FREQUENCY_MS: Record<string, number> = {
  '1 hour':    1 * 60 * 60 * 1000,
  '2 hours':   2 * 60 * 60 * 1000,
  '4 hours':   4 * 60 * 60 * 1000,
  '6 hours':   6 * 60 * 60 * 1000,
  'End of day': 8 * 60 * 60 * 1000,
}

// ── Settings persistence ──────────────────────────────────────────────────────

const SETTINGS_PATH = join(app.getPath('userData'), 'settings.json')

const DEFAULT_SETTINGS = {
  notionConnected: false,
  notionToken: null as string | null,
  selectedBoard: null as string | null,
  frequency: 'End of day',
  checkBeforeUpdating: true,
  aiProvider: 'claude' as 'claude' | 'ollama',
  whitelistedApps: [] as string[],           // app names user wants to monitor
  activeCards: [] as { id: string; title: string }[],
  anthropicKey: import.meta.env.MAIN_VITE_ANTHROPIC_KEY as string,
  lastUpdated: null as string | null,
}

type Settings = typeof DEFAULT_SETTINGS

// Sensitive fields encrypted at rest via macOS Keychain (safeStorage).
// Stored on disk as "enc:<base64>". Plain values are migrated on first read.
const ENC_PREFIX = 'enc:'

function encrypt(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) return value
  return ENC_PREFIX + safeStorage.encryptString(value).toString('base64')
}

function decrypt(value: string): string {
  if (!value.startsWith(ENC_PREFIX)) return value  // plaintext — migrate on next save
  if (!safeStorage.isEncryptionAvailable()) return value
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    return ''
  }
}

function loadSettings(): Settings {
  try {
    if (existsSync(SETTINGS_PATH)) {
      const raw = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')) as Partial<Settings> & {
        notionToken?: string | null
        anthropicKey?: string
      }
      return {
        ...DEFAULT_SETTINGS,
        ...raw,
        notionToken: raw.notionToken ? decrypt(raw.notionToken) : null,
        anthropicKey: raw.anthropicKey ? decrypt(raw.anthropicKey) : DEFAULT_SETTINGS.anthropicKey,
      }
    }
  } catch {
    // ignore parse errors, fall back to defaults
  }
  return { ...DEFAULT_SETTINGS }
}

function persistSettings(settings: Settings): void {
  try {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const toWrite = {
      ...settings,
      notionToken: settings.notionToken ? encrypt(settings.notionToken) : null,
      anthropicKey: settings.anthropicKey ? encrypt(settings.anthropicKey) : '',
    }
    writeFileSync(SETTINGS_PATH, JSON.stringify(toWrite, null, 2))
  } catch (e) {
    console.error('Failed to save settings:', e)
  }
}

// ── Draft persistence ─────────────────────────────────────────────────────────

const DRAFTS_PATH = join(app.getPath('userData'), 'last-drafts.json')

function saveDrafts(drafts: DraftItem[]): void {
  try { writeFileSync(DRAFTS_PATH, JSON.stringify(drafts), 'utf-8') } catch { /* ignore */ }
}

function loadDrafts(): DraftItem[] {
  try {
    if (existsSync(DRAFTS_PATH)) return JSON.parse(readFileSync(DRAFTS_PATH, 'utf-8')) as DraftItem[]
  } catch { /* ignore */ }
  return []
}

function clearDrafts(): void {
  try { if (existsSync(DRAFTS_PATH)) unlinkSync(DRAFTS_PATH) } catch { /* ignore */ }
}

// ── Snapshot persistence ──────────────────────────────────────────────────────

const SNAPSHOT_PATH      = join(app.getPath('userData'), 'last-snapshot.txt')
const SNAPSHOT_TIME_PATH = join(app.getPath('userData'), 'last-snapshot-time.txt')

function loadLastSnapshot(): string {
  try {
    if (existsSync(SNAPSHOT_PATH)) return readFileSync(SNAPSHOT_PATH, 'utf-8')
  } catch { /* ignore */ }
  return ''
}

function loadLastSnapshotTime(): Date | null {
  try {
    if (existsSync(SNAPSHOT_TIME_PATH))
      return new Date(readFileSync(SNAPSHOT_TIME_PATH, 'utf-8').trim())
  } catch { /* ignore */ }
  return null
}

function saveSnapshot(text: string): void {
  writeFileSync(SNAPSHOT_PATH, text, 'utf-8')
  writeFileSync(SNAPSHOT_TIME_PATH, new Date().toISOString(), 'utf-8')
}

function clearSnapshot(): void {
  try { if (existsSync(SNAPSHOT_PATH)) unlinkSync(SNAPSHOT_PATH) } catch { /* ignore */ }
  try { if (existsSync(SNAPSHOT_TIME_PATH)) unlinkSync(SNAPSHOT_TIME_PATH) } catch { /* ignore */ }
}

function formatTimePeriod(start: Date | null, end: Date): string {
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' }
  const dateOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
  const endStr  = end.toLocaleTimeString('en-US', timeOpts)
  const dateStr = end.toLocaleDateString('en-US', dateOpts)
  if (!start) return `Progress Update – ${endStr}, ${dateStr}`
  const startStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `Progress Update – ${startStr} – ${endStr}, ${dateStr}`
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

function startScheduler(frequencyMs: number): void {
  if (snapshotTimer) clearInterval(snapshotTimer)
  snapshotTimer = setInterval(async () => {
    const settings = loadSettings()
    if (settings.whitelistedApps.length === 0 || settings.activeCards.length === 0) return
    try {
      const { text, unreadableApps } = await readWhitelistedApps(settings.whitelistedApps)
      if (!text) return
      const previous = loadLastSnapshot()
      const formatSample = settings.notionToken && settings.selectedBoard
        ? await fetchFormatSample(settings.notionToken, settings.selectedBoard)
        : ''
      const drafts = await generateDrafts(text, previous, settings.activeCards, formatSample, settings.anthropicKey)
      saveSnapshot(text)
      saveDrafts(drafts)
      win?.webContents.send('snapshot:ready', { drafts, unreadableApps })
      new Notification({
        title: 'Relay',
        body: 'Progress update ready — click to review',
      }).show()
    } catch (e) {
      console.error('Scheduled snapshot failed:', e)
    }
  }, frequencyMs)
}

function stopScheduler(): void {
  if (snapshotTimer) {
    clearInterval(snapshotTimer)
    snapshotTimer = null
  }
}

// ── Notion OAuth ──────────────────────────────────────────────────────────────

const NOTION_CLIENT_ID = import.meta.env.MAIN_VITE_NOTION_CLIENT_ID as string
const NOTION_CLIENT_SECRET = import.meta.env.MAIN_VITE_NOTION_CLIENT_SECRET as string
const NOTION_REDIRECT_URI = 'http://localhost:3476/callback'

async function exchangeNotionCode(code: string): Promise<void> {
  const credentials = Buffer.from(`${NOTION_CLIENT_ID}:${NOTION_CLIENT_SECRET}`).toString('base64')

  const response = await fetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: NOTION_REDIRECT_URI,
    }),
  })

  const data = (await response.json()) as { access_token?: string; error?: string }

  if (data.access_token) {
    const settings = loadSettings()
    persistSettings({ ...settings, notionConnected: true, notionToken: data.access_token })
    win?.webContents.send('notion:connected')
  } else {
    console.error('Notion token exchange failed:', data.error)
  }
}

function startOAuthServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const code = new URL(req.url!, 'http://localhost:3476').searchParams.get('code')
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body><p>Connected to Notion. You can close this tab.</p></body></html>')
      server.close()
      if (code) resolve(code)
      else reject(new Error('No code in callback'))
    })

    server.listen(3476, '127.0.0.1', () => {
      const params = new URLSearchParams({
        client_id: NOTION_CLIENT_ID,
        response_type: 'code',
        owner: 'user',
        redirect_uri: NOTION_REDIRECT_URI,
      })
      shell.openExternal(`https://api.notion.com/v1/oauth/authorize?${params}`)
    })

    server.on('error', reject)
  })
}

// ── Notion write ──────────────────────────────────────────────────────────────

async function appendToNotionCard(pageId: string, draft: string, token: string): Promise<void> {
  const start = loadLastSnapshotTime()
  const title = formatTimePeriod(start, new Date())
  const lines = draft.split('\n').map((l) => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean)

  const children = [
    {
      type: 'heading_3',
      heading_3: {
        rich_text: [{ type: 'text', text: { content: title } }],
      },
    },
    ...lines.map((line) => ({
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [{ type: 'text', text: { content: line } }],
      },
    })),
  ]

  const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ children }),
  })

  if (!res.ok) {
    const err = (await res.json()) as { message: string }
    throw new Error(err.message)
  }
}

// ── AI ────────────────────────────────────────────────────────────────────────

type DraftItem = { cardId: string; cardTitle: string; text: string }

async function fetchFormatSample(token: string, databaseId: string): Promise<string> {
  try {
    const queryRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page_size: 2, sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] }),
    })
    const queryData = (await queryRes.json()) as { results: Array<{ id: string }> }

    const samples: string[] = []
    for (const page of queryData.results) {
      const blocksRes = await fetch(`https://api.notion.com/v1/blocks/${page.id}/children`, {
        headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' },
      })
      const blocksData = (await blocksRes.json()) as {
        results: Array<{ type: string } & Record<string, unknown>>
      }
      const text = blocksData.results
        .map((b) => {
          const content = b[b.type] as { rich_text?: Array<{ plain_text: string }> } | undefined
          return content?.rich_text?.map((t) => t.plain_text).join('') ?? ''
        })
        .filter(Boolean)
        .join('\n')
      if (text) samples.push(text)
    }
    return samples.join('\n\n---\n\n')
  } catch {
    return ''
  }
}

async function generateDrafts(
  text: string,
  previous: string,
  activeCards: { id: string; title: string }[],
  formatSample: string,
  apiKey: string,
): Promise<DraftItem[]> {
  const diffSection = previous
    ? `Previous snapshot (what was there before):\n${previous.slice(0, 3000)}\n\nCurrent snapshot (what's there now):\n${text.slice(0, 3000)}`
    : `Current snapshot:\n${text.slice(0, 6000)}`

  const formatSection = formatSample
    ? `Format reference — this is how the team writes updates (follow this style and structure):\n${formatSample.slice(0, 1500)}\n\n`
    : ''

  const cardList = activeCards.map((c, i) => `${i + 1}. "${c.title}" (id: ${c.id})`).join('\n')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `You are helping a team member write progress updates for their team board.

${formatSection}Active cards today:
${cardList}

Based on the app content below, write a progress update for each card that has relevant activity. If a card has no relevant activity, omit it from the response.

Rules:
1. LENGTH: Let actual activity determine length. Short if little happened, longer if a lot did.
2. STRUCTURE: Bullet points for what was done. Only add "Next steps", "Action items", "ETA", or "Recommendations" sections if the content clearly supports them.
3. Be specific and factual — only use what's in the content. No fabrication.
4. Match the format and style of the format reference if provided.

Respond with a JSON array only — no markdown, no explanation:
[{"cardId": "...", "draft": "..."}]

${diffSection}`,
        },
      ],
    }),
  })

  const data = (await response.json()) as {
    content: { text: string }[]
    error?: { message: string }
  }

  if (data.error) throw new Error(data.error.message)

  const raw = data.content[0].text
  const start = raw.indexOf('[')
  if (start === -1) throw new Error('No JSON array in Claude response')
  let depth = 0
  let end = -1
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === '[') depth++
    else if (raw[i] === ']') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end === -1) throw new Error('Unclosed JSON array in Claude response')
  const parsed = JSON.parse(raw.slice(start, end + 1)) as Array<{ cardId: string; draft: string }>

  return parsed.map((item) => ({
    cardId: item.cardId,
    cardTitle: activeCards.find((c) => c.id === item.cardId)?.title ?? 'Unknown',
    text: item.draft,
  }))
}

// ── Swift helpers ─────────────────────────────────────────────────────────────

const resourcesPath = is.dev
  ? join(__dirname, '../../resources')
  : process.resourcesPath

type AppInfo = { pid: number; app: string }

// Returns all running apps (deduplicated by name)
async function listRunningApps(): Promise<AppInfo[]> {
  const bin = join(resourcesPath, 'list-windows')
  const { stdout } = await execFileAsync(bin)
  return JSON.parse(stdout) as AppInfo[]
}

// Reads all text from a specific app via Accessibility API
async function readAppText(pid: number): Promise<string> {
  const bin = join(resourcesPath, 'read-window')
  const { stdout } = await execFileAsync(bin, [String(pid)])
  return stdout.trim()
}

// Reads text from all currently open whitelisted apps, concatenates
async function readWhitelistedApps(whitelistedApps: string[]): Promise<{ text: string; unreadableApps: string[] }> {
  if (whitelistedApps.length === 0) return { text: '', unreadableApps: [] }

  const running = await listRunningApps()
  const targets = running.filter((a) => whitelistedApps.includes(a.app))

  if (targets.length === 0) return { text: '', unreadableApps: [] }

  const results = await Promise.all(
    targets.map(async (a) => {
      const text = await readAppText(a.pid)
      return { app: a.app, text }
    })
  )

  const unreadableApps = results.filter((r) => !r.text).map((r) => r.app)
  const text = results
    .filter((r) => r.text)
    .map((r) => `[${r.app}]\n${r.text}`)
    .join('\n\n')

  return { text, unreadableApps }
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow(): void {
  win = new BrowserWindow({
    width: 300,
    height: 310,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    vibrancy: 'menu',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.on('blur', () => win?.hide())

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function positionWindow(): void {
  if (!win || !tray) return
  const trayBounds = tray.getBounds()
  const [winWidth] = win.getSize()
  const { workArea } = screen.getDisplayMatching(trayBounds)

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - winWidth / 2)
  const y = trayBounds.y + trayBounds.height + 4

  x = Math.max(workArea.x + 8, Math.min(x, workArea.x + workArea.width - winWidth - 8))
  win.setPosition(x, y, false)
}

function toggleWindow(): void {
  if (!win) return
  if (win.isVisible()) {
    win.hide()
  } else {
    positionWindow()
    win.show()
    win.focus()
  }
}

// ── Tray ──────────────────────────────────────────────────────────────────────

function createTray(): void {
  const iconPath = join(__dirname, '../../resources/iconTemplate.png')
  const icon = nativeImage.createFromPath(iconPath)
  tray = new Tray(icon)
  tray.setToolTip('Relay')
  tray.on('click', toggleWindow)
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.dock?.hide()

app.whenReady().then(() => {
  createWindow()
  createTray()
})

app.on('window-all-closed', () => {
  // Keep alive as menu bar app
})

// ── IPC Handlers ──────────────────────────────────────────────────────────────

ipcMain.on('app:quit', () => app.exit(0))

ipcMain.handle('accessibility:check', () => {
  return systemPreferences.isTrustedAccessibilityClient(false)
})

ipcMain.handle('drafts:get', () => loadDrafts())
ipcMain.on('drafts:clear', () => clearDrafts())

ipcMain.on('accessibility:openSettings', () => {
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
})

ipcMain.on('window:setHeight', (_event, height: number) => {
  win?.setSize(300, Math.ceil(height), false)
})

ipcMain.handle('settings:get', () => loadSettings())

ipcMain.handle('settings:save', (_event, patch: Partial<Settings>) => {
  // Never allow renderer to overwrite sensitive keys — always preserve from disk
  const current = loadSettings()
  const merged: Settings = {
    ...current,
    ...patch,
    notionToken: current.notionToken,
    anthropicKey: current.anthropicKey,
  }
  persistSettings(merged)
  // Restart scheduler if frequency changed and whitelist is set
  if (merged.whitelistedApps.length > 0) {
    const ms = FREQUENCY_MS[merged.frequency] ?? FREQUENCY_MS['End of day']
    startScheduler(ms)
  }
  return { success: true }
})

ipcMain.handle('notion:connect', async () => {
  try {
    const code = await startOAuthServer()
    await exchangeNotionCode(code)
    return { status: 'connected' }
  } catch (e) {
    console.error('Notion OAuth failed:', e)
    return { status: 'error' }
  }
})

ipcMain.handle('notion:write', async (_event, { pageId, draft }: { pageId: string; draft: string }) => {
  const settings = loadSettings()
  if (!settings.notionToken) return { status: 'not_connected' }
  try {
    await appendToNotionCard(pageId, draft, settings.notionToken)
    return { status: 'ok' }
  } catch (e) {
    console.error('notion:write failed:', e)
    return { status: 'error' }
  }
})

// Reset session state on every app start — apps and cards are selected fresh each session
app.whenReady().then(() => {
  const settings = loadSettings()
  persistSettings({ ...settings, whitelistedApps: [], activeCards: [] })
})

// Returns list of currently running apps for whitelist selection
ipcMain.handle('apps:list', async () => {
  try {
    return await listRunningApps()
  } catch (e) {
    console.error('apps:list failed:', e)
    return []
  }
})

// Saves the user's app whitelist and (re)starts the scheduler
ipcMain.handle('apps:setWhitelist', async (_event, apps: string[]) => {
  const settings = loadSettings()
  persistSettings({ ...settings, whitelistedApps: apps })
  if (apps.length > 0) {
    const ms = FREQUENCY_MS[settings.frequency] ?? FREQUENCY_MS['End of day']
    startScheduler(ms)
  } else {
    stopScheduler()
  }
  return { status: 'ok' }
})

// Fetches pages from the user's Notion database
ipcMain.handle('notion:getCards', async () => {
  const settings = loadSettings()
  if (!settings.notionToken) return []
  try {
    let databaseId = settings.selectedBoard
    if (!databaseId) {
      const searchRes = await fetch('https://api.notion.com/v1/search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.notionToken}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filter: { property: 'object', value: 'database' } }),
      })
      const searchData = (await searchRes.json()) as { results: Array<{ id: string }> }
      if (searchData.results.length === 0) return []
      databaseId = searchData.results[0].id
      persistSettings({ ...settings, selectedBoard: databaseId })
    }

    const queryRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page_size: 50 }),
    })
    type NotionPage = {
      id: string
      properties: Record<string, { type: string; title?: Array<{ plain_text: string }> }>
    }
    const queryData = (await queryRes.json()) as { results: NotionPage[] }
    return queryData.results.map((page) => {
      const titleProp = Object.values(page.properties).find((p) => p.type === 'title')
      const title = titleProp?.title?.map((t) => t.plain_text).join('') ?? 'Untitled'
      return { id: page.id, title }
    })
  } catch (e) {
    console.error('notion:getCards failed:', e)
    return []
  }
})

// Returns all Notion databases the token has access to
ipcMain.handle('notion:getDatabases', async () => {
  const settings = loadSettings()
  if (!settings.notionToken) return []
  try {
    const res = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filter: { property: 'object', value: 'database' } }),
    })
    type NotionDB = { id: string; title: Array<{ plain_text: string }> }
    const data = (await res.json()) as { results: NotionDB[] }
    return data.results.map((db) => ({
      id: db.id,
      title: db.title?.map((t) => t.plain_text).join('') || 'Untitled',
    }))
  } catch (e) {
    console.error('notion:getDatabases failed:', e)
    return []
  }
})

// Reads all whitelisted apps → generates AI draft
ipcMain.handle('snapshot:trigger', async () => {
  const settings = loadSettings()
  if (settings.whitelistedApps.length === 0) return { status: 'no_apps_selected' }
  if (settings.activeCards.length === 0) return { status: 'no_cards_selected' }
  try {
    const { text, unreadableApps } = await readWhitelistedApps(settings.whitelistedApps)
    if (!text) return { status: 'empty', unreadableApps }
    const previous = loadLastSnapshot()
    const formatSample = settings.notionToken && settings.selectedBoard
      ? await fetchFormatSample(settings.notionToken, settings.selectedBoard)
      : ''
    const drafts = await generateDrafts(text, previous, settings.activeCards, formatSample, settings.anthropicKey)
    saveSnapshot(text)
    saveDrafts(drafts)
    return { status: 'ok', drafts, unreadableApps }
  } catch (e) {
    console.error('snapshot failed:', e)
    return { status: 'error' }
  }
})
