import { registerAppHandlers } from './app-handlers.js';
import { registerWindowHandlers } from './window-handlers.js';
import { registerHarnessHandlers } from './harness-handlers.js';
import { registerAppSettingsHandlers } from './app-settings-handlers.js';
import { registerProviderHandlers } from './provider-handlers.js';
import { registerMcpHandlers } from './mcp-handlers.js';
import type { HarnessService } from '../harness/harness-service.js';
import type { SettingsService } from '../settings/settings-service.js';
import type { ProviderService } from '../providers/provider-service.js';
import type { McpService } from '../mcp/mcp-service.js';

export interface IpcOptions {
  harness: HarnessService;
  settings: SettingsService;
  providers: ProviderService;
  mcp: McpService;
}

/**
 * IPC 注册中心：主进程内注册所有通道的唯一入口。
 * 新增领域时，只需新建 xxx-handlers.ts 并在此挂载一行。
 */
export function registerIpcHandlers({ harness, settings, providers, mcp }: IpcOptions): void {
  registerAppHandlers();
  registerWindowHandlers();
  registerHarnessHandlers(harness);
  registerAppSettingsHandlers(settings);
  registerProviderHandlers(providers);
  registerMcpHandlers(mcp);
}
