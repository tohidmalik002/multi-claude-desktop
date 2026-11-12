/**
 * Renderer: sidebar of profiles, detail pane with the launch action.
 *
 * The app never renders chat itself. It only hands a profile folder to the
 * native Claude Desktop, so every account keeps its own login and settings.
 */

const api = window.claudeProfiles;

let state: AppState = {
  profiles: [],
  configured: true,
  suggestedRoot: '',
  libraryRoot: null,
  libraryRootShort: '',
  desktopPath: null,
  platform: 'win32',
  nextProfileName: '',
  appShortcut: false,
  appVersion: '',
};

let selectedSlug: string | null = null;
let toastTimer: number | null = null;
let renderedStateKey = '';
let renderedSelection: string | null = null;

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing element #${id}`);
  }
  return node as T;
}

const ui = {
  list: byId<HTMLUListElement>('profile-list'),
  detail: byId<HTMLElement>('detail'),
  empty: byId<HTMLElement>('empty'),
  setup: byId<HTMLElement>('setup'),
  setupPath: byId<HTMLElement>('setup-path'),
  useSuggested: byId<HTMLButtonElement>('btn-use-suggested'),
  chooseRoot: byId<HTMLButtonElement>('btn-choose-root'),
  setupShortcut: byId<HTMLInputElement>('setup-shortcut'),
  emptyNew: byId<HTMLButtonElement>('btn-empty-new'),
  refresh: byId<HTMLButtonElement>('btn-refresh'),
  newButton: byId<HTMLButtonElement>('btn-new'),
  newForm: byId<HTMLFormElement>('new-form'),
  newName: byId<HTMLInputElement>('new-name'),
  rootPath: byId<HTMLDivElement>('root-path'),
  openRoot: byId<HTMLButtonElement>('btn-open-root'),
  changeRoot: byId<HTMLButtonElement>('btn-change-root'),
  platformLabel: byId<HTMLDivElement>('platform-label'),
  profileCount: byId<HTMLElement>('profile-count'),
  appShortcut: byId<HTMLButtonElement>('btn-app-shortcut'),
  appVersion: byId<HTMLElement>('app-version'),
  repo: byId<HTMLButtonElement>('btn-repo'),
  toast: byId<HTMLDivElement>('toast'),
  modal: byId<HTMLDivElement>('modal'),
  cancelNew: byId<HTMLButtonElement>('btn-cancel-new'),
};


/**
 * Creates a DOM node with an optional class and text.
 *
 * @param tag - Element name.
 * @param [className] - CSS classes to apply.
 * @param [text] - Text content.
 * @returns The new node.
 */
function element(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}


/**
 * Builds the avatar label for a profile name.
 *
 * Names are handles such as "claude-work" or "claude-acme-ltd", so the prefix
 * and the separators are removed before taking initials.
 *
 * @param name - e.g. "claude-acme-ltd".
 * @returns e.g. "AL", or "C" when the name carries no word.
 */
function initials(name: string): string {
  const words = String(name)
    .replace(/^claude[-\s]*/i, '')
    .split(/[-_\s]+/)
    .filter(Boolean);

  if (words.length === 0 || /^\d+$/.test(words[0])) {
    return 'C';
  }

  return words.slice(0, 2).map((word) => word.charAt(0).toUpperCase()).join('');
}


/**
 * Picks a stable avatar colour class from the profile slug.
 *
 * @param slug - Profile slug.
 * @returns e.g. "avatar-3".
 */
function avatarClass(slug: string): string {
  const total = String(slug).split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return `avatar-${total % 6}`;
}


/**
 * Shortens an account UUID for display.
 *
 * @param accountId - Full UUID from config.json.
 * @returns First eight characters, or an empty string.
 */
function shortId(accountId: string | null): string {
  return accountId ? accountId.slice(0, 8) : '';
}


/**
 * Opens the "New profile" dialog.
 *
 * @returns
 */
function openNewProfileDialog(): void {
  ui.modal.hidden = false;
  ui.newName.value = '';
  ui.newName.placeholder = state.nextProfileName || 'claude-1';
  ui.newName.focus();
}


/**
 * Closes the "New profile" dialog.
 *
 * @returns
 */
function closeNewProfileDialog(): void {
  ui.modal.hidden = true;
}


/**
 * Shows a short message in the bottom-right corner.
 *
 * @param message - Text to display.
 * @param [isError] - Styles the toast as an error.
 * @returns
 */
function showToast(message: string, isError = false): void {
  // Errors thrown in the main process arrive wrapped by Electron's IPC layer.
  const text = String(message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  ui.toast.textContent = text;
  ui.toast.classList.toggle('is-error', isError);
  ui.toast.hidden = false;

  clearTimeout(toastTimer ?? undefined);
  toastTimer = setTimeout(() => {
    ui.toast.hidden = true;
  }, isError ? 10000 : 4000);
}


/**
 * Keeps the selection valid after profiles or the library folder change.
 *
 * @returns
 */
function ensureSelection(): void {
  const stillExists = state.profiles.some((profile) => profile.slug === selectedSlug);
  if (stillExists) {
    return;
  }

  selectedSlug = state.profiles.length > 0 ? state.profiles[0].slug : null;
}


/**
 * Renders the sidebar entry for one profile.
 *
 * @param profile - Profile record from the main process.
 * @returns List item ready to append.
 */
function buildProfileItem(profile: ProfileView): HTMLLIElement {
  const item = element('li') as HTMLLIElement;
  const button = element('button', 'profile-item') as HTMLButtonElement;
  button.type = 'button';

  if (profile.slug === selectedSlug) {
    button.classList.add('is-selected');
  }

  const status = profile.desktopOpen
    ? 'running'
    : (profile.accountId ? shortId(profile.accountId) : 'not signed in');

  const text = element('span', 'profile-text');
  text.append(element('span', 'profile-name', profile.name));

  const meta = element('span', 'profile-meta');
  const dot = element('span', 'dot');
  if (profile.desktopOpen) {
    dot.classList.add('is-live');
  }
  meta.append(dot, element('span', '', status));
  text.append(meta);

  button.append(element('span', `avatar ${avatarClass(profile.slug)}`, initials(profile.name)), text);
  button.addEventListener('click', () => {
    selectedSlug = profile.slug;
    render();
  });
  item.append(button);

  return item;
}


/**
 * Renders the whole sidebar list.
 *
 * @returns
 */
function renderList(): void {
  ui.list.textContent = '';

  if (state.profiles.length === 0) {
    ui.list.append(element('li', 'profile-meta', 'No profiles yet'));
    return;
  }

  for (const profile of state.profiles) {
    ui.list.append(buildProfileItem(profile));
  }
}


/**
 * Builds the sign-in hint shown for profiles that never signed in.
 *
 * Google sign-in finishes through a browser redirect, which hands the session
 * back to the default Claude window and can land on the wrong profile.
 *
 * @returns Notice node.
 */
function buildSignInNotice(): HTMLElement {
  const notice = element('div', 'notice');
  notice.append(element('strong', '', 'First launch: sign in with email + code'));
  notice.append(
    element(
      'p',
      '',
      'Sign in with your email and the 6-digit code. Avoid "Continue with Google": the redirect reopens the default Claude window, so this profile can end up signed in as the wrong account.',
    ),
  );

  return notice;
}


/**
 * Builds one label / value / action line of the profile card.
 *
 * @param label - Left-hand label.
 * @param value - Middle text, usually a path.
 * @param monospace - Renders the value as code.
 * @param actions - Buttons on the right.
 * @returns Row node.
 */
function buildRow(label: string, value: string, monospace: boolean, actions: Array<{label: string, action: string}>): HTMLElement {
  const row = element('div', 'row');
  row.append(element('span', 'row-label', label));
  row.append(element(monospace ? 'code' : 'span', 'row-value', value));

  const buttons = element('span', 'row-actions');
  for (const item of actions) {
    const button = element('button', 'link', item.label) as HTMLButtonElement;
    button.type = 'button';
    button.dataset.action = item.action;
    buttons.append(button);
  }
  row.append(buttons);

  return row;
}


/**
 * Renders the detail pane for one profile.
 *
 * @param profile - Profile record from the main process.
 * @returns Card node.
 */
function buildProfileCard(profile: ProfileView): HTMLElement {
  const card = element('div', 'card');

  const head = element('header', 'card-head');
  const title = element('div', 'card-title');
  title.append(element('h2', '', profile.name));

  const status = element('div', 'status');
  status.append(element('span', profile.accountId ? 'status-dot is-signed' : 'status-dot'));
  status.append(
    element('span', '', profile.accountId ? `Signed in · ${shortId(profile.accountId)}` : 'Not signed in'),
  );

  if (profile.desktopOpen) {
    status.append(element('span', 'status-sep', '·'));
    status.append(element('span', '', 'Window open'));
  }

  title.append(status);

  const launch = element('button', 'primary', profile.desktopOpen ? 'Focus window' : 'Launch') as HTMLButtonElement;
  launch.type = 'button';
  launch.dataset.action = 'open';

  const addShortcut = element('button', 'secondary', 'Add to desktop') as HTMLButtonElement;
  addShortcut.type = 'button';
  addShortcut.dataset.action = 'make-shortcut';
  addShortcut.title = 'Creates another desktop shortcut for this profile each time you click it.';

  const remove = element('button', 'icon-button') as HTMLButtonElement;
  remove.type = 'button';
  remove.dataset.action = 'delete';
  remove.title = 'Delete profile';
  remove.setAttribute('aria-label', `Delete ${profile.name}`);
  remove.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" '
    + 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>';

  const actions = element('div', 'card-actions');
  actions.append(remove, addShortcut, launch);

  head.append(title, actions);
  card.append(head);

  if (!profile.accountId) {
    card.append(buildSignInNotice());
  }

  const rows = element('div', 'rows');
  rows.append(buildRow('Folder', profile.folder, true, [{ label: 'Show', action: 'reveal' }]));

  const shortcutActions = profile.shortcutCount > 0
    ? [{ label: 'Remove all', action: 'remove-shortcut' }]
    : [];

  rows.append(
    buildRow(
      'Desktop shortcut',
      profile.shortcutCount > 0 ? `${profile.shortcutCount} on the desktop` : 'None yet. Use Add to desktop above.',
      false,
      shortcutActions,
    ),
  );
  card.append(rows);

  card.append(
    element(
      'p',
      'hint',
      'Each profile is a separate folder, so logins, local Claude Code sessions and MCP settings never mix. Chats stay on Anthropic\'s servers.',
    ),
  );

  return card;
}


/**
 * Renders the detail pane, or nothing when there is no selection.
 *
 * @returns
 */
function renderDetail(): void {
  ui.detail.textContent = '';
  ui.setup.hidden = state.configured;
  ui.setupPath.textContent = state.suggestedRoot;
  ui.empty.hidden = !state.configured || state.profiles.length > 0;

  const profile = state.profiles.find((candidate) => candidate.slug === selectedSlug);
  ui.detail.hidden = !profile;
  if (!profile) {
    return;
  }

  ui.detail.append(buildProfileCard(profile));
}


/**
 * Paints the sidebar, topbar and detail pane from the current state.
 *
 * The background refresh pushes state every two seconds. Rebuilding the DOM
 * when nothing changed makes rows and colours flicker, so identical snapshots
 * are ignored. A selection change still repaints even with identical data.
 *
 * @returns
 */
function render(): void {
  const stateKey = JSON.stringify(state);
  if (stateKey === renderedStateKey && selectedSlug === renderedSelection) {
    return;
  }

  renderedStateKey = stateKey;
  renderedSelection = selectedSlug;

  ui.rootPath.textContent = state.configured
    ? (state.libraryRootShort || state.libraryRoot)
    : 'Not chosen yet';
  ui.newButton.disabled = !state.configured;
  ui.openRoot.disabled = !state.configured;
  ui.rootPath.title = state.libraryRoot || '';
  ui.platformLabel.textContent = state.platform === 'win32'
    ? 'Windows · one folder per account'
    : 'Linux · one folder per account';
  ui.appVersion.textContent = state.appVersion ? `v${state.appVersion}` : '';
  ui.profileCount.textContent = state.profiles.length > 0 ? String(state.profiles.length) : '';
  ui.appShortcut.textContent = state.appShortcut ? '✓ Desktop shortcut' : '+ Desktop shortcut';
  ui.appShortcut.title = state.appShortcut
    ? 'A Multi Claude Desktop shortcut is on your desktop. Click to remove it.'
    : 'Add a Multi Claude Desktop shortcut to your desktop.';

  renderList();
  renderDetail();
}


/**
 * Pulls fresh state from the main process and repaints.
 *
 * @returns Resolves after rendering.
 */
async function reload(): Promise<void> {
  state = await api.list();
  ensureSelection();
  render();
}


/**
 * Completes the setup screen: stores the folder, then adds the launcher
 * shortcut when its box is ticked.
 *
 * @param chooseFolder - Stores a folder, returns state.
 * @returns Resolves after repainting.
 */
async function finishSetup(chooseFolder: () => Promise<AppState>): Promise<void> {
  try {
    state = await chooseFolder();
    if (!state.configured) {
      render();
      return;
    }

    if (ui.setupShortcut.checked && !state.appShortcut) {
      await api.createAppShortcut();
      state = await api.list();
    }

    ensureSelection();
    render();
    showToast(`Profiles will be stored in ${state.libraryRoot}`);
  }
  catch (error) {
    showToast((error instanceof Error ? error.message : String(error)).split('\n')[0], true);
  }
}


/**
 * Wires sidebar, topbar and detail interactions.
 *
 * @returns
 */
function bindEvents(): void {
  ui.newButton.addEventListener('click', openNewProfileDialog);

  ui.cancelNew.addEventListener('click', closeNewProfileDialog);

  ui.modal.addEventListener('click', (event) => {
    if (event.target === ui.modal) {
      closeNewProfileDialog();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !ui.modal.hidden) {
      closeNewProfileDialog();
    }
  });

  ui.newForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      const created = await api.create(ui.newName.value);
      selectedSlug = created.slug;
      closeNewProfileDialog();
      await reload();
    }
    catch (error) {
      showToast(error instanceof Error ? error.message : String(error), true);
    }
  });

  ui.emptyNew.addEventListener('click', openNewProfileDialog);

  ui.refresh.addEventListener('click', async () => {
    try {
      state = await api.refresh();
      ensureSelection();
      render();
    }
    catch (error) {
      showToast(error instanceof Error ? error.message : String(error), true);
    }
  });

  ui.useSuggested.addEventListener('click', () => finishSetup(api.useSuggestedRoot));

  ui.chooseRoot.addEventListener('click', () => finishSetup(api.chooseRoot));

  ui.changeRoot.addEventListener('click', async () => {
    try {
      state = await api.chooseRoot();
      ensureSelection();
      render();
    }
    catch (error) {
      showToast(error instanceof Error ? error.message : String(error), true);
    }
  });

  ui.openRoot.addEventListener('click', () => api.openRoot());

  ui.repo.addEventListener('click', () => api.openRepo());

  ui.appShortcut.addEventListener('click', async () => {
    try {
      if (state.appShortcut) {
        await api.removeAppShortcut();
        await reload();
        showToast('Launcher shortcut removed.');
        return;
      }

      const result = await api.createAppShortcut();
      await reload();
      showToast(`Launcher shortcut created: ${result.path}`);
    }
    catch (error) {
      showToast((error instanceof Error ? error.message : String(error)).split('\n')[0], true);
    }
  });

  ui.detail.addEventListener('click', async (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
    const action = target ? target.dataset.action : null;
    if (!action) {
      return;
    }

    const profile = state.profiles.find((candidate) => candidate.slug === selectedSlug);
    if (!profile) {
      return;
    }

    try {
      if (action === 'open') {
        await api.open(profile.slug);
        showToast(`Launching ${profile.name}…`);
      }
      if (action === 'reveal') {
        await api.reveal(profile.slug);
      }
      if (action === 'make-shortcut') {
        const result = await api.createShortcut(profile.slug);
        showToast(`Desktop shortcut created: ${result.path}`);
      }
      if (action === 'delete') {
        const result = await api.remove(profile.slug);
        if (result.deleted) {
          showToast(`${result.name} moved to the Recycle Bin.`);
        }
      }
      if (action === 'remove-shortcut') {
        await api.removeShortcut(profile.slug);
        showToast('Desktop shortcut removed.');
      }
    }
    catch (error) {
      showToast((error instanceof Error ? error.message : String(error)).split('\n')[0], true);
    }
  });

  api.onState((next) => {
    state = next;
    ensureSelection();
    render();
  });

}


/**
 * Loads the first state snapshot and starts listening for updates.
 *
 * @returns Resolves once the UI is painted.
 */
async function start(): Promise<void> {
  bindEvents();
  await reload();
}

start().catch((error: unknown) => showToast(error instanceof Error ? error.message : String(error), true));
