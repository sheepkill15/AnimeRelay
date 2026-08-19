const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('animeRelay', {
  getSnapshot: () => ipcRenderer.invoke('snapshot:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  connectMal: () => ipcRenderer.invoke('mal:connect'),
  searchAnime: (query) => ipcRenderer.invoke('anime:search', query),
  confirmEvent: (eventId, candidate) => ipcRenderer.invoke('event:confirm', eventId, candidate),
  ignoreEvent: (eventId) => ipcRenderer.invoke('event:ignore', eventId),
  openExtensionFolder: () => ipcRenderer.invoke('extension:open'),
  openDiscordPortal: () => ipcRenderer.invoke('discord:open-portal'),
  onSnapshot: (listener) => {
    const wrapped = (_event, snapshot) => listener(snapshot);
    ipcRenderer.on('snapshot', wrapped);
    return () => ipcRenderer.removeListener('snapshot', wrapped);
  },
});
