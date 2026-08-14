import type { ElectronBridge } from '../../shared/bridge.js';

/**
 * 为渲染进程声明 Window.api 的类型。
 * 形状来自 shared/bridge.d.ts，与 preload 的暴露内容同源。
 */
declare global {
  interface Window {
    api: ElectronBridge;
  }
}

export {};
