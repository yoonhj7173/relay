import { app, BrowserWindow, Tray, nativeImage, ipcMain, screen, shell, Notification } from 'electron'
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
  anthropicKey: import.meta.env.MAIN_VITE_ANTHROPIC_KEY as string,
  lastUpdated: null as string | null,
}

type Settings = typeof DEFAULT_SETTINGS

function loadSettings(): Settings {
  try {
    if (existsSync(SETTINGS_PATH)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')) }
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
    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2))
  } catch (e) {
    console.error('Failed to save settings:', e)
  }
}

// ── Snapshot persistence ──────────────────────────────────────────────────────

const SNAPSHOT_PATH = join(app.getPath('userData'), 'last-snapshot.txt')

function loadLastSnapshot(): string {
  try {
    if (existsSync(SNAPSHOT_PATH)) return readFileSync(SNAPSHOT_PATH, 'utf-8')
  } catch { /* ignore */ }
  return ''
}

function saveSnapshot(text: string): void {
  writeFileSync(SNAPSHOT_PATH, text, 'utf-8')
}

function clearSnapshot(): void {
  try { if (existsSync(SNAPSHOT_PATH)) unlinkSync(SNAPSHOT_PATH) } catch { /* ignore */ }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

function startScheduler(frequencyMs: number): void {
  if (snapshotTimer) clearInterval(snapshotTimer)
  snapshotTimer = setInterval(async () => {
    const settings = loadSettings()
    if (settings.whitelistedApps.length === 0) return
    try {
      const text = await readWhitelistedApps(settings.whitelistedApps)
      if (!text) return
      const previous = loadLastSnapshot()
      const draft = await generateDraft(text, previous, settings.anthropicKey)
      saveSnapshot(text)
      // Notify the renderer so it can show the draft
      win?.webContents.send('snapshot:ready', draft)
      // Show a system notification
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
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const lines = draft.split('\n').map((l) => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean)

  const children = [
    {
      type: 'heading_3',
      heading_3: {
        rich_text: [{ type: 'text', text: { content: `Progress Update – ${date}` } }],
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

async function generateDraft(text: string, previous: string, apiKey: string): Promise<string> {
  const diffSection = previous
    ? `Previous snapshot (what was there before):\n${previous.slice(0, 4000)}\n\nCurrent snapshot (what's there now):\n${text.slice(0, 4000)}`
    : `Current snapshot:\n${text.slice(0, 8000)}`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `You are helping a team member write a progress update for their team board.

Based on the following content captured from their work apps, write a concise progress update in 2-3 bullet points. Focus on what has changed or is currently in progress. Be specific and factual — only use what's in the content below.

${diffSection}

Write only the bullet points, nothing else.`,
        },
      ],
    }),
  })

  const data = (await response.json()) as {
    content: { text: string }[]
    error?: { message: string }
  }

  if (data.error) throw new Error(data.error.message)
  return data.content[0].text
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
async function readWhitelistedApps(whitelistedApps: string[]): Promise<string> {
  if (whitelistedApps.length === 0) return ''

  const running = await listRunningApps()
  const targets = running.filter((a) => whitelistedApps.includes(a.app))

  if (targets.length === 0) return ''

  const results = await Promise.all(
    targets.map(async (a) => {
      const text = await readAppText(a.pid)
      return text ? `[${a.app}]\n${text}` : ''
    })
  )

  return results.filter(Boolean).join('\n\n')
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

ipcMain.on('window:setHeight', (_event, height: number) => {
  win?.setSize(300, Math.ceil(height), false)
})

ipcMain.handle('settings:get', () => loadSettings())

ipcMain.handle('settings:save', (_event, settings: Settings) => {
  persistSettings(settings)
  // Restart scheduler if frequency changed and whitelist is set
  if (settings.whitelistedApps.length > 0) {
    const ms = FREQUENCY_MS[settings.frequency] ?? FREQUENCY_MS['End of day']
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

// Start scheduler on app ready if whitelist already set
app.whenReady().then(() => {
  const settings = loadSettings()
  if (settings.whitelistedApps.length > 0) {
    const ms = FREQUENCY_MS[settings.frequency] ?? FREQUENCY_MS['End of day']
    startScheduler(ms)
  }
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

// Reads all whitelisted apps → generates AI draft
ipcMain.handle('snapshot:trigger', async () => {
  const settings = loadSettings()
  if (settings.whitelistedApps.length === 0) {
    return { status: 'no_apps_selected' }
  }
  try {
    const text = await readWhitelistedApps(settings.whitelistedApps)
    if (!text) return { status: 'empty' }
    const previous = loadLastSnapshot()
    const draft = await generateDraft(text, previous, settings.anthropicKey)
    saveSnapshot(text)
    return { status: 'ok', draft }
  } catch (e) {
    console.error('snapshot failed:', e)
    return { status: 'error' }
  }
})
