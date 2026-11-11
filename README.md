# HubSpot Desktop

A native Mac desktop app for HubSpot. No more browser tabs — access HubSpot directly from your dock with native notifications, keyboard shortcuts, and more.

## Features

- **Menu Bar Menu** — Lists the eight Navigate destinations and opens the window on the one you pick
- **Global Hotkey** — Press `Cmd+Shift+H` from anywhere to show/hide the app
- **Session Persistence** — Stay logged in between app restarts
- **Native Notifications** — HubSpot alerts as Mac notifications
- **Dock Badge** — See unread counts at a glance
- **Keyboard Shortcuts** — Quick navigation without touching your mouse
- **Tabs and Close to Dock** — `Cmd+T` opens a native tab and `Cmd+N` a new window, both on Dashboards. Cmd+W closes a tab and hides the app on the last one, Cmd+Q quits

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+H` | **Show/Hide app (global)** |
| `Cmd+T` | New Tab |
| `Cmd+N` | New Window |
| `Cmd+1` | Dashboards |
| `Cmd+2` | Contacts |
| `Cmd+3` | Companies |
| `Cmd+4` | Deals |
| `Cmd+5` | Tickets |
| `Cmd+6` | Tasks |
| `Cmd+7` | Inbox |
| `Cmd+8` | Meetings |
| `Cmd+[` | Back |
| `Cmd+]` | Forward |

## Installation

### Download

Download the latest DMG from the [Releases](https://github.com/harvinder-power/hubspot-desktop/releases) page.

- **Apple Silicon (M1/M2/M3)**: `HubSpot Desktop-x.x.x-arm64.dmg`
- **Intel Macs**: `HubSpot Desktop-x.x.x.dmg`

### Build from Source

```bash
# Clone the repo
git clone https://github.com/harvinder-power/hubspot-desktop.git
cd hubspot-desktop

# Install dependencies
npm install

# Run in development mode
npm start

# Build DMG installer
npm run build
```

## Tech Stack

- [Electron](https://www.electronjs.org/) — Cross-platform desktop apps
- [electron-builder](https://www.electron.build/) — Packaging and distribution
- [electron-window-state](https://github.com/mawie81/electron-window-state) — Window position persistence

## License

MIT
