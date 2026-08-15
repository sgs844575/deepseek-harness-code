import { ipcMain } from 'electron';
import { channels } from '../../shared/channels.js';
import type { UserPluginUpsertDto } from '../../shared/protocol.js';
import type { PluginService } from '../plugins/plugin-service.js';

/** 插件相关 IPC 处理器：状态快照 / 自定义插件的增删启停 / 应用变更。 */
export function registerPluginHandlers(plugins: PluginService): void {
  ipcMain.handle(channels.plugins.getAll, () => plugins.snapshot());

  ipcMain.handle(channels.plugins.upsert, (_event, input: UserPluginUpsertDto) =>
    plugins.upsert(input),
  );

  ipcMain.handle(channels.plugins.remove, (_event, id: string) => plugins.remove(id));

  ipcMain.handle(channels.plugins.setEnabled, (_event, id: string, enabled: boolean) =>
    plugins.setEnabled(id, enabled),
  );

  ipcMain.handle(channels.plugins.apply, () => plugins.apply());
}
