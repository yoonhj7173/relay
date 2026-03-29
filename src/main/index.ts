import { app, BrowserWindow, Tray, nativeImage, ipcMain, screen, shell, desktopCapturer } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { createServer } from 'http'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { is } from '@electron-toolkit/utils'

const execFileAsync = promisify(execFile)

let tray: Tray | null = null
let win: BrowserWindow | null = null

// ── Settings persistence ──────────────────────────────────────────────────────

const SETTINGS_PATH = join(app.getPath('userData'), 'settings.json')

const DEFAULT_SETTINGS = {
  notionConnected: false,
  notionToken: null as string | null,
  selectedBoard: null as string | null,
  frequency: 'End of day',
  checkBeforeUpdating: true,
  aiProvider: 'claude' as 'claude' | 'ollama',
  windowSelected: false,
  selectedWindowId: null as string | null,
  selectedWindowTitle: null as string | null,
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

// ── AI ────────────────────────────────────────────────────────────────────────

async function generateDraft(text: string, apiKey: string): Promise<string> {
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

Based on the following content captured from their work window, write a concise progress update in 2-3 bullet points. Focus on what has been done or is currently in progress. Be specific and factual — only use what's in the content below.

Content:
${text.slice(0, 8000)}

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

// In dev, resources/ is relative to project root. In production, it's bundled.
const resourcesPath = is.dev
  ? join(__dirname, '../../resources')
  : process.resourcesPath

type WindowInfo = { id: string; name: string; thumbnail: string }

async function readWindowText(sourceId: string): Promise<string> {
  const bin = join(resourcesPath, 'read-window')
  const { stdout } = await execFileAsync(bin, [sourceId])
  return stdout.trim()
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

ipcMain.handle('window:list', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 200, height: 140 },
    })
    return sources
      .filter((s) => s.name && s.name.length > 0)
      .map((s) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
      }))
  } catch (e) {
    console.error('window:list failed:', e)
    return []
  }
})

ipcMain.handle('window:select', async (_event, window: WindowInfo) => {
  const settings = loadSettings()
  persistSettings({
    ...settings,
    windowSelected: true,
    selectedWindowId: window.id,
    selectedWindowTitle: window.name,
  })
  return { status: 'selected' }
})

ipcMain.handle('snapshot:trigger', async () => {
  const settings = loadSettings()
  if (!settings.windowSelected || !settings.selectedWindowId) {
    return { status: 'no_window_selected' }
  }
  try {
    const text = await readWindowText(settings.selectedWindowId)
    if (!text) return { status: 'empty' }
    const draft = await generateDraft(text, settings.anthropicKey)
    return { status: 'ok', draft }
  } catch (e) {
    console.error('snapshot failed:', e)
    return { status: 'error' }
  }
})
