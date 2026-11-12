/**
 * Platform-specific lookups: profile root, Claude Desktop binary and the
 * command lines of running Claude Desktop processes.
 *
 * Windows ships Claude as an MSIX app with an execution alias; Linux ships a
 * normal binary or AppImage. Everything else in the app stays platform-neutral.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';

export const isWindows = process.platform === 'win32';
export const isLinux = process.platform === 'linux';

/**
 * Folder suggested on the setup screen for the profile library.
 *
 * <home>/claude-accounts on every platform, e.g. C:\Users\me\claude-accounts.
 *
 * @returns Absolute path.
 */
export function defaultProfilesRoot(): string {
  return path.join(os.homedir(), 'claude-accounts');
}

/**
 * Candidate locations of the Claude Desktop executable for this platform.
 *
 * @returns Absolute paths, most likely first.
 */
function desktopCandidates(): string[] {
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
 * @param target - Candidate path.
 * @returns True when the file exists or access was denied by ACL.
 */
function canLaunch(target: string): boolean {
  try {
    fs.statSync(target);
    return true;
  }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EACCES' || code === 'EPERM';
  }
}


/**
 * Finds the Claude Desktop executable for this machine.
 *
 * An explicit CLAUDE_DESKTOP_EXECUTABLE wins, which is how a Linux AppImage
 * stored somewhere unusual can be wired in without editing the code.
 *
 * @returns Executable path, or null when nothing is installed.
 */
export function findDesktopExecutable(): string | null {
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
 * @returns Executable path with an icon, or the launch alias.
 */
export function findDesktopIcon(): string | null {
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
 * @param folder - Absolute profile folder.
 * @returns Arguments for the Claude executable.
 */
export function desktopLaunchArgs(folder: string): string[] {
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
 * @param commandLine - Full process command line.
 * @returns Normalised lowercase folder, or null.
 */
export function profileFolderFromCommandLine(commandLine: string): string | null {
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
const windowLines = new Map<string, string | null>();

/**
 * Runs one PowerShell command and returns stdout, or an empty string on error.
 *
 * @param command - PowerShell script.
 * @returns Raw stdout.
 */
function runPowerShell(command: string): Promise<string> {
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
 * @returns
 * Process ids with a start-time key, so a recycled pid never reuses a cached
 * command line, plus the start time in epoch milliseconds.
 */
async function listVisibleProcesses(): Promise<Array<{id: number, key: string, startedAt: number}>> {
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
 * @param ids - Process ids to look up.
 * @returns Command line per process id.
 */
async function readCommandLines(ids: number[]): Promise<Map<number, string>> {
  const lines = new Map<number, string>();
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
 * @returns One
 * entry per visible window; startedAt is 0 when unknown (Linux).
 */
export async function listClaudeWindows(): Promise<Array<{commandLine: string, startedAt: number}>> {
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
      .filter((entry): entry is { commandLine: string, startedAt: number } => Boolean(entry.commandLine));
  }

  if (isLinux) {
    return new Promise<Array<{commandLine: string, startedAt: number}>>((resolve) => {
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
 * @returns One command line per visible Claude window.
 */
export async function listClaudeCommandLines(): Promise<string[]> {
  return (await listClaudeWindows()).map((entry) => entry.commandLine);
}

/**
 * Splits raw command output into trimmed non-empty lines.
 *
 * @param text - Raw stdout from ps or PowerShell.
 * @returns Non-empty lines.
 */
function splitLines(text: string): string[] {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
