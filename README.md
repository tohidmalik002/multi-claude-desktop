# Multi Claude Desktop

Run several Claude Desktop accounts side by side on one Windows or Linux user.

Each profile is its own folder, handed to the native Claude Desktop with
`--user-data-dir`. Sign-in, local Claude Code sessions, window state and MCP
settings never mix between profiles. The launcher has no chat UI of its own.

## Features

- Create, launch and delete profiles (deleted folders go to the Recycle Bin).
- Profiles sorted by last use.
- Desktop shortcuts per profile; each click on **Add to desktop** adds another.
- Shows which profiles have a window open and which account each is signed in to.
- First-run setup asks where profiles are stored (default `<home>\claude-accounts`).

## Requirements

- Claude Desktop installed. On Windows the launcher finds the
  `claude-desktop.exe` app alias; elsewhere set `CLAUDE_DESKTOP_EXECUTABLE`.
- Node.js 20+ to run or build from source.

## Run from source

```bash
npm install
npm start
```

## Build (Windows)

```bash
npm run package
```

Output: `dist/Multi Claude Desktop-win32-x64/Multi Claude Desktop.exe`.
Use **Add launcher to desktop** in the app for a shortcut.

## Where data lives

| What | Where |
| --- | --- |
| Profile library (chosen on first run) | e.g. `C:\Users\<you>\claude-accounts\` |
| One profile | `<library>\claude-work\` |
| Names and last-use times | `<library>\profiles.json`, `<library>\last-used.json` |
| Launcher settings | `%APPDATA%\Multi Claude Desktop\settings.json` |

`CLAUDE_PROFILES_ROOT` sets the library folder without the setup screen.

Profile folders hold sign-in cookies. Keep them out of git and backups you
share. Copying a profile to another PC does not carry the sign-in: Windows
encrypts it for the original user.

## How launching works

Profiles start with:

```
claude-desktop.exe --user-data-dir=<profile> --claude-first-party-sign-in --restarted-by-app
```

The last two flags matter on a Windows account that has a gateway (3P)
provider configured. Without them Claude boots in gateway mode, shows a
gateway window, and hands later launches to it. With them it opens the
profile directly, signed in or not. Launching an open profile again brings
its window to the front.

Sign in to new profiles with email and the 6-digit code. "Continue with
Google" finishes in the browser and can return the session to the default
Claude window instead of the profile.

## Project layout

```
src/
  main.js       window, IPC, launching Claude
  platform.js   OS lookups: Claude executable, running windows, launch flags
  profiles.js   profile folders, names, last-use order, delete
  settings.js   library folder choice
  shortcuts.js  desktop shortcuts (.lnk / .desktop)
  preload.js    renderer bridge
  renderer.js   UI
assets/         app icon
scripts/        icon generator (npm run icon)
```

## Author

Built by [tohidmalik002](https://github.com/tohidmalik002).

If you find it useful, please give the repo a ⭐. Bug reports and ideas are
welcome as [issues](https://github.com/tohidmalik002/multi-claude-desktop/issues),
and pull requests too.

## License

MIT. See [LICENSE](LICENSE).
