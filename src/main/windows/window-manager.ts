import type { BrowserWindow } from 'electron';
import { createMainWindow } from './main-window.js';

/**
 * 窗口管理器：集中管理窗口实例的登记、查询与销毁。
 * 不关心单个窗口的配置细节（main-window.ts 的职责），
 * 也不关心应用何时该创建窗口（lifecycle.ts 的职责）。
 */
export class WindowManager {
  private readonly windows = new Map<number, BrowserWindow>();

  createMainWindow(): BrowserWindow {
    const win = createMainWindow();
    this.windows.set(win.id, win);
    win.on('closed', () => this.windows.delete(win.id));
    return win;
  }

  /** 取最早创建的窗口作为主窗口（当前只有一个窗口的简化语义）。 */
  getMain(): BrowserWindow | undefined {
    const first = this.windows.entries().next();
    return first.done ? undefined : first.value[1];
  }

  getAll(): BrowserWindow[] {
    return [...this.windows.values()];
  }

  focusMain(): void {
    const win = this.getMain();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  }

  destroyAll(): void {
    for (const win of this.windows.values()) win.destroy();
    this.windows.clear();
  }
}
