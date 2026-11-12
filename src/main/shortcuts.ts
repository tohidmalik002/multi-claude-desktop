/**
 * Optional per-profile desktop shortcuts.
 *
 * Windows uses shell.writeShortcutLink (.lnk); Linux writes a .desktop entry.
 * Both point at the native Claude Desktop with --user-data-dir, so the shortcut
 * opens exactly one account.
 */

import { app, shell } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as platform from './platform';
import type { Profile } from '../shared/types';

export const LAUNCHER_NAME = 'Multi Claude Desktop';
const LAUNCHER_SLUG = 'multi-claude-desktop';


/**
 * Absolute path of one shortcut file for a profile.
 *
 * Index 2 and above add a counter, so pressing Create repeatedly produces
 * claude-work.lnk, claude-work (2).lnk, claude-work (3).lnk instead of
 * overwriting the same file.
 *
 * @param profile - Profile record.
 * @param [index] - 1-based shortcut number.
 * @returns e.g. C:\Users\me\Desktop\claude-work (2).lnk
 */
export function shortcutPath(profile: Profile, index = 1): string {
  const desktop = app.getPath('desktop');

  if (platform.isWindows) {
    const suffix = index === 1 ? '' : ` (${index})`;
    return path.join(desktop, `${profile.name}${suffix}.lnk`);
  }

  const suffix = index === 1 ? '' : `-${index}`;
  return path.join(desktop, `claude-${profile.slug}${suffix}.desktop`);
}


/**
 * Escapes a profile name so it can be used inside a filename regex.
 *
 * @param value - Raw profile name.
 * @returns Regex-safe text.
 */
function escapeRegExp(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


/**
 * Lists every desktop shortcut that belongs to a profile.
 *
 * One directory read covers every numbered shortcut, which keeps the frequent
 * status refresh cheap even with several profiles.
 *
 * @param profile - Profile record.
 * @returns Existing shortcut paths, numbered first.
 */
export function listShortcuts(profile: Profile): string[] {
  const desktop = app.getPath('desktop');
  const base = platform.isWindows ? profile.name : `claude-${profile.slug}`;
  const extension = platform.isWindows ? '.lnk' : '.desktop';
  const separator = platform.isWindows ? ' \\((\\d+)\\)' : '-(\\d+)';
  const pattern = new RegExp(
    `^${escapeRegExp(base)}(?:${separator})?${escapeRegExp(extension)}$`,
    'i',
  );

  try {
    return fs.readdirSync(desktop)
      .filter((name) => pattern.test(name))
      .map((name) => path.join(desktop, name))
      .sort((left, right) => left.localeCompare(right));
  }
  catch {
    return [];
  }
}


/**
 * Returns the first unused shortcut path for a profile.
 *
 * @param profile - Profile record.
 * @returns Path that does not exist yet.
 */
export function nextShortcutPath(profile: Profile): string {
  for (let index = 1; index <= 99; index += 1) {
    const target = shortcutPath(profile, index);
    if (!fs.existsSync(target)) {
      return target;
    }
  }

  throw new Error(`All 99 desktop shortcuts for ${profile.name} already exist.`);
}


/**
 * Reports whether the profile already has a desktop shortcut.
 *
 * @param profile - Profile record.
 * @returns True when the shortcut file exists.
 */
export function exists(profile: Profile): boolean {
  return listShortcuts(profile).length > 0;
}


/**
 * Creates the desktop shortcut for one profile.
 *
 * @param profile - Profile record.
 * @returns Path of the created shortcut.
 */
export function create(profile: Profile): string {
  const executable = platform.findDesktopExecutable();
  if (!executable) {
    throw new Error('Claude Desktop was not found. Set CLAUDE_DESKTOP_EXECUTABLE to its full path.');
  }

  const target = nextShortcutPath(profile);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  // Profile shortcuts open Claude itself, so they carry Claude's own icon.
  // The launcher's icon is reserved for the launcher shortcut.
  const iconFile = platform.findDesktopIcon() || executable;

  if (platform.isWindows) {
    const created = shell.writeShortcutLink(target, 'create', {
      target: executable,
      args: platform.desktopLaunchArgs(profile.folder)
        .map((arg) => (arg.includes(' ') ? `"${arg}"` : arg))
        .join(' '),
      cwd: profile.folder,
      icon: iconFile,
      iconIndex: 0,
      description: `Claude Desktop - ${profile.name}`,
    });

    if (!created) {
      throw new Error('Windows refused to create the shortcut.');
    }

    return target;
  }

  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${profile.name}`,
    `Comment=Claude Desktop profile: ${profile.name}`,
    `Exec="${executable}" --user-data-dir="${profile.folder}"`,
    `Path=${profile.folder}`,
    'Terminal=false',
    'Categories=Utility;',
    '',
  ].join('\n');

  fs.writeFileSync(target, entry, { mode: 0o755 });

  return target;
}


/**
 * Absolute path of the launcher's own desktop shortcut.
 *
 * @returns e.g. C:\Users\me\Desktop\Multi Claude Desktop.lnk
 */
export function appShortcutPath(): string {
  const desktop = app.getPath('desktop');

  if (platform.isWindows) {
    return path.join(desktop, `${LAUNCHER_NAME}.lnk`);
  }

  return path.join(desktop, `${LAUNCHER_SLUG}.desktop`);
}


/**
 * Reports whether the launcher itself has a desktop shortcut.
 *
 * @returns True when the shortcut file exists.
 */
export function appShortcutExists(): boolean {
  try {
    return fs.existsSync(appShortcutPath());
  }
  catch {
    return false;
  }
}


/**
 * Creates a desktop shortcut that starts this launcher.
 *
 * In a packaged build process.execPath is the launcher itself. During
 * development it is Electron, so the app folder is passed as an argument and
 * the shortcut still works.
 *
 * @returns Path of the created shortcut.
 */
export function createAppShortcut(): string {
  const target = appShortcutPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });

  if (platform.isWindows) {
    const created = shell.writeShortcutLink(target, 'create', {
      target: process.execPath,
      args: app.isPackaged ? '' : `"${app.getAppPath()}"`,
      cwd: path.dirname(process.execPath),
      icon: process.execPath,
      iconIndex: 0,
      description: 'Launch Multi Claude Desktop',
    });

    if (!created) {
      throw new Error('Windows refused to create the shortcut.');
    }

    return target;
  }

  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${LAUNCHER_NAME}`,
    'Comment=Manage isolated Claude Desktop profiles',
    `Exec="${process.execPath}"`,
    `Path=${path.dirname(process.execPath)}`,
    'Terminal=false',
    'Categories=Utility;',
    '',
  ].join('\n');

  fs.writeFileSync(target, entry, { mode: 0o755 });

  return target;
}


/**
 * Deletes the launcher's desktop shortcut when it exists.
 *
 * @returns True when a file was removed.
 */
export function removeAppShortcut(): boolean {
  const target = appShortcutPath();

  if (!fs.existsSync(target)) {
    return false;
  }

  fs.rmSync(target, { force: true });
  return true;
}


/**
 * Deletes every desktop shortcut of a profile.
 *
 * @param profile - Profile record.
 * @returns How many shortcuts were removed.
 */
export function remove(profile: Profile): number {
  const existing = listShortcuts(profile);

  for (const target of existing) {
    fs.rmSync(target, { force: true });
  }

  return existing.length;
}
