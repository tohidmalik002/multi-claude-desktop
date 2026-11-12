/**
 * Persisted app settings.
 *
 * Today that is only the profile library folder, chosen on the setup screen
 * so the profiles can live on any drive on Windows or Linux.
 */

import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as platform from './platform';

/**
 * Absolute path of the settings file inside the app's user data folder.
 *
 * @returns e.g. %APPDATA%\claude-profiles\settings.json
 */
export function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

/**
 * Reads settings, returning an empty object when the file is missing or broken.
 *
 * @returns Parsed settings.
 */
function readSettings(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  }
  catch {
    return {};
  }
}

/**
 * Files that mark a folder as an existing profile library.
 */
const LIBRARY_MARKERS = ['profiles.json', 'last-used.json'];

/**
 * Returns the profile library folder, or null until one is chosen.
 *
 * A folder picked on the setup screen wins; CLAUDE_PROFILES_ROOT also counts
 * as a choice, so scripted installs skip the setup screen.
 *
 * @returns Absolute path, e.g. C:\Users\me\claude-accounts.
 */
export function getProfilesRoot(): string | null {
  const stored = readSettings().profilesRoot;
  if (typeof stored === 'string' && stored.trim()) {
    return path.resolve(stored.trim());
  }

  const override = process.env.CLAUDE_PROFILES_ROOT;
  if (override && override.trim()) {
    return path.resolve(override.trim());
  }

  return null;
}

/**
 * Reports whether a profile library folder has been chosen.
 *
 * @returns True once the setup screen was completed.
 */
export function isConfigured(): boolean {
  return getProfilesRoot() !== null;
}

/**
 * Folder the setup screen suggests.
 *
 * @returns Absolute path, e.g. C:\Users\me\claude-accounts.
 */
export function suggestedProfilesRoot(): string {
  return platform.defaultProfilesRoot();
}

/**
 * Picks the folder that will really hold the profiles.
 *
 * Every subfolder of the library counts as a profile, so a busy folder such
 * as Documents would fill the list with unrelated folders. A missing or empty
 * folder, or one that already is a library, is used as is; anything else gets
 * a claude-accounts folder inside it.
 *
 * @param folder - Folder the user chose.
 * @returns Absolute library folder.
 */
function resolveLibraryFolder(folder: string): string {
  const chosen = path.resolve(folder);

  let entries: string[];
  try {
    entries = fs.readdirSync(chosen);
  }
  catch {
    return chosen;
  }

  if (entries.length === 0 || LIBRARY_MARKERS.some((name) => entries.includes(name))) {
    return chosen;
  }

  return path.join(chosen, 'claude-accounts');
}

/**
 * Stores the profile library folder and creates it.
 *
 * @param folder - Folder the user chose.
 * @returns Library folder actually used.
 */
export function setProfilesRoot(folder: string): string {
  const library = resolveLibraryFolder(folder);
  fs.mkdirSync(library, { recursive: true });

  const settings = readSettings();
  settings.profilesRoot = library;

  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), `${JSON.stringify(settings, null, 4)}\n`, 'utf8');

  return library;
}
