import type { ElectronBridge } from '../../shared/bridge.js';

/**
 * 渲染层对 preload 桥的薄封装。
 * 页面代码不直接触碰 window.api，统一从这里导入，
 * 便于做防御性检查，也便于将来替换通信实现。
 */
const bridge: ElectronBridge | null = window.api ?? null;

function requireBridge(): ElectronBridge {
  if (!bridge) {
    throw new Error('window.api 不可用：请确认 preload 脚本已正确加载');
  }
  return bridge;
}

export const appApi = {
  getVersion: () => requireBridge().app.getVersion(),
  quit: () => requireBridge().app.quit(),
};

export const windowApi = {
  minimize: () => requireBridge().window.minimize(),
  toggleMaximize: () => requireBridge().window.toggleMaximize(),
  close: () => requireBridge().window.close(),
};
