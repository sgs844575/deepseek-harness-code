import { BrowserWindow, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { channels } from '../../shared/channels.js';

/**
 * 窗口级 IPC 处理器：通过事件来源（sender）定位发起调用的窗口，
 * 不持有 WindowManager 引用，保持与窗口管理层解耦。
 */
function windowFromEvent(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

export function registerWindowHandlers(): void {
  ipcMain.handle(channels.window.minimize, (event) => {
    windowFromEvent(event)?.minimize();
  });

  ipcMain.handle(channels.window.toggleMaximize, (event) => {
    const win = windowFromEvent(event);
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.handle(channels.window.isMaximized, (event) => {
    return windowFromEvent(event)?.isMaximized() ?? false;
  });

  ipcMain.handle(channels.window.close, (event) => {
    windowFromEvent(event)?.close();
  });
}
