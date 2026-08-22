// Secure bridge between the Electron main process and the web app.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('LordTempsDesktop', {
    isDesktop: true,
    onUpdateAvailable: (callback) => {
        ipcRenderer.on('update-available', (_event, info) => callback(info));
    },
    openExternal: (url) => ipcRenderer.invoke('open-external', url)
});