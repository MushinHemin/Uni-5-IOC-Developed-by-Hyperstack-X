'use strict';
const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('uniWindow', {
    getState: () => ipcRenderer.invoke('shell:state'),
    save: settings => ipcRenderer.invoke('shell:save', settings),
    retry: () => ipcRenderer.invoke('shell:retry'),
    open: () => ipcRenderer.invoke('shell:open'),
    back: () => ipcRenderer.invoke('shell:back'),
    forget: () => ipcRenderer.invoke('shell:forget'),
    onState: handler => ipcRenderer.on('shell:update', (_event, state) => handler(state))
  });
}
