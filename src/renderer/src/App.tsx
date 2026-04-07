import { useState, useEffect, useRef, type ReactNode } from 'react'
import type { Settings, AppInfo, NotionCard, DraftItem } from './env'

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
    activeCards: [],
    lastUpdated: null,
  })
  const [hovered, setHovered] = useState<string | null>(null)
  const [frequencyOpen, setFrequencyOpen] = useState(false)
  const [view, setView] = useState<'menu' | 'whitelist' | 'cardpicker' | 'boardpicker' | 'draft'>('menu')
  const [runningApps, setRunningApps] = useState<AppInfo[]>([])
  const [selectedApps, setSelectedApps] = useState<string[]>([])
  const [notionCards, setNotionCards] = useState<NotionCard[]>([])
  const [selectedCards, setSelectedCards] = useState<{ id: string; title: string }[]>([])
  const [cardsLoading, setCardsLoading] = useState(false)
  const [drafts, setDrafts] = useState<DraftItem[]>([])
  const [draftIndex, setDraftIndex] = useState(0)
  const [unreadableApps, setUnreadableApps] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [databases, setDatabases] = useState<{ id: string; title: string }[]>([])
  const [dbsLoading, setDbsLoading] = useState(false)
  const [accessibilityGranted, setAccessibilityGranted] = useState<boolean>(true)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.relay.getSettings().then(setSettings)
    window.relay.getDrafts().then((saved) => {
      if (saved.length > 0) setDrafts(saved)
    })
  }, [])

  useEffect(() => {
    const check = async () => {
      const granted = await window.relay.checkAccessibility()
      setAccessibilityGranted(granted)
    }
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [])

  useEffect(() => {
    window.relay.onNotionConnected(() => {
      window.relay.getSettings().then(setSettings)
    })
  }, [])

  useEffect(() => {
    window.relay.onSnapshotReady(({ drafts: newDrafts, unreadableApps: unreadable }) => {
      setDrafts(newDrafts)
      setUnreadableApps(unreadable)
      setDraftIndex(0)
      setView('draft')
    })
  }, [])

  useEffect(() => {
    if (!panelRef.current) return
    const observer = new ResizeObserver(() => {
      if (panelRef.current) window.relay.setHeight(panelRef.current.offsetHeight)
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

  async function openCardPicker() {
    setCardsLoading(true)
    setSelectedCards(settings.activeCards)
    setView('cardpicker')
    const cards = await window.relay.getNotionCards()
    setNotionCards(cards)
    setCardsLoading(false)
  }

  function toggleCard(card: NotionCard) {
    setSelectedCards((prev) =>
      prev.some((c) => c.id === card.id)
        ? prev.filter((c) => c.id !== card.id)
        : [...prev, { id: card.id, title: card.title }]
    )
  }

  function saveCards() {
    updateSettings({ activeCards: selectedCards })
    setView('menu')
  }

  async function openBoardPicker() {
    setDbsLoading(true)
    setView('boardpicker')
    const dbs = await window.relay.getDatabases()
    setDatabases(dbs)
    setDbsLoading(false)
  }

  function selectBoard(id: string) {
    updateSettings({ selectedBoard: id, activeCards: [] })
    setView('menu')
  }

  function updateDraftText(text: string) {
    setDrafts((prev) => prev.map((d, i) => (i === draftIndex ? { ...d, text } : d)))
  }

  async function sendDraft() {
    const current = drafts[draftIndex]
    const result = await window.relay.writeToNotion(current.cardId, current.text)
    if (result.status === 'error') {
      setStatusMsg('Failed to write to Notion — check your connection')
      return
    }
    setStatusMsg(null)
    goNextDraft()
  }

  function goNextDraft() {
    if (draftIndex < drafts.length - 1) {
      setDraftIndex((i) => i + 1)
    } else {
      window.relay.clearDrafts()
      setDrafts([])
      setDraftIndex(0)
      setView('menu')
    }
  }

  function row(id: string, label: ReactNode, shortcut: string, onClick?: () => void) {
    return (
      <div
        className={`row${hovered === id ? ' hovered' : ''}`}
        onMouseEnter={() => setHovered(id)}
        onMouseLeave={() => setHovered(null)}
        onClick={onClick}
      >
        <span className="label">{label}</span>
        {shortcut && <span className="shortcut">{shortcut}</span>}
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
        {right && <span className="shortcut">{right}</span>}
      </div>
    )
  }

  function sectionLabel(text: string) {
    return <div className="section-label">{text}</div>
  }

  // ── Draft view ──────────────────────────────────────────────────────────────

  if (view === 'draft' && drafts.length > 0) {
    const current = drafts[draftIndex]
    const isLast = draftIndex === drafts.length - 1
    return (
      <div className="panel" ref={panelRef}>
        <div className="draft-nav">
          <span className="draft-back" onClick={() => setView('menu')}>← Back</span>
          {drafts.length > 1 && (
            <div className="draft-dots">
              {drafts.map((_, i) => (
                <span key={i} className={`dot${i === draftIndex ? ' active' : ''}`} />
              ))}
            </div>
          )}
        </div>
        <div className="divider" />
        {unreadableApps.length > 0 && (
          <div className="draft-warning">⚠ Could not read: {unreadableApps.join(', ')}</div>
        )}
        <div className="draft-content">
          <div className="draft-meta">
            <span className="draft-label">Draft</span>
            <span className="draft-card-badge">{current.cardTitle}</span>
          </div>
          <textarea
            className="draft-textarea"
            value={current.text}
            onChange={(e) => updateDraftText(e.target.value)}
          />
        </div>
        <div className="divider" />
        {statusMsg && <div className="status-msg">{statusMsg}</div>}
        <div className="draft-actions">
          {row('send', 'Send to Notion', '→', sendDraft)}
          {row('skip', isLast ? 'Discard' : 'Skip', '', goNextDraft)}
        </div>
      </div>
    )
  }

  // ── Board picker view ───────────────────────────────────────────────────────

  if (view === 'boardpicker') {
    return (
      <div className="panel" ref={panelRef}>
        {row('back', '← Back', '', () => setView('menu'))}
        <div className="divider" />
        <div className="picker-list">
          {dbsLoading && <div className="picker-empty">Loading…</div>}
          {!dbsLoading && databases.length === 0 && (
            <div className="picker-empty">No databases found</div>
          )}
          {!dbsLoading && databases.map((db) => (
            <div
              key={db.id}
              className={`picker-row${hovered === db.id ? ' hovered' : ''}`}
              onMouseEnter={() => setHovered(db.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => selectBoard(db.id)}
            >
              <span className="picker-check">{settings.selectedBoard === db.id ? '✓' : ''}</span>
              <span className="picker-title">{db.title}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Card picker view ────────────────────────────────────────────────────────

  if (view === 'cardpicker') {
    return (
      <div className="panel" ref={panelRef}>
        {row('back', '← Back', '', () => setView('menu'))}
        <div className="divider" />
        <div className="picker-list">
          {cardsLoading && <div className="picker-empty">Loading cards…</div>}
          {!cardsLoading && notionCards.length === 0 && (
            <div className="picker-empty">No cards found</div>
          )}
          {!cardsLoading && notionCards.map((card) => (
            <div
              key={card.id}
              className={`picker-row${hovered === card.id ? ' hovered' : ''}`}
              onMouseEnter={() => setHovered(card.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => toggleCard(card)}
            >
              <span className="picker-check">{selectedCards.some((c) => c.id === card.id) ? '✓' : ''}</span>
              <span className="picker-title">{card.title}</span>
            </div>
          ))}
        </div>
        <div className="divider" />
        {row('save-cards', `Save (${selectedCards.length} card${selectedCards.length !== 1 ? 's' : ''})`, '', saveCards)}
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
          {runningApps.length === 0 && <div className="picker-empty">No apps found</div>}
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
        {row('save-whitelist', `Save (${selectedApps.length} app${selectedApps.length !== 1 ? 's' : ''})`, '', saveWhitelist)}
      </div>
    )
  }

  // ── Main menu view ──────────────────────────────────────────────────────────

  return (
    <div className="panel" ref={panelRef}>

      {/* Header */}
      <div className="app-header">
        <span className="app-wordmark">relay</span>
        {loading && <span className="app-status">Generating</span>}
      </div>

      {/* Accessibility warning */}
      {!accessibilityGranted && (
        <>
          <div className="divider" />
          <div
            className={`row row-warning${hovered === 'accessibility' ? ' hovered' : ''}`}
            onMouseEnter={() => setHovered('accessibility')}
            onMouseLeave={() => setHovered(null)}
            onClick={() => window.relay.openAccessibilitySettings()}
          >
            <span className="label">Accessibility access needed</span>
            <span className="shortcut">Open Settings →</span>
          </div>
        </>
      )}

      {/* Monitoring */}
      <div className="divider" />
      {sectionLabel('Monitoring')}
      {row('whitelist', 'Monitor apps', '', openWhitelist)}
      {settings.whitelistedApps.length > 0 &&
        subRow('whitelist-status', `${settings.whitelistedApps.length} app${settings.whitelistedApps.length !== 1 ? 's' : ''} selected`, '')}

      {/* Updates */}
      <div className="divider" />
      {sectionLabel('Updates')}
      {drafts.length > 0
        ? row('summary', 'Review latest summary', '', () => setView('draft'))
        : subRow('summary-empty', 'No summary yet', '')}
      {row('trigger', 'Trigger snapshot now', '', async () => {
        if (loading) return
        setLoading(true)
        setStatusMsg(null)
        const result = await window.relay.triggerSnapshot()
        setLoading(false)
        setUnreadableApps(result.unreadableApps ?? [])
        if (result.status === 'no_apps_selected') {
          setStatusMsg('Select apps to monitor first')
        } else if (result.status === 'no_cards_selected') {
          setStatusMsg("Select today's cards first")
        } else if (result.status === 'empty') {
          setStatusMsg('No text could be read from apps')
        } else if (result.status === 'error') {
          setStatusMsg('Something went wrong')
        } else if (result.drafts && result.drafts.length > 0) {
          setDrafts(result.drafts)
          setDraftIndex(0)
          setView('draft')
        }
      })}
      {statusMsg && <div className="status-msg">{statusMsg}</div>}

      {/* Notion */}
      <div className="divider" />
      {sectionLabel('Notion')}
      {row(
        'notion',
        settings.notionConnected
          ? <><span className="status-dot green">●</span> Reconnect Notion</>
          : 'Connect to Notion',
        '',
        () => window.relay.connectNotion()
      )}
      {settings.notionConnected &&
        subRow('board-select', settings.selectedBoard ? 'Change board' : 'Select board', '→', openBoardPicker)}
      {settings.notionConnected &&
        subRow(
          'card-select',
          settings.activeCards.length > 0
            ? `${settings.activeCards.length} card${settings.activeCards.length !== 1 ? 's' : ''} active`
            : "Select today's cards",
          '→',
          openCardPicker
        )}

      {/* Settings */}
      <div className="divider" />
      {sectionLabel('Settings')}
      <div
        className={`row${hovered === 'frequency' ? ' hovered' : ''}`}
        onMouseEnter={() => setHovered('frequency')}
        onMouseLeave={() => setHovered(null)}
        onClick={() => setFrequencyOpen((o) => !o)}
      >
        <span className="label">Snapshot frequency</span>
        <span className="shortcut">{settings.frequency} ›</span>
      </div>
      {frequencyOpen && FREQUENCIES.map((f) => (
        <div
          key={f}
          className={`sub-row clickable${hovered === f ? ' hovered' : ''}`}
          onMouseEnter={() => setHovered(f)}
          onMouseLeave={() => setHovered(null)}
          onClick={() => { updateSettings({ frequency: f }); setFrequencyOpen(false) }}
        >
          <span className="bullet">·</span>
          <span className="sub-label">{f}</span>
          <span className="shortcut">{settings.frequency === f ? '✓' : ''}</span>
        </div>
      ))}
      {subRow(
        'toggle',
        `Review before sending: ${settings.checkBeforeUpdating ? 'On' : 'Off'}`,
        '',
        () => updateSettings({ checkBeforeUpdating: !settings.checkBeforeUpdating })
      )}

      <div className="divider" />
      {row('quit', 'Quit Relay', '', () => window.relay.quit())}
    </div>
  )
}
