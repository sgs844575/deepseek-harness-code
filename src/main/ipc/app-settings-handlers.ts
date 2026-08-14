import { ipcMain } from 'electron';
import { channels } from '../../shared/channels.js';
import type { AppSettingsDto } from '../../shared/protocol.js';
import type { SettingsService } from '../settings/settings-service.js';

/**
 * 应用设置 IPC 处理器：读写与数据路径迁移，全部转发给 SettingsService。
 * 归一化与副作用都在服务/store 内完成，这里只做通道粘合。
 */
export function registerAppSettingsHandlers(service: SettingsService): void {
  ipcMain.handle(channels.appSettings.getAll, () => service.getSettings());

  ipcMain.handle(channels.appSettings.update, (_event, patch: unknown) => {
    return service.update((patch ?? {}) as Partial<AppSettingsDto>);
  });

  ipcMain.handle(channels.appSettings.pickDataPath, (event) => service.pickDataPath(event.sender));
}
