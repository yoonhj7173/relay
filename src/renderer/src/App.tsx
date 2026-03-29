import { useState, useEffect, useRef } from 'react'
import type { Settings, WindowInfo } from './env'

const FREQUENCIES = ['1 hour', '2 hours', '4 hours', '6 hours', 'End of day']

export default function App() {
  const [settings, setSettings] = useState<Settings>({
    notionConnected: false,
    notionToken: null,
    selectedBoard: null,
    frequency: 'End of day',
    checkBeforeUpdating: true,
    aiProvider: 'claude',
    windowSelected: false,
    selectedWindowId: null,
    selectedWindowTitle: null,
    lastUpdated: null,
  })
  const [hovered, setHovered] = useState<string | null>(null)
  const [frequencyOpen, setFrequencyOpen] = useState(false)
  const [view, setView] = useState<'menu' | 'picker' | 'draft'>('menu')
  const [windows, setWindows] = useState<WindowInfo[]>([])
  const [draft, setDraft] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.relay.getSettings().then(setSettings)
  }, [])

  // Listen for Notion OAuth callback from main process
  useEffect(() => {
    window.relay.onNotionConnected(() => {
      window.relay.getSettings().then(setSettings)
    })
  }, [])

  // Resize the window to match content height
  useEffect(() => {
    if (!panelRef.current) return
    const observer = new ResizeObserver(() => {
      if (panelRef.current) {
        window.relay.setHeight(panelRef.current.offsetHeight)
      }
    })
    observer.observe(panelRef.current)
    return () => observer.disconnect()
  }, [])

  function updateSettings(patch: Partial<Settings>) {
    const updated = { ...settings, ...patch }
    setSettings(updated)
    window.relay.saveSettings(updated)
  }

  async function openPicker() {
    const list = await window.relay.listWindows()
    setWindows(list)
    setView('picker')
  }

  async function pickWindow(w: WindowInfo) {
    await window.relay.selectWindow(w)
    setSettings((s) => ({
      ...s,
      windowSelected: true,
      selectedWindowId: w.id,
      selectedWindowTitle: w.name,
    }))
    setView('menu')
  }

  function row(id: string, label: string, shortcut: string, onClick?: () => void) {
    return (
      <div
        className={`row${hovered === id ? ' hovered' : ''}`}
        onMouseEnter={() => setHovered(id)}
        onMouseLeave={() => setHovered(null)}
        onClick={onClick}
      >
        <span className="label">{label}</span>
        <span className="shortcut">{shortcut}</span>
      </div>
    )
  }

  function subRow(id: string, label: string, right: string, onClick?: () => void) {
    return (
      <div
        className={`sub-row${onClick ? ' clickable' : ''}${hovered === id ? ' hovered' : ''}`}
        onMouseEnter={() => onClick && setHovered(id)}
        onMouseLeave={() => onClick && setHovered(null)}
        onClick={onClick}
      >
        <span className="bullet">·</span>
        <span className="sub-label">{label}</span>
        <span className="shortcut">{right}</span>
      </div>
    )
  }

  // ── Window picker view ──────────────────────────────────────────────────────

  if (view === 'draft') {
    return (
      <div className="panel" ref={panelRef}>
        {row('back', '← Back', '', () => setView('menu'))}
        <div className="divider" />
        <div className="draft-content">
          <p className="draft-label">Progress update draft</p>
          <p className="draft-text">{draft}</p>
        </div>
      </div>
    )
  }

  if (view === 'picker') {
    return (
      <div className="panel" ref={panelRef}>
        {row('back', '← Back', '', () => setView('menu'))}
        <div className="divider" />
        <div className="picker-list">
          {windows.length === 0 && (
            <div className="picker-empty">No windows found</div>
          )}
          {windows.map((w, i) => (
            <div
              key={i}
              className={`picker-row${hovered === `w-${i}` ? ' hovered' : ''}`}
              onMouseEnter={() => setHovered(`w-${i}`)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => pickWindow(w)}
            >
              <span className="picker-title">{w.name}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Main menu view ──────────────────────────────────────────────────────────

  return (
    <div className="panel" ref={panelRef}>
      {/* Select Window */}
      {row('select', 'Select window', '⌘Z', openPicker)}
      {settings.windowSelected &&
        subRow('window-status', settings.selectedWindowTitle ?? 'Window selected', '')}

      <div className="divider" />

      {/* Latest Summary */}
      {row('summary', 'Check the latest summary', '⌘V')}

      <div className="divider" />

      {/* Notion */}
      {row('notion', 'Connect to Notion', '⌥⌘V', () => window.relay.connectNotion())}
      {settings.notionConnected && (
        <>
          {subRow('notion-status', 'Status: connected', '✓')}
          {subRow('board', 'Change board', '⌘A', () => console.log('change board'))}
        </>
      )}

      <div className="divider" />

      {/* Frequency */}
      <div
        className={`row${hovered === 'frequency' ? ' hovered' : ''}`}
        onMouseEnter={() => setHovered('frequency')}
        onMouseLeave={() => setHovered(null)}
        onClick={() => setFrequencyOpen((o) => !o)}
      >
        <span className="label">Set frequency for snapshot</span>
        <span className="arrow">›</span>
      </div>
      {frequencyOpen &&
        FREQUENCIES.map((f) => (
          <div
            key={f}
            className={`sub-row clickable${hovered === f ? ' hovered' : ''}`}
            onMouseEnter={() => setHovered(f)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => {
              updateSettings({ frequency: f })
              setFrequencyOpen(false)
            }}
          >
            <span className="bullet">·</span>
            <span className="sub-label">{f}</span>
            <span className="shortcut">{settings.frequency === f ? '✓' : ''}</span>
          </div>
        ))}

      <div className="divider" />

      {/* Check Before Updating */}
      {row('check', 'Check before updating', 'D')}
      {subRow(
        'toggle',
        settings.checkBeforeUpdating ? 'On' : 'Off',
        'E',
        () => updateSettings({ checkBeforeUpdating: !settings.checkBeforeUpdating })
      )}

      {/* Manual Trigger */}
      <div className="divider" />
      {row('trigger', loading ? 'Generating…' : 'Trigger snapshot now', '⌘T', async () => {
        setLoading(true)
        const result = await window.relay.triggerSnapshot()
        setLoading(false)
        if (result.draft) {
          setDraft(result.draft)
          setView('draft')
        }
      })}

      {/* Quit */}
      <div className="divider" />
      {row('quit', 'Quit Relay', '⌘Q', () => window.relay.quit())}
    </div>
  )
}
