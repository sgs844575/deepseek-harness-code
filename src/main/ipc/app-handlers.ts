import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { writeFile } from 'node:fs/promises';
import { channels } from '../../shared/channels.js';

/**
 * 应用级 IPC 处理器：版本查询、退出、文本导出、文件夹选择等。
 * 每个函数只注册自己领域的通道，互不干扰。
 */
export function registerAppHandlers(): void {
  ipcMain.handle(channels.app.getVersion, () => app.getVersion());

  ipcMain.handle(channels.app.quit, () => {
    app.quit();
  });

  // 重启应用：设置中“重启后生效”类项（硬件加速 / 代理环境 / 数据路径）使用。
  ipcMain.handle(channels.app.relaunch, () => {
    app.relaunch();
    app.quit();
  });

  ipcMain.handle(
    channels.app.exportText,
    async (event, filename: unknown, content: unknown) => {
      if (typeof filename !== 'string' || typeof content !== 'string') {
        throw new Error('exportText 参数必须是字符串');
      }
      const win = BrowserWindow.fromWebContents(event.sender);
      // 文件名只留安全字符，避免默认名里混入路径分隔符等。
      const safeName = filename.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || 'export.md';
      const options = {
        defaultPath: safeName,
        filters: [{ name: 'Markdown', extensions: ['md'] }] as Electron.FileFilter[],
      };
      const { canceled, filePath } =
        win !== null ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (canceled || filePath === undefined) return { saved: false };
      await writeFile(filePath, content, 'utf-8');
      return { saved: true, path: filePath };
    },
  );

  // 选择文件夹（创建项目的源目录）。
  ipcMain.handle(channels.app.pickFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: '选择项目文件夹',
      properties: ['openDirectory'] as Electron.OpenDialogOptions['properties'],
    };
    const { canceled, filePaths } =
      win !== null ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const folder = filePaths[0];
    if (canceled || folder === undefined) return { canceled: true };
    return { canceled: false, path: folder };
  });

  // 用系统默认浏览器打开外部链接（仅接受 https，防 file:/javascript: 注入）。
  ipcMain.handle(channels.app.openExternal, async (_event, url: unknown) => {
    if (typeof url !== 'string') throw new Error('openExternal 参数必须是字符串');
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('无效的链接');
    }
    if (parsed.protocol !== 'https:') throw new Error('仅支持 https 链接');
    await shell.openExternal(parsed.href);
  });
}
