const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  print: () => ipcRenderer.invoke('app:print'),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getMachineId: () => ipcRenderer.invoke('app:getMachineId'),
  getSyncInfo: () => ipcRenderer.invoke('sync:getInfo'),
  getSyncWsUrl: () => ipcRenderer.invoke('sync:getWsUrl'),
  restartSync: (port) => ipcRenderer.invoke('sync:restart', port),
  licenseRequest: (args) => ipcRenderer.invoke('license:request', args),
  windowControls: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximize: () => ipcRenderer.invoke('win:maximize'),
    close: () => ipcRenderer.invoke('win:close'),
    isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
    onMaximizedChange: (cb) => {
      const listener = (_e, value) => cb(value);
      ipcRenderer.on('win:maximized', listener);
      return () => ipcRenderer.removeListener('win:maximized', listener);
    },
  },
});
