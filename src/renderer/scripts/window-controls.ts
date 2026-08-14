import type { ElectronBridge } from '../../shared/bridge.js';

export interface WindowControlButtons {
  minimizeButton: HTMLElement | null;
  toggleMaximizeButton: HTMLElement | null;
  closeButton: HTMLElement | null;
}

/**
 * 职责：把标题栏按钮与窗口操作绑定起来。
 * 只做事件绑定，不关心 IPC 细节（windowApi 由调用方注入）。
 */
export function bindWindowControls(
  buttons: WindowControlButtons,
  windowApi: ElectronBridge['window'],
): void {
  buttons.minimizeButton?.addEventListener('click', () => windowApi.minimize());
  buttons.toggleMaximizeButton?.addEventListener('click', () => windowApi.toggleMaximize());
  buttons.closeButton?.addEventListener('click', () => windowApi.close());
}
