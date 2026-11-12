/**
 * Renderer-local copy of the shared types plus the window.claudeProfiles
 * typing. The renderer's tsconfig (rootDir src/renderer) cannot import from
 * src/shared, so keep this in sync with src/shared/types.ts by hand.
 */

/** One profile as stored on disk. */
interface Profile {
  slug: string;
  name: string;
  folder: string;
  accountId: string | null;
  lastUsed: number;
}

/** A profile as shown in the window, with live status. */
interface ProfileView extends Profile {
  desktopOpen: boolean;
  shortcutCount: number;
}

/** Everything the window renders, pushed by the main process. */
interface AppState {
  configured: boolean;
  suggestedRoot: string;
  libraryRoot: string | null;
  libraryRootShort: string;
  nextProfileName: string;
  desktopPath: string | null;
  platform: string;
  appShortcut: boolean;
  appVersion: string;
  profiles: ProfileView[];
}

/** Result of creating a profile. */
interface CreatedProfile extends Omit<Profile, 'lastUsed'> {
  created: boolean;
}

/** Result of the delete command. */
interface DeleteResult {
  deleted: boolean;
  name?: string;
}

/** Result of creating a shortcut file. */
interface ShortcutResult {
  path: string;
}

/** The API the preload script exposes as window.claudeProfiles. */
interface ClaudeProfilesApi {
  list(): Promise<AppState>;
  create(name: string): Promise<CreatedProfile>;
  open(slug: string): Promise<AppState>;
  remove(slug: string): Promise<DeleteResult>;
  reveal(slug: string): Promise<string>;
  createShortcut(slug: string): Promise<ShortcutResult>;
  removeShortcut(slug: string): Promise<AppState>;
  createAppShortcut(): Promise<ShortcutResult>;
  removeAppShortcut(): Promise<AppState>;
  refresh(): Promise<AppState>;
  chooseRoot(): Promise<AppState>;
  useSuggestedRoot(): Promise<AppState>;
  openRoot(): Promise<string>;
  openRepo(): Promise<void>;
  onState(handler: (state: AppState) => void): void;
}

interface Window {
  claudeProfiles: ClaudeProfilesApi;
}
