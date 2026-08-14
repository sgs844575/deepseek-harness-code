import { app } from 'electron';

/**
 * lifecycle 依赖的最小窗口管理能力（结构化类型），
 * 只声明本模块用到的行为，避免与具体 WindowManager 实现耦合。
 */
export interface ManagedWindows {
  focusMain(): void;
  getAll(): unknown[];
  createMainWindow(): void;
}

export interface LifecycleOptions {
  windowManager: ManagedWindows;
  /** 应用 ready 后的启动动作，由组合根注入。 */
  onReady: () => void;
}

/**
 * 应用生命周期：单实例锁、启动时机、退出策略。
 * 只负责“什么时候做什么”；“启动后做什么”通过 onReady 注入，
 * 因此本模块不依赖窗口管理或 IPC 的任何细节。
 */
export function initLifecycle({ windowManager, onReady }: LifecycleOptions): void {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on('second-instance', () => windowManager.focusMain());

  void app.whenReady().then(onReady);

  app.on('window-all-closed', () => {
    // Windows/Linux：所有窗口关闭即退出；macOS：保留应用等待再次激活。
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (windowManager.getAll().length === 0) {
      windowManager.createMainWindow();
    }
  });
}
