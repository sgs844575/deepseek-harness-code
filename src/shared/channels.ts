/**
 * IPC 通道契约：主进程与 preload 共享的唯一事实来源。
 * 渲染进程不直接拼通道字符串，只调用 window.api 暴露的方法，
 * 因此通道名只在本文件与各 handler / preload 中流转。
 */
export const channels = {
  app: {
    getVersion: 'app:get-version',
    quit: 'app:quit',
  },
  window: {
    minimize: 'window:minimize',
    toggleMaximize: 'window:toggle-maximize',
    close: 'window:close',
  },
} as const;

export type AppChannel = (typeof channels.app)[keyof typeof channels.app];
export type WindowChannel = (typeof channels.window)[keyof typeof channels.window];

/** 全部合法通道的字面量联合，供校验使用。 */
export type IpcChannel = AppChannel | WindowChannel;
