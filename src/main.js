'use strict';

/**
 * Main process: window shell and the profile commands behind it.
 *
 * The app owns no chat UI. It manages profile folders and hands them to the
 * native Claude Desktop with --user-data-dir, so every account keeps its own
 * cookies, history cache, window state and MCP config.
 */

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const platform = require('./platform');
const profiles = require('./profiles');
const settings = require('./settings');
const shortcuts = require('./shortcuts');

const STATE_REFRESH_MS = 2000;

const REPO_URL = 'https://github.com/tohidmalik002/multi-claude-desktop';

/** A window this young counts as its profile's even before it writes a log. */
const BOOT_GRACE_MS = 30000;

let mainWindow = null;
let desktopWindows = [];


/**
 * Captures the window, retrying while the GPU compositor is still warming up.
 *
 * @param {BrowserWindow} window - Window to capture.
 * @returns {Promise<Electron.NativeImage>} Captured image.
 */
async function captureWithRetry(window) {
  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await window.webContents.capturePage();
    }
    catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }

  throw lastError;
}


/**
 * Creates the application window.
 *
 * @returns {void}
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#262624',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    title: 'Multi Claude Desktop',
    autoHideMenuBar: true,
    // Screenshot runs stay hidden so they never take keyboard focus.
    show: !process.env.CLAUDE_PROFILES_CAPTURE,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Dev helper: CLAUDE_PROFILES_CAPTURE=<png path> saves a screenshot of the UI.
  // Add CLAUDE_PROFILES_CAPTURE_DIALOG=1 to capture the New profile dialog.
  if (process.env.CLAUDE_PROFILES_CAPTURE) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        if (process.env.CLAUDE_PROFILES_CAPTURE_DIALOG) {
          await mainWindow.webContents.executeJavaScript(
            "document.getElementById('btn-new').click()",
          );
          await new Promise((resolve) => setTimeout(resolve, 400));
        }

        const image = await captureWithRetry(mainWindow);
        require('node:fs').writeFileSync(process.env.CLAUDE_PROFILES_CAPTURE, image.toPNG());
        console.log('captured', process.env.CLAUDE_PROFILES_CAPTURE);
      }, 4000);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}


/**
 * Starts Claude Desktop for one profile folder.
 *
 * Launching the same folder twice focuses the existing window, so this is safe
 * to call repeatedly.
 *
 * On a Windows account with a gateway (3P) set up, a plain launch boots in
 * gateway mode first, which shows a gateway window and blocks later launches.
 * --claude-first-party-sign-in plus --restarted-by-app are the arguments
 * Claude itself uses when it restarts into a Claude account, and with them
 * the launch goes straight into the profile folder, signed in or not.
 *
 * @param {string} slug - Profile slug.
 * @returns {string} Executable that was launched.
 */
function openInDesktop(slug) {
  const executable = platform.findDesktopExecutable();
  if (!executable) {
    throw new Error('Claude Desktop was not found. Set CLAUDE_DESKTOP_EXECUTABLE to its full path.');
  }

  const child = spawn(executable, platform.desktopLaunchArgs(profiles.folderFor(slug)), {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  return executable;
}


/**
 * Reports whether a profile's own Claude log changed since a moment.
 *
 * @param {string} folder - Absolute profile folder.
 * @param {number} since - Epoch ms.
 * @returns {boolean} True when logs/main.log was written at or after since.
 */
function logWrittenSince(folder, since) {
  try {
    return fs.statSync(path.join(folder, 'logs', 'main.log')).mtimeMs >= since;
  }
  catch {
    return false;
  }
}


/**
 * Async scan for Claude Desktop processes, then pushes the new state.
 *
 * @returns {Promise<void>} Resolves after the renderer is updated.
 */
async function refreshDesktopState() {
  desktopWindows = await platform.listClaudeWindows();
  pushState();
}


/**
 * Reports whether a profile folder is used by a running Claude Desktop window.
 *
 * Matching the command line is not enough: a window that Claude restarted in
 * gateway mode keeps --user-data-dir in its arguments but uses another
 * folder. A real profile window keeps writing its own log, so a window older
 * than the boot grace only counts when that log moved after it started.
 *
 * @param {string} folder - Absolute profile folder.
 * @returns {boolean} True when a visible window is using the folder.
 */
function isDesktopRunning(folder) {
  const target = path.normalize(folder).toLowerCase();
  const now = Date.now();

  return desktopWindows.some((entry) => {
    if (platform.profileFolderFromCommandLine(entry.commandLine) !== target) {
      return false;
    }
    if (!entry.startedAt || now - entry.startedAt < BOOT_GRACE_MS) {
      return true;
    }
    return logWrittenSince(folder, entry.startedAt + 5000);
  });
}


/**
 * Builds the payload rendered by the window.
 *
 * @returns {object} Profiles with their open state plus app paths.
 */
function buildState() {
  const libraryRoot = settings.getProfilesRoot();

  return {
    configured: libraryRoot !== null,
    suggestedRoot: settings.suggestedProfilesRoot(),
    libraryRoot,
    libraryRootShort: libraryRoot ? libraryRoot.replace(os.homedir(), '~') : '',
    nextProfileName: profiles.nextProfileName(),
    desktopPath: platform.findDesktopExecutable(),
    platform: process.platform,
    appShortcut: shortcuts.appShortcutExists(),
    appVersion: app.getVersion(),
    profiles: profiles.listProfiles().map((profile) => ({
      ...profile,
      desktopOpen: isDesktopRunning(profile.folder),
      shortcutCount: shortcuts.listShortcuts(profile).length,
    })),
  };
}


/**
 * Sends the current state to the renderer.
 *
 * @returns {void}
 */
function pushState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send('profiles:state', buildState());
}


/**
 * Looks up a profile by slug, throwing when it disappeared meanwhile.
 *
 * @param {string} slug - Profile slug.
 * @returns {object} Profile record.
 */
function findProfile(slug) {
  const profile = profiles.listProfiles().find((candidate) => candidate.slug === slug);
  if (!profile) {
    throw new Error(`Profile "${slug}" was not found.`);
  }

  return profile;
}


/**
 * Registers the IPC surface used by the renderer.
 *
 * @returns {void}
 */
function registerHandlers() {
  ipcMain.handle('profiles:list', () => buildState());

  ipcMain.handle('profiles:create', (_event, rawName) => {
    const profile = profiles.createProfile(rawName || '');
    pushState();
    return profile;
  });

  ipcMain.handle('profiles:open', (_event, slug) => {
    openInDesktop(slug);
    profiles.markUsed(slug);
    setTimeout(() => refreshDesktopState(), 2500);
    return buildState();
  });

  ipcMain.handle('profiles:delete', async (_event, slug) => {
    const profile = findProfile(slug);

    if (isDesktopRunning(profile.folder)) {
      throw new Error(`${profile.name} is open. Quit its Claude window first (tray icon, then Quit), then delete.`);
    }

    const answer = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Delete profile',
      message: `Delete ${profile.name}?`,
      detail: 'Its folder moves to the Recycle Bin, together with its sign-in, local Claude Code sessions and MCP settings. '
        + 'Its desktop shortcuts are removed. Chats on Anthropic servers are not affected.',
      buttons: ['Cancel', 'Move to Recycle Bin'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });

    if (answer.response !== 1) {
      return { deleted: false };
    }

    shortcuts.remove(profile);
    try {
      await profiles.removeProfile(slug);
    }
    catch (error) {
      throw new Error(`Could not move ${profile.name} to the Recycle Bin. If its Claude still runs in the tray, quit it there and try again. (${error.message})`);
    }

    pushState();
    return { deleted: true, name: profile.name };
  });

  ipcMain.handle('profiles:reveal', (_event, slug) => shell.openPath(profiles.folderFor(slug)));

  ipcMain.handle('profiles:create-shortcut', (_event, slug) => {
    const shortcutFile = shortcuts.create(findProfile(slug));
    pushState();
    return { path: shortcutFile };
  });

  ipcMain.handle('profiles:remove-shortcut', (_event, slug) => {
    shortcuts.remove(findProfile(slug));
    pushState();
    return buildState();
  });

  ipcMain.handle('app:create-shortcut', () => {
    const shortcutFile = shortcuts.createAppShortcut();
    pushState();
    return { path: shortcutFile };
  });

  ipcMain.handle('app:remove-shortcut', () => {
    shortcuts.removeAppShortcut();
    pushState();
    return buildState();
  });

  ipcMain.handle('profiles:refresh', async () => {
    await refreshDesktopState();
    return buildState();
  });

  ipcMain.handle('settings:choose-root', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose where Claude profiles are stored',
      defaultPath: settings.getProfilesRoot() || os.homedir(),
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return buildState();
    }

    settings.setProfilesRoot(result.filePaths[0]);
    pushState();
    return buildState();
  });

  ipcMain.handle('settings:use-suggested-root', () => {
    settings.setProfilesRoot(settings.suggestedProfilesRoot());
    pushState();
    return buildState();
  });

  ipcMain.handle('app:open-repo', () => shell.openExternal(REPO_URL));

  ipcMain.handle('settings:open-root', () => {
    const root = settings.getProfilesRoot();
    return root ? shell.openPath(root) : '';
  });
}


app.whenReady().then(async () => {
  registerHandlers();
  await refreshDesktopState();
  createWindow();

  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      refreshDesktopState();
    }
  }, STATE_REFRESH_MS);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});


app.on('window-all-closed', () => {
  app.quit();
});
