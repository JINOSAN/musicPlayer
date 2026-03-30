const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ウィンドウ操作
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // ファイル操作
  readFileBuffer: (filePath) => ipcRenderer.invoke('read-file-buffer', filePath),
  readMetadata: (filePath) => ipcRenderer.invoke('read-metadata', filePath),

  // システムボリューム
  getSystemVolume: () => ipcRenderer.invoke('get-system-volume'),
});
