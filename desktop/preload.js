'use strict';

const { contextBridge, ipcRenderer } = require('electron');

window.__codecppErrors = [];
window.addEventListener('error', (event) => {
  window.__codecppErrors.push(String(event.message || event.error || 'unknown error'));
});
window.addEventListener('unhandledrejection', (event) => {
  window.__codecppErrors.push('unhandledrejection: ' + String(event.reason && event.reason.message || event.reason));
});

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('CCDesktop', {
  isDesktop: true,
  window(action) { ipcRenderer.send('codecpp:window', action); },
  onWindowState(callback) { return subscribe('codecpp:window-state', callback); },
  onCommand(callback) { return subscribe('codecpp:command', callback); },
  getWindowState() { return ipcRenderer.invoke('codecpp:window-state:get'); },
  reportDirty(count) { ipcRenderer.send('codecpp:dirty', Number(count) || 0); },
  onSaveAll(handler) {
    return subscribe('codecpp:save-all', async (requestId) => {
      try {
        await handler();
        ipcRenderer.send('codecpp:save-all-reply', requestId, true);
      } catch (error) {
        ipcRenderer.send('codecpp:save-all-reply', requestId, false,
          String(error && error.message || error));
      }
    });
  },
  info() { return ipcRenderer.invoke('codecpp:info'); },
  pickFolder() { return ipcRenderer.invoke('codecpp:pick-folder'); },
  pickArchive() { return ipcRenderer.invoke('codecpp:pick-archive'); },
  reveal(relativePath) { return ipcRenderer.invoke('codecpp:reveal', relativePath); },
  openExternal(url) { ipcRenderer.send('codecpp:open-external', url); },
  reload() { ipcRenderer.send('codecpp:reload'); }
});
