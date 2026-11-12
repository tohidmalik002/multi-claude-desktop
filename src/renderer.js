'use strict';

/**
 * Renderer: sidebar of profiles, detail pane with the launch action.
 *
 * The app never renders chat itself. It only hands a profile folder to the
 * native Claude Desktop, so every account keeps its own login and settings.
 */

const api = window.claudeProfiles;

let state = {
  profiles: [],
  configured: true,
  suggestedRoot: '',
  libraryRoot: '',
  desktopPath: null,
  platform: 'win32',
  nextProfileName: '',
  appShortcut: false,
};

let selectedSlug = null;
let toastTimer = null;
let renderedStateKey = '';
let renderedSelection = null;

const ui = {
  list: document.getElementById('profile-list'),
  detail: document.getElementById('detail'),
  empty: document.getElementById('empty'),
  setup: document.getElementById('setup'),
  setupPath: document.getElementById('setup-path'),
  useSuggested: document.getElementById('btn-use-suggested'),
  chooseRoot: document.getElementById('btn-choose-root'),
  setupShortcut: document.getElementById('setup-shortcut'),
  emptyNew: document.getElementById('btn-empty-new'),
  refresh: document.getElementById('btn-refresh'),
  newButton: document.getElementById('btn-new'),
  newForm: document.getElementById('new-form'),
  newName: document.getElementById('new-name'),
  rootPath: document.getElementById('root-path'),
  openRoot: document.getElementById('btn-open-root'),
  changeRoot: document.getElementById('btn-change-root'),
  platformLabel: document.getElementById('platform-label'),
  profileCount: document.getElementById('profile-count'),
  appShortcut: document.getElementById('btn-app-shortcut'),
  appVersion: document.getElementById('app-version'),
  repo: document.getElementById('btn-repo'),
  toast: document.getElementById('toast'),
  modal: document.getElementById('modal'),
  cancelNew: document.getElementById('btn-cancel-new'),
};


/**
 * Creates a DOM node with an optional class and text.
 *
 * @param {string} tag - Element name.
 * @param {string} [className] - CSS classes to apply.
 * @param {string} [text] - Text content.
 * @returns {HTMLElement} The new node.
 */
function element(tag, className, text) {
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
 * @param {string} name - e.g. "claude-acme-ltd".
 * @returns {string} e.g. "AL", or "C" when the name carries no word.
 */
function initials(name) {
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
 * @param {string} slug - Profile slug.
 * @returns {string} e.g. "avatar-3".
 */
function avatarClass(slug) {
  const total = String(slug).split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return `avatar-${total % 6}`;
}


/**
 * Shortens an account UUID for display.
 *
 * @param {string|null} accountId - Full UUID from config.json.
 * @returns {string} First eight characters, or an empty string.
 */
function shortId(accountId) {
  return accountId ? accountId.slice(0, 8) : '';
}


/**
 * Opens the "New profile" dialog.
 *
 * @returns {void}
 */
function openNewProfileDialog() {
  ui.modal.hidden = false;
  ui.newName.value = '';
  ui.newName.placeholder = state.nextProfileName || 'claude-1';
  ui.newName.focus();
}


/**
 * Closes the "New profile" dialog.
 *
 * @returns {void}
 */
function closeNewProfileDialog() {
  ui.modal.hidden = true;
}


/**
 * Shows a short message in the bottom-right corner.
 *
 * @param {string} message - Text to display.
 * @param {boolean} [isError] - Styles the toast as an error.
 * @returns {void}
 */
function showToast(message, isError = false) {
  // Errors thrown in the main process arrive wrapped by Electron's IPC layer.
  const text = String(message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  ui.toast.textContent = text;
  ui.toast.classList.toggle('is-error', isError);
  ui.toast.hidden = false;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast.hidden = true;
  }, isError ? 10000 : 4000);
}


/**
 * Keeps the selection valid after profiles or the library folder change.
 *
 * @returns {void}
 */
function ensureSelection() {
  const stillExists = state.profiles.some((profile) => profile.slug === selectedSlug);
  if (stillExists) {
    return;
  }

  selectedSlug = state.profiles.length > 0 ? state.profiles[0].slug : null;
}


/**
 * Renders the sidebar entry for one profile.
 *
 * @param {object} profile - Profile record from the main process.
 * @returns {HTMLLIElement} List item ready to append.
 */
function buildProfileItem(profile) {
  const item = element('li');
  const button = element('button', 'profile-item');
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
 * @returns {void}
 */
function renderList() {
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
 * @returns {HTMLElement} Notice node.
 */
function buildSignInNotice() {
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
 * @param {string} label - Left-hand label.
 * @param {string} value - Middle text, usually a path.
 * @param {boolean} monospace - Renders the value as code.
 * @param {Array<{label: string, action: string}>} actions - Buttons on the right.
 * @returns {HTMLElement} Row node.
 */
function buildRow(label, value, monospace, actions) {
  const row = element('div', 'row');
  row.append(element('span', 'row-label', label));
  row.append(element(monospace ? 'code' : 'span', 'row-value', value));

  const buttons = element('span', 'row-actions');
  for (const item of actions) {
    const button = element('button', 'link', item.label);
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
 * @param {object} profile - Profile record from the main process.
 * @returns {HTMLElement} Card node.
 */
function buildProfileCard(profile) {
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

  const launch = element('button', 'primary', profile.desktopOpen ? 'Focus window' : 'Launch');
  launch.type = 'button';
  launch.dataset.action = 'open';

  const addShortcut = element('button', 'secondary', 'Add to desktop');
  addShortcut.type = 'button';
  addShortcut.dataset.action = 'make-shortcut';
  addShortcut.title = 'Creates another desktop shortcut for this profile each time you click it.';

  const remove = element('button', 'icon-button');
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
 * @returns {void}
 */
function renderDetail() {
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
 * @returns {void}
 */
function render() {
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
 * @returns {Promise<void>} Resolves after rendering.
 */
async function reload() {
  state = await api.list();
  ensureSelection();
  render();
}


/**
 * Completes the setup screen: stores the folder, then adds the launcher
 * shortcut when its box is ticked.
 *
 * @param {() => Promise<object>} chooseFolder - Stores a folder, returns state.
 * @returns {Promise<void>} Resolves after repainting.
 */
async function finishSetup(chooseFolder) {
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
    showToast(error.message.split('\n')[0], true);
  }
}


/**
 * Wires sidebar, topbar and detail interactions.
 *
 * @returns {void}
 */
function bindEvents() {
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
      showToast(error.message, true);
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
      showToast(error.message, true);
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
      showToast(error.message, true);
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
      showToast(error.message.split('\n')[0], true);
    }
  });

  ui.detail.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
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
      showToast(error.message.split('\n')[0], true);
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
 * @returns {Promise<void>} Resolves once the UI is painted.
 */
async function start() {
  bindEvents();
  await reload();
}

start().catch((error) => showToast(error.message, true));
