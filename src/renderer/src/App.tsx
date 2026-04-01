import { useState, useEffect, useRef } from 'react'
import type { Settings, AppInfo } from './env'

const FREQUENCIES = ['1 hour', '2 hours', '4 hours', '6 hours', 'End of day']

export default function App() {
  const [settings, setSettings] = useState<Settings>({
    notionConnected: false,
    notionToken: null,
    selectedBoard: null,
    frequency: 'End of day',
    checkBeforeUpdating: true,
    aiProvider: 'claude',
    whitelistedApps: [],
    lastUpdated: null,
  })
  const [hovered, setHovered] = useState<string | null>(null)
  const [frequencyOpen, setFrequencyOpen] = useState(false)
  const [view, setView] = useState<'menu' | 'whitelist' | 'draft'>('menu')
  const [runningApps, setRunningApps] = useState<AppInfo[]>([])
  const [selectedApps, setSelectedApps] = useState<string[]>([])
  const [draft, setDraft] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.relay.getSettings().then(setSettings)
  }, [])

  useEffect(() => {
    window.relay.onNotionConnected(() => {
      window.relay.getSettings().then(setSettings)
    })
  }, [])

  useEffect(() => {
    window.relay.onSnapshotReady((newDraft) => {
      setDraft(newDraft)
      setView('draft')
    })
  }, [])

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

  async function openWhitelist() {
    const apps = await window.relay.listApps()
    setRunningApps(apps)
    setSelectedApps(settings.whitelistedApps)
    setView('whitelist')
  }

  async function saveWhitelist() {
    await window.relay.setWhitelist(selectedApps)
    setSettings((s) => ({ ...s, whitelistedApps: selectedApps }))
    setView('menu')
  }

  function toggleApp(appName: string) {
    setSelectedApps((prev) =>
      prev.includes(appName) ? prev.filter((a) => a !== appName) : [...prev, appName]
    )
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

  // ── Draft view ──────────────────────────────────────────────────────────────

  if (view === 'draft') {
    return (
      <div className="panel" ref={panelRef}>
        {row('back', '← Back', '', () => setView('menu'))}
        <div className="divider" />
        <div className="draft-content">
          <p className="draft-label">Progress update draft</p>
          <p className="draft-text">{draft}</p>
        </div>
        <div className="divider" />
        <div
          className={`row${hovered === 'send' ? ' hovered' : ''}`}
          onMouseEnter={() => setHovered('send')}
          onMouseLeave={() => setHovered(null)}
          onClick={async () => {
            // Hardcoded to "Write a PRD for post-MVP" card for now
            const result = await window.relay.writeToNotion('33479582-581e-80a9-b4f1-c281d2ff5adb', draft)
            if (result.status === 'ok') setView('menu')
          }}
        >
          <span className="label">→ Send to Notion</span>
        </div>
      </div>
    )
  }

  // ── Whitelist picker view ───────────────────────────────────────────────────

  if (view === 'whitelist') {
    return (
      <div className="panel" ref={panelRef}>
        {row('back', '← Back', '', () => setView('menu'))}
        <div className="divider" />
        <div className="picker-list">
          {runningApps.length === 0 && (
            <div className="picker-empty">No apps found</div>
          )}
          {runningApps.map((a) => (
            <div
              key={a.app}
              className={`picker-row${hovered === a.app ? ' hovered' : ''}`}
              onMouseEnter={() => setHovered(a.app)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => toggleApp(a.app)}
            >
              <span className="picker-check">{selectedApps.includes(a.app) ? '✓' : ''}</span>
              <span className="picker-title">{a.app}</span>
            </div>
          ))}
        </div>
        <div className="divider" />
        <div
          className={`row${hovered === 'save-whitelist' ? ' hovered' : ''}`}
          onMouseEnter={() => setHovered('save-whitelist')}
          onMouseLeave={() => setHovered(null)}
          onClick={saveWhitelist}
        >
          <span className="label">Save ({selectedApps.length} apps)</span>
        </div>
      </div>
    )
  }

  // ── Main menu view ──────────────────────────────────────────────────────────

  return (
    <div className="panel" ref={panelRef}>
      {/* Monitored Apps */}
      {row('whitelist', 'Monitor apps', '⌘Z', openWhitelist)}
      {settings.whitelistedApps.length > 0 &&
        subRow('whitelist-status', `${settings.whitelistedApps.length} app${settings.whitelistedApps.length > 1 ? 's' : ''} monitored`, '')}

      <div className="divider" />

      {/* Latest Summary */}
      {draft
        ? row('summary', 'Check the latest summary', '⌘V', () => setView('draft'))
        : subRow('summary-empty', 'No summary yet', '')}

      <div className="divider" />

      {/* Notion */}
      {row('notion', 'Connect to Notion', '⌥⌘V', () => window.relay.connectNotion())}
      {settings.notionConnected &&
        subRow('notion-status', 'Status: connected', '✓')}

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
