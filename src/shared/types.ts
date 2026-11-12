/**
 * Types shared by the main process and the preload bridge.
 *
 * The renderer cannot import from here (its own tsconfig has rootDir
 * src/renderer), so src/renderer/global.d.ts keeps a mirror of these types.
 */

/** One profile as stored on disk. */
export interface Profile {
  slug: string;
  name: string;
  folder: string;
  accountId: string | null;
  lastUsed: number;
}

/** A profile as shown in the window, with live status. */
export interface ProfileView extends Profile {
  desktopOpen: boolean;
  shortcutCount: number;
}

/** Everything the window renders, pushed by the main process. */
export interface AppState {
  configured: boolean;
  suggestedRoot: string;
  libraryRoot: string | null;
  libraryRootShort: string;
  nextProfileName: string;
  desktopPath: string | null;
  platform: NodeJS.Platform;
  appShortcut: boolean;
  appVersion: string;
  profiles: ProfileView[];
}

/** Result of creating a profile. */
export interface CreatedProfile extends Omit<Profile, 'lastUsed'> {
  created: boolean;
}

/** Result of the delete command. */
export interface DeleteResult {
  deleted: boolean;
  name?: string;
}

/** Result of creating a shortcut file. */
export interface ShortcutResult {
  path: string;
}

/** The API the preload script exposes as window.claudeProfiles. */
export interface ClaudeProfilesApi {
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
