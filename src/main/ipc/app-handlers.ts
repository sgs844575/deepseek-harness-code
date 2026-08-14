import { app, ipcMain } from 'electron';
import { channels } from '../../shared/channels.js';

/**
 * 应用级 IPC 处理器：版本查询、退出等与窗口无关的能力。
 * 每个函数只注册自己领域的通道，互不干扰。
 */
export function registerAppHandlers(): void {
  ipcMain.handle(channels.app.getVersion, () => app.getVersion());

  ipcMain.handle(channels.app.quit, () => {
    app.quit();
  });
}
