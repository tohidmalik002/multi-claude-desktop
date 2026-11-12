'use strict';

/**
 * Profile library: folder layout, display names and account metadata.
 *
 * A profile is one folder inside the library folder. Nothing here touches the
 * Claude app itself, so the same folders work whether they are opened by
 * Claude Desktop or by the in-app web view.
 */

const { shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const settings = require('./settings');

const DEFAULT_PREFIX = 'claude';

/**
 * Absolute path of the library folder that contains every profile folder.
 *
 * @returns {string} e.g. C:\Users\me\claude-accounts
 */
function workRoot() {
  const root = settings.getProfilesRoot();
  if (!root) {
    throw new Error('Choose where profiles are stored first.');
  }

  return root;
}

/**
 * Absolute path of the manifest that maps folder slugs to display names.
 *
 * @returns {string} Path of profiles.json.
 */
function manifestPath() {
  return path.join(workRoot(), 'profiles.json');
}

/**
 * Creates the profile root when missing.
 *
 * @returns {void}
 */
function ensureWorkRoot() {
  fs.mkdirSync(workRoot(), { recursive: true });
}

/**
 * Reads the slug-to-name map, tolerating a missing or broken file.
 *
 * @returns {Record<string, string>} Display name per slug.
 */
function readManifest() {
  try {
    const raw = fs.readFileSync(manifestPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  }
  catch {
    return {};
  }
}

/**
 * Writes the slug-to-name map to disk.
 *
 * @param {Record<string, string>} manifest - Display name per slug.
 * @returns {void}
 */
function writeManifest(manifest) {
  ensureWorkRoot();
  fs.writeFileSync(manifestPath(), `${JSON.stringify(manifest, null, 4)}\n`, 'utf8');
}

/**
 * Converts a display name into a folder-safe slug.
 *
 * @param {string} displayName - e.g. "Claude Work (Acme)".
 * @returns {string} e.g. "claude-work-acme".
 */
function slugify(displayName) {
  return String(displayName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Normalises any input, including old stored names, into a handle.
 *
 * "Claude Work", "Claude-Work" and "work" all become "claude-work". The same
 * string is used as folder slug, window title and shortcut name.
 *
 * @param {string} value - Raw name from the dialog or from the manifest.
 * @returns {string} e.g. "claude-work", or an empty string for blank input.
 */
function toHandle(value) {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^claude[\s-]*/i, '')
    .trim();

  const slug = slugify(cleaned);

  return slug ? `${DEFAULT_PREFIX}-${slug}` : '';
}

/**
 * Builds a handle-style name from user input.
 *
 * The result matches what people type into a search box or a GitHub handle:
 * lowercase, hyphenated, no spaces. "Work" and "Acme Ltd" become "claude-work"
 * and "claude-acme-ltd", and the folder uses exactly the same string.
 *
 * @param {string} rawName - Text typed by the user; may be empty.
 * @returns {string|null} e.g. "claude-work", or null for blank input.
 */
function buildDisplayName(rawName) {
  return toHandle(rawName) || null;
}

/**
 * Lists profile folder slugs on disk.
 *
 * A subfolder is a profile when this app created it (it is in profiles.json)
 * or Claude has used it (it holds Claude's "Local State" file). Any other
 * folder in the library, such as a copied app or an old backup, is ignored.
 *
 * @returns {string[]} Sorted slugs.
 */
function listSlugs() {
  if (!settings.isConfigured()) {
    return [];
  }

  ensureWorkRoot();
  const manifest = readManifest();

  try {
    return fs
      .readdirSync(workRoot(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => Object.hasOwn(manifest, name)
        || fs.existsSync(path.join(workRoot(), name, 'Local State')))
      .sort((left, right) => left.localeCompare(right));
  }
  catch {
    return [];
  }
}

/**
 * Returns the lowest unused handle, e.g. "claude-1", "claude-2".
 *
 * @param {string[]} usedSlugs - Slugs that already exist.
 * @returns {string} e.g. "claude-2".
 */
function nextFreeName(usedSlugs) {
  for (let number = 1; number <= 999; number += 1) {
    const candidate = `${DEFAULT_PREFIX}-${number}`;
    if (!usedSlugs.includes(candidate)) {
      return candidate;
    }
  }

  throw new Error('No free profile number left.');
}

/**
 * Reads the account UUID stored by Claude Desktop in a profile folder.
 *
 * @param {string} folder - Absolute profile folder.
 * @returns {string|null} Account UUID, or null when the profile never signed in.
 */
function readAccountId(folder) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(folder, 'config.json'), 'utf8'));
    return typeof config.lastKnownAccountUuid === 'string' ? config.lastKnownAccountUuid : null;
  }
  catch {
    return null;
  }
}

/**
 * Absolute path of the file that records when each profile was last launched.
 *
 * @returns {string} Path of last-used.json.
 */
function lastUsedPath() {
  return path.join(workRoot(), 'last-used.json');
}

/**
 * Reads the launch times, tolerating a missing or broken file.
 *
 * @returns {Record<string, number>} Epoch ms per slug.
 */
function readLastUsed() {
  try {
    const parsed = JSON.parse(fs.readFileSync(lastUsedPath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  }
  catch {
    return {};
  }
}

/**
 * Records that a profile was launched or created just now.
 *
 * @param {string} slug - Profile slug.
 * @returns {void}
 */
function markUsed(slug) {
  const lastUsed = readLastUsed();
  lastUsed[slug] = Date.now();
  writeLastUsed(lastUsed);
}

/**
 * Writes the launch times to disk.
 *
 * @param {Record<string, number>} lastUsed - Epoch ms per slug.
 * @returns {void}
 */
function writeLastUsed(lastUsed) {
  ensureWorkRoot();
  fs.writeFileSync(lastUsedPath(), `${JSON.stringify(lastUsed, null, 4)}
`, 'utf8');
}

/**
 * Best guess of when a profile was last used, for profiles with no record.
 *
 * Read once and then saved: a running Claude keeps writing its log, so
 * reading it on every refresh would make the list order keep changing.
 *
 * @param {string} folder - Absolute profile folder.
 * @returns {number} Epoch ms, 0 when unknown.
 */
function guessLastUsed(folder) {
  for (const candidate of [path.join(folder, 'logs', 'main.log'), folder]) {
    try {
      return fs.statSync(candidate).mtimeMs;
    }
    catch {
      // Try the next candidate.
    }
  }

  return 0;
}

/**
 * Lists every profile with its folder and sign-in state, last used first.
 *
 * @returns {Array<{slug: string, name: string, folder: string, accountId: string|null, lastUsed: number}>}
 */
function listProfiles() {
  const manifest = readManifest();
  const recorded = readLastUsed();
  const slugs = listSlugs();

  const missing = slugs.filter((slug) => !Number.isFinite(recorded[slug]));
  if (missing.length > 0) {
    for (const slug of missing) {
      recorded[slug] = guessLastUsed(path.join(workRoot(), slug));
    }
    writeLastUsed(recorded);
  }

  return slugs
    .map((slug) => {
      const folder = path.join(workRoot(), slug);
      return {
        slug,
        name: toHandle(manifest[slug]) || slug,
        folder,
        accountId: readAccountId(folder),
        lastUsed: recorded[slug],
      };
    })
    .sort((left, right) => right.lastUsed - left.lastUsed || left.slug.localeCompare(right.slug));
}

/**
 * Creates a profile folder and records its display name.
 *
 * An empty name picks the next free number, so repeated calls give claude-1,
 * claude-2, claude-3 without the user inventing names.
 *
 * @param {string} rawName - Text typed by the user; may be empty.
 * @returns {{slug: string, name: string, folder: string, accountId: string|null, created: boolean}}
 */
function createProfile(rawName) {
  const usedSlugs = listSlugs();
  const name = buildDisplayName(rawName) || nextFreeName(usedSlugs);
  const slug = slugify(name);
  const folder = path.join(workRoot(), slug);
  const created = !fs.existsSync(folder);

  fs.mkdirSync(folder, { recursive: true });

  const manifest = readManifest();
  manifest[slug] = name;
  writeManifest(manifest);
  markUsed(slug);

  return { slug, name, folder, accountId: readAccountId(folder), created };
}

/**
 * Moves a profile folder to the Recycle Bin and forgets the profile.
 *
 * The Recycle Bin, not a permanent delete, so a profile removed by mistake
 * can be restored with its sign-in and local sessions intact.
 *
 * @param {string} slug - Profile slug.
 * @returns {Promise<void>} Resolves once the folder is gone.
 */
async function removeProfile(slug) {
  const folder = folderFor(slug);
  if (fs.existsSync(folder)) {
    await shell.trashItem(folder);
  }

  const manifest = readManifest();
  delete manifest[slug];
  writeManifest(manifest);

  const lastUsed = readLastUsed();
  delete lastUsed[slug];
  writeLastUsed(lastUsed);
}

/**
 * Reports the display name that an empty input would use right now.
 *
 * Shown as the dialog placeholder, so the user sees "claude-4" and can simply
 * press Enter instead of inventing a name.
 *
 * @returns {string} e.g. "claude-4".
 */
function nextProfileName() {
  return nextFreeName(listSlugs());
}


/**
 * Returns the folder of one profile.
 *
 * @param {string} slug - Profile slug.
 * @returns {string} Absolute folder path.
 */
function folderFor(slug) {
  return path.join(workRoot(), slug);
}

module.exports = {
  workRoot,
  listProfiles,
  markUsed,
  removeProfile,
  createProfile,
  folderFor,
  nextProfileName,
  slugify,
};
