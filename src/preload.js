'use strict';

/**
 * Bridge between the sandboxed renderer and the main process.
 *
 * Only these calls exist; the renderer has no Node access.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeProfiles', {
  list: () => ipcRenderer.invoke('profiles:list'),
  create: (name) => ipcRenderer.invoke('profiles:create', name),
  open: (slug) => ipcRenderer.invoke('profiles:open', slug),
  remove: (slug) => ipcRenderer.invoke('profiles:delete', slug),
  reveal: (slug) => ipcRenderer.invoke('profiles:reveal', slug),
  createShortcut: (slug) => ipcRenderer.invoke('profiles:create-shortcut', slug),
  removeShortcut: (slug) => ipcRenderer.invoke('profiles:remove-shortcut', slug),
  createAppShortcut: () => ipcRenderer.invoke('app:create-shortcut'),
  removeAppShortcut: () => ipcRenderer.invoke('app:remove-shortcut'),
  refresh: () => ipcRenderer.invoke('profiles:refresh'),
  chooseRoot: () => ipcRenderer.invoke('settings:choose-root'),
  useSuggestedRoot: () => ipcRenderer.invoke('settings:use-suggested-root'),
  openRoot: () => ipcRenderer.invoke('settings:open-root'),
  onState: (handler) => {
    ipcRenderer.on('profiles:state', (_event, state) => handler(state));
  },
});
