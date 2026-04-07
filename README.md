# Relay

**Automated progress updates for your team.**

Relay runs in your menu bar, reads your open apps via the macOS Accessibility API, and drafts Notion progress updates based on what changed since the last snapshot. You review, edit, and approve before anything gets published.

![screenshot placeholder](docs/screenshot.png)

---

## How it works

1. **Select apps to monitor** — pick which apps Relay should watch each session (e.g. Notion, Figma, Chrome)
2. **Select today's Notion cards** — map your session to the cards you're actively working on
3. **Relay generates drafts** — at your chosen interval (or on demand), it reads your apps, diffs against the last snapshot, and sends the delta to Claude to draft an update per card
4. **You approve** — review the draft, edit inline, then send to Notion or skip

---

## Features

- Menu bar app — no windows, no interruptions
- Reads full app text via macOS Accessibility API (not screenshots)
- Diff-based context — Claude sees what changed, not just what's there
- Multi-card routing — Claude maps content to the right Notion card
- Format learning — reads your 2 most recent Notion updates to match your team's style
- Human-in-the-loop — nothing publishes without your approval
- Drafts persist across restarts

---

## Tech stack

| Layer | Choice |
|---|---|
| Desktop | Electron 31 + React 18 + TypeScript |
| App monitoring | macOS Accessibility API (Swift binary) |
| AI | Claude API (`claude-sonnet-4-6`) |
| Notion | Notion API (OAuth) |
| Config | `.env` file — keys never committed |

---

## Getting started

**Prerequisites:** Node.js 20+, Xcode Command Line Tools, a [Notion integration](https://www.notion.so/my-integrations), an Anthropic API key

```bash
git clone https://github.com/yoonhj7173/relay.git
cd relay
cp .env.example .env
# fill in .env with your keys
npm install
npm run dev
```

### .env keys

| Key | Where to get it |
|---|---|
| `MAIN_VITE_NOTION_CLIENT_ID` | Notion integration → OAuth settings |
| `MAIN_VITE_NOTION_CLIENT_SECRET` | Notion integration → OAuth settings |
| `MAIN_VITE_ANTHROPIC_KEY` | [console.anthropic.com](https://console.anthropic.com) |

---

## Building

**Unsigned DMG** (for local sharing — recipients must right-click → Open to bypass Gatekeeper):
```bash
npm run build:mac:dev
```

**Signed + notarized DMG** (requires Apple Developer account):
```bash
# Add to .env:
# APPLE_TEAM_ID=your 10-char team ID (developer.apple.com → Membership)
# APPLE_ID=your Apple ID email
# APPLE_APP_SPECIFIC_PASSWORD=generated at appleid.apple.com

npm run build:mac:dist
```

Output: `dist/Relay-x.x.x.dmg`

---

## Roadmap

- [ ] App distribution (code signing, notarization, public DMG)
- [ ] Multi-board support
- [ ] Phase 2: Java/Spring backend for subscription model and hosted AI calls
