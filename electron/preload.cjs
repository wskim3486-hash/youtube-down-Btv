const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clipPortDesktop', Object.freeze({
  isDesktop: true,
  chooseSavePath: options => ipcRenderer.invoke('desktop:choose-save-path', options),
  saveDownload: options => ipcRenderer.invoke('desktop:save-download', options)
}));
