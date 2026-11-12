# 🗂️ Multi Claude Desktop

A small **desktop launcher** that runs several **Claude Desktop** accounts side by side,
each in its own isolated profile folder.

Built with **Electron**. No accounts of its own, no tracking, no network calls.

Made by [**@tohidmalik002**](https://github.com/tohidmalik002) · License: MIT · Platform: Windows 10/11 (Linux experimental)

If you find it useful, please give the repo a ⭐. Bug reports and ideas are welcome as
[issues](https://github.com/tohidmalik002/multi-claude-desktop/issues), and pull requests too.

---

## Table of contents

- [What it is](#what-it-is)
- [Features](#features)
- [Install](#install)
- [First run](#first-run)
- [Run from source](#run-from-source)
- [Development](#development)
- [How it works](#how-it-works)
- [Where data lives](#where-data-lives)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [Author](#author)
- [License](#license)

---

## What it is

Claude Desktop signs in to one account at a time. Switching means signing out and in again,
and your work and personal accounts share one window, one set of local Claude Code sessions
and one MCP config.

Multi Claude Desktop gives every account its own **profile**: a folder that Claude Desktop
uses for that account alone (`--user-data-dir`). Profiles run at the same time, each in its own
window, and never see each other's sign-in, sessions or settings. The launcher only manages
the folders and starts the real Claude Desktop; it has no chat UI of its own.

## Features

| Feature | Description |
|---|---|
| **Profiles** | Create, launch and delete profiles. Each one is a folder named like `claude-work`. |
| **Side by side** | Run several accounts at once, each in its own Claude window. |
| **Last used first** | The profile list is sorted by when you last launched each one. |
| **Status at a glance** | Shows which profiles have a window open and which account each is signed in to. |
| **Desktop shortcuts** | **Add to desktop** creates a shortcut that opens Claude straight into that profile; click again for another copy. |
| **Safe delete** | Deleting a profile moves its folder to the Recycle Bin, so it can be restored. |
| **First-run setup** | Asks where profiles are stored (default `<home>\claude-accounts`) before anything is created. |
| **Gateway-aware** | Works on Windows accounts that have a gateway (3P) provider set up; see [How it works](#how-it-works). |

## Install

You need **Claude Desktop** installed: <https://claude.ai/download>.

Then get Multi Claude Desktop:

**Option A — Download a build** (when available):
see the [**Releases**](https://github.com/tohidmalik002/multi-claude-desktop/releases) page.
Extract the ZIP anywhere and run **`Multi Claude Desktop.exe`**.

> **SmartScreen note:** builds are **not code-signed**, so Windows may warn "unknown
> publisher". Click **More info → Run anyway**.

**Option B — Build from source:**

```bash
git clone https://github.com/tohidmalik002/multi-claude-desktop.git
cd multi-claude-desktop
npm install
npm run package
```

The app is written to `dist/Multi Claude Desktop-win32-x64/Multi Claude Desktop.exe`.

## First run

1. **Choose a folder.** The setup screen suggests `C:\Users\<you>\claude-accounts`. Click
   **Use this folder**, or **Choose another folder…**. Leave **Add a Multi Claude Desktop
   shortcut to my desktop** ticked to get a launcher icon.
2. **Create a profile.** Click **+ New profile** and type a name: `work` becomes `claude-work`.
   Leave it empty to accept the suggestion (`claude-1`, `claude-2`, …).
3. **Launch it** and sign in with your **email and the 6-digit code**.

> Avoid **Continue with Google** for profiles: that sign-in finishes in your browser and can
> land in the default Claude window instead of the profile.

The launcher shortcut can be added or removed later with **Desktop shortcut** under the logo.

## Run from source

```bash
npm install
npm start
```

## Development

### npm scripts

| Script | What it does |
|---|---|
| `npm start` | Runs the app with Electron from `src/`. |
| `npm run package` | Builds the Windows app into `dist/` with electron-packager. |
| `npm run icon` | Regenerates `assets/icon.{ico,png}` (PowerShell, Windows). |

### Requirements

- **Node.js 20+** and npm.
- **Windows 10/11** with Claude Desktop installed. On Linux, set `CLAUDE_DESKTOP_EXECUTABLE`
  if Claude is not in a standard location.

## How it works

Each profile is launched as:

```
claude-desktop.exe --user-data-dir=<profile folder> --claude-first-party-sign-in --restarted-by-app
```

- `--user-data-dir` gives Claude a separate folder for cookies, cache, window state and
  MCP config, so profiles never mix.
- The last two flags are the ones Claude itself uses when it restarts into a Claude account.
  They matter on a Windows account with a **gateway (3P) provider** configured: without them
  Claude boots in gateway mode, shows a gateway window and hands every later launch to it.
  With them it opens the profile directly, signed in or not.
- Launching a profile that is already open just brings its window to the front.

The launcher finds open windows by reading the command lines of running Claude processes,
and reads each profile's signed-in account from its `config.json`.

The UI talks to the main process only through a small `contextBridge` API, with
`contextIsolation` on, `nodeIntegration` off and a strict CSP.

## Where data lives

| What | Where |
|---|---|
| Profile library (chosen on first run) | e.g. `C:\Users\<you>\claude-accounts\` |
| One profile | `<library>\claude-work\` |
| Profile names and last-use times | `<library>\profiles.json`, `<library>\last-used.json` |
| Launcher settings | `%APPDATA%\Multi Claude Desktop\settings.json` |

Set `CLAUDE_PROFILES_ROOT` to choose the library folder without the setup screen.

> **Keep profile folders private.** They hold sign-in cookies. Don't commit them or share
> them. Copying a profile to another PC does not carry the sign-in: Windows encrypts it for
> the original user.

## Project structure

```
multi-claude-desktop/
├─ src/
│  ├─ main.js        # window, IPC, launching Claude
│  ├─ platform.js    # OS lookups: Claude executable, running windows, launch flags
│  ├─ profiles.js    # profile folders, names, last-use order, delete
│  ├─ settings.js    # library folder choice
│  ├─ shortcuts.js   # desktop shortcuts (.lnk / .desktop)
│  ├─ preload.js     # secure bridge for the UI
│  ├─ renderer.js    # UI
│  ├─ index.html
│  └─ styles.css
├─ assets/           # app icon
├─ scripts/
│  └─ build-icon.ps1 # icon generator (npm run icon)
├─ package.json
└─ LICENSE
```

## Troubleshooting

| Problem | Fix |
|---|---|
| "Claude Desktop was not found" | Install Claude Desktop, or set `CLAUDE_DESKTOP_EXECUTABLE` to its full path. |
| A profile opens signed in as the wrong account | It was signed in with Google. Sign out in that window and sign in again with email + code. |
| Delete says the profile is open | Quit that profile's Claude (tray icon → Quit), then delete. |
| Status shows "running" after closing a window | Claude keeps running in the tray. Quit it from the tray icon. |
| Old desktop shortcuts open the wrong folder | Shortcuts store the full path. Remove them and use **Add to desktop** again. |

## Roadmap

- Release builds (portable ZIP) on the Releases page.
- Rename a profile from the app.
- Tested Linux support.

## Author

Built by [**@tohidmalik002**](https://github.com/tohidmalik002).

If you find it useful, please give the repo a ⭐. Bug reports and ideas are welcome as
[issues](https://github.com/tohidmalik002/multi-claude-desktop/issues), and pull requests too.

## License

MIT. See [LICENSE](LICENSE).
