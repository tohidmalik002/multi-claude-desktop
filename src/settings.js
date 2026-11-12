'use strict';

/**
 * Persisted app settings.
 *
 * Today that is only the profile library folder, chosen on the setup screen
 * so the profiles can live on any drive on Windows or Linux.
 */

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const platform = require('./platform');

/**
 * Absolute path of the settings file inside the app's user data folder.
 *
 * @returns {string} e.g. %APPDATA%\claude-profiles\settings.json
 */
function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

/**
 * Reads settings, returning an empty object when the file is missing or broken.
 *
 * @returns {Record<string, unknown>} Parsed settings.
 */
function readSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
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
 * @returns {string|null} Absolute path, e.g. C:\Users\me\claude-accounts.
 */
function getProfilesRoot() {
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
 * @returns {boolean} True once the setup screen was completed.
 */
function isConfigured() {
  return getProfilesRoot() !== null;
}

/**
 * Folder the setup screen suggests.
 *
 * @returns {string} Absolute path, e.g. C:\Users\me\claude-accounts.
 */
function suggestedProfilesRoot() {
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
 * @param {string} folder - Folder the user chose.
 * @returns {string} Absolute library folder.
 */
function resolveLibraryFolder(folder) {
  const chosen = path.resolve(folder);

  let entries;
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
 * @param {string} folder - Folder the user chose.
 * @returns {string} Library folder actually used.
 */
function setProfilesRoot(folder) {
  const library = resolveLibraryFolder(folder);
  fs.mkdirSync(library, { recursive: true });

  const settings = readSettings();
  settings.profilesRoot = library;

  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), `${JSON.stringify(settings, null, 4)}\n`, 'utf8');

  return library;
}

module.exports = {
  settingsFile,
  getProfilesRoot,
  isConfigured,
  setProfilesRoot,
  suggestedProfilesRoot,
};
