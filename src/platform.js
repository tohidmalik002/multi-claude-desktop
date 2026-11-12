'use strict';

/**
 * Platform-specific lookups: profile root, Claude Desktop binary and the
 * command lines of running Claude Desktop processes.
 *
 * Windows ships Claude as an MSIX app with an execution alias; Linux ships a
 * normal binary or AppImage. Everything else in the app stays platform-neutral.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');

const isWindows = process.platform === 'win32';
const isLinux = process.platform === 'linux';

/**
 * Folder suggested on the setup screen for the profile library.
 *
 * <home>/claude-accounts on every platform, e.g. C:\Users\me\claude-accounts.
 *
 * @returns {string} Absolute path.
 */
function defaultProfilesRoot() {
  return path.join(os.homedir(), 'claude-accounts');
}

/**
 * Candidate locations of the Claude Desktop executable for this platform.
 *
 * @returns {string[]} Absolute paths, most likely first.
 */
function desktopCandidates() {
  if (isWindows) {
    const localAppData = process.env.LOCALAPPDATA || '';
    return [
      path.join(localAppData, 'Microsoft', 'WindowsApps', 'claude-desktop.exe'),
      path.join(localAppData, 'Programs', 'Claude', 'Claude.exe'),
    ];
  }

  if (isLinux) {
    return [
      '/usr/bin/claude-desktop',
      '/usr/local/bin/claude-desktop',
      '/opt/Claude/claude-desktop',
      '/opt/claude-desktop/claude-desktop',
      path.join(os.homedir(), 'Applications', 'claude-desktop.AppImage'),
      path.join(os.homedir(), '.local', 'bin', 'claude-desktop'),
    ];
  }

  return [];
}

/**
 * Reports whether a path looks launchable.
 *
 * Windows app execution aliases live in WindowsApps, a folder that denies stat
 * to normal users, so existsSync answers false for a working alias. EACCES and
 * EPERM therefore count as "present".
 *
 * @param {string} target - Candidate path.
 * @returns {boolean} True when the file exists or access was denied by ACL.
 */
function canLaunch(target) {
  try {
    fs.statSync(target);
    return true;
  }
  catch (error) {
    return error.code === 'EACCES' || error.code === 'EPERM';
  }
}


/**
 * Finds the Claude Desktop executable for this machine.
 *
 * An explicit CLAUDE_DESKTOP_EXECUTABLE wins, which is how a Linux AppImage
 * stored somewhere unusual can be wired in without editing the code.
 *
 * @returns {string|null} Executable path, or null when nothing is installed.
 */
function findDesktopExecutable() {
  const override = process.env.CLAUDE_DESKTOP_EXECUTABLE;
  if (override && override.trim() && canLaunch(override.trim())) {
    return override.trim();
  }

  for (const candidate of desktopCandidates()) {
    if (candidate && canLaunch(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Finds the file that should supply the Claude icon for shortcuts.
 *
 * The launchable WindowsApps alias carries no icon resources, so shortcuts
 * using it look blank. The real executable lives in the MSIX install folder,
 * which Get-AppxPackage reports without admin rights.
 *
 * @returns {string|null} Executable path with an icon, or the launch alias.
 */
function findDesktopIcon() {
  if (isWindows) {
    try {
      const output = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-Command', '(Get-AppxPackage -Name Claude).InstallLocation'],
        { encoding: 'utf8', windowsHide: true, timeout: 5000 },
      );
      const location = output.trim();

      if (location) {
        const candidate = path.join(location, 'app', 'Claude.exe');
        if (canLaunch(candidate)) {
          return candidate;
        }
      }
    }
    catch {
      // Fall through to the launchable executable.
    }
  }

  return findDesktopExecutable();
}


/**
 * Command-line arguments that open Claude Desktop on one profile folder.
 *
 * On Windows, Claude boots every plain launch in gateway (3P) mode when a
 * gateway is configured, and only a restart moves it into the profile. The two
 * extra flags are the ones that restart uses, so the launch skips gateway
 * mode and opens the profile directly, signed in or not.
 *
 * @param {string} folder - Absolute profile folder.
 * @returns {string[]} Arguments for the Claude executable.
 */
function desktopLaunchArgs(folder) {
  const args = [`--user-data-dir=${folder}`];
  if (isWindows) {
    args.push('--claude-first-party-sign-in', '--restarted-by-app');
  }
  return args;
}


/**
 * Extracts the profile folder from a Claude command line.
 *
 * Handles both quoted and unquoted --user-data-dir values and normalises case
 * and separators, so claude-1 never matches claude-10 by substring.
 *
 * @param {string} commandLine - Full process command line.
 * @returns {string|null} Normalised lowercase folder, or null.
 */
function profileFolderFromCommandLine(commandLine) {
  const match = String(commandLine).match(/--user-data-dir=("?)([^"\s]+)\1/);
  const value = match && match[2];

  return value ? path.normalize(value).toLowerCase() : null;
}


/**
 * Cache of visible Claude windows: process id + start time -> command line.
 *
 * Reading command lines needs WMI, which is the expensive part of a refresh.
 * Window ids come from Get-Process, which is much cheaper, so steady-state
 * refreshes skip WMI entirely and only new windows trigger a query.
 */
const windowLines = new Map();

/**
 * Runs one PowerShell command and returns stdout, or an empty string on error.
 *
 * @param {string} command - PowerShell script.
 * @returns {Promise<string>} Raw stdout.
 */
function runPowerShell(command) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', command],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => resolve(error ? '' : stdout),
    );
  });
}

/** .NET ticks (100 ns since year 1) at the Unix epoch. */
const EPOCH_TICKS = 621355968000000000n;

/**
 * Lists Claude processes that currently own a visible window.
 *
 * @returns {Promise<Array<{id: number, key: string, startedAt: number}>>}
 * Process ids with a start-time key, so a recycled pid never reuses a cached
 * command line, plus the start time in epoch milliseconds.
 */
async function listVisibleProcesses() {
  const script = 'Get-Process -Name claude -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { "$($_.Id):$($_.StartTime.ToUniversalTime().Ticks)" }';
  const output = await runPowerShell(script);

  return splitLines(output)
    .map((line) => {
      const [id, ticks] = line.split(':');
      let startedAt = 0;
      try {
        startedAt = Number((BigInt(ticks) - EPOCH_TICKS) / 10000n);
      }
      catch {
        startedAt = 0;
      }
      return { id: Number(id), key: `${id}:${ticks}`, startedAt };
    })
    .filter((entry) => Number.isFinite(entry.id));
}

/**
 * Reads command lines for specific process ids.
 *
 * @param {number[]} ids - Process ids to look up.
 * @returns {Promise<Map<number, string>>} Command line per process id.
 */
async function readCommandLines(ids) {
  const lines = new Map();
  if (ids.length === 0) {
    return lines;
  }

  const filter = ids.map((id) => `ProcessId=${id}`).join(' OR ');
  const script = `Get-CimInstance Win32_Process -Filter "${filter}" | ForEach-Object { "$($_.ProcessId)\`t$($_.CommandLine)" }`;
  const output = await runPowerShell(script);

  for (const row of splitLines(output)) {
    const tab = row.indexOf('\t');
    if (tab === -1) {
      continue;
    }

    const id = Number(row.slice(0, tab));
    if (Number.isFinite(id)) {
      lines.set(id, row.slice(tab + 1));
    }
  }

  return lines;
}

/**
 * Lists the Claude Desktop windows that are visible.
 *
 * Only processes with a real window handle count: Claude keeps its main
 * process alive in the tray after the window closes, and a process-only scan
 * would report "running" forever.
 *
 * @returns {Promise<Array<{commandLine: string, startedAt: number}>>} One
 * entry per visible window; startedAt is 0 when unknown (Linux).
 */
async function listClaudeWindows() {
  if (isWindows) {
    const visible = await listVisibleProcesses();
    const keys = new Set(visible.map((entry) => entry.key));
    const missing = visible.filter((entry) => !windowLines.has(entry.key));

    if (missing.length > 0) {
      const found = await readCommandLines(missing.map((entry) => entry.id));
      for (const entry of missing) {
        windowLines.set(entry.key, found.get(entry.id) || null);
      }
    }

    for (const key of Array.from(windowLines.keys())) {
      if (!keys.has(key)) {
        windowLines.delete(key);
      }
    }

    return visible
      .map((entry) => ({ commandLine: windowLines.get(entry.key), startedAt: entry.startedAt }))
      .filter((entry) => entry.commandLine);
  }

  if (isLinux) {
    return new Promise((resolve) => {
      execFile('ps', ['-eo', 'args'], (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        resolve(
          splitLines(stdout)
            .filter((line) => line.includes('claude') && line.includes('user-data-dir'))
            .map((commandLine) => ({ commandLine, startedAt: 0 })),
        );
      });
    });
  }

  return [];
}

/**
 * Lists command lines of the Claude Desktop windows that are visible.
 *
 * @returns {Promise<string[]>} One command line per visible Claude window.
 */
async function listClaudeCommandLines() {
  return (await listClaudeWindows()).map((entry) => entry.commandLine);
}

/**
 * Splits raw command output into trimmed non-empty lines.
 *
 * @param {string} text - Raw stdout from ps or PowerShell.
 * @returns {string[]} Non-empty lines.
 */
function splitLines(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

module.exports = {
  isWindows,
  isLinux,
  defaultProfilesRoot,
  findDesktopExecutable,
  findDesktopIcon,
  desktopLaunchArgs,
  listClaudeCommandLines,
  listClaudeWindows,
  profileFolderFromCommandLine,
};
