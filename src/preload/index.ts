import { contextBridge, ipcRenderer } from 'electron';
import { channels } from '../shared/channels.js';
import type { ElectronBridge } from '../shared/bridge.js';

/**
 * 渲染进程与主进程之间唯一的桥梁。
 * 只按白名单暴露明确的方法，不把 ipcRenderer 原样交出去，
 * 渲染层拿不到任意 invoke 的能力。
 * 桥的形状由 shared/bridge.d.ts 的 ElectronBridge 约束。
 */
const bridge: ElectronBridge = {
  app: {
    getVersion: () => ipcRenderer.invoke(channels.app.getVersion),
    quit: () => ipcRenderer.invoke(channels.app.quit),
  },
  window: {
    minimize: () => ipcRenderer.invoke(channels.window.minimize),
    toggleMaximize: () => ipcRenderer.invoke(channels.window.toggleMaximize),
    close: () => ipcRenderer.invoke(channels.window.close),
  },
};

contextBridge.exposeInMainWorld('api', bridge);
