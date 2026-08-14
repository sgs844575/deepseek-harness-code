import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow } from 'electron';
import { appConfig } from '../config/app-config.js';
import { channels } from '../../shared/channels.js';

/**
 * 主窗口工厂：唯一职责是描述“主窗口长什么样、加载什么页面”。
 * 不负责窗口的登记与生命周期管理（那是 WindowManager 的职责）。
 *
 * vite 产物布局：主进程与 preload 同在 .vite/build/（index.mjs / index.js），
 * 渲染层产物在 .vite/renderer/main/。开发模式加载 dev server，生产加载本地文件。
 *
 * 无边框窗口（frame: false）：去掉系统默认标题栏，由渲染层 Titlebar 自绘
 * （拖拽区 + Windows Fluent 窗口控件）；最大化状态经 maximizeChanged 推送。
 */
const buildDir = path.dirname(fileURLToPath(import.meta.url));

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: appConfig.mainWindow.width,
    height: appConfig.mainWindow.height,
    minWidth: appConfig.mainWindow.minWidth,
    minHeight: appConfig.mainWindow.minHeight,
    title: appConfig.productName,
    frame: false,
    // 先隐藏，首帧（启动引导页）绘制完成后再显示：避免 Windows 无边框窗口
    // 在渲染进程画出第一帧之前露出原生白色表面（backgroundColor 拦不住）。
    show: false,
    // 背景色与启动引导页/深色壁纸底色一致，作为 ready-to-show 之前的兜底。
    backgroundColor: '#070911',
    webPreferences: {
      preload: path.join(buildDir, 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  const sendMaximized = (): void => {
    if (!win.isDestroyed()) win.webContents.send(channels.window.maximizeChanged, win.isMaximized());
  };
  win.on('maximize', sendMaximized);
  win.on('unmaximize', sendMaximized);

  if (MAIN_VITE_DEV_SERVER_URL) {
    void win.loadURL(MAIN_VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(buildDir, '..', 'renderer', appConfig.rendererDir, 'index.html'));
  }
  return win;
}
