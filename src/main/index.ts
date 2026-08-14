import { WindowManager } from './windows/window-manager.js';
import { registerIpcHandlers } from './ipc/index.js';
import { initLifecycle } from './lifecycle.js';

/**
 * 主进程组合根：只做模块组装与依赖注入，不含任何业务逻辑。
 * 阅读顺序建议：lifecycle → window-manager → ipc → preload。
 */
const windowManager = new WindowManager();

initLifecycle({
  windowManager,
  onReady: () => {
    registerIpcHandlers();
    windowManager.createMainWindow();
  },
});
