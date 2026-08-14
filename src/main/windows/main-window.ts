import path from 'node:path';
import { BrowserWindow } from 'electron';
import { appConfig } from '../config/app-config.js';

/**
 * 主窗口工厂：唯一职责是描述“主窗口长什么样、加载什么页面”。
 * 不负责窗口的登记与生命周期管理（那是 WindowManager 的职责）。
 */
export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: appConfig.mainWindow.width,
    height: appConfig.mainWindow.height,
    minWidth: appConfig.mainWindow.minWidth,
    minHeight: appConfig.mainWindow.minHeight,
    title: appConfig.productName,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  void win.loadFile(appConfig.rendererEntry);
  return win;
}
