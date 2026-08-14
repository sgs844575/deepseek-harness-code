import { registerAppHandlers } from './app-handlers.js';
import { registerWindowHandlers } from './window-handlers.js';

/**
 * IPC 注册中心：主进程内注册所有通道的唯一入口。
 * 新增领域时，只需新建 xxx-handlers.ts 并在此挂载一行。
 */
export function registerIpcHandlers(): void {
  registerAppHandlers();
  registerWindowHandlers();
}
