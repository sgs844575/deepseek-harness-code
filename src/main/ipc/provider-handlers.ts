import { ipcMain } from 'electron';
import { channels } from '../../shared/channels.js';
import type { ProviderPrefsDto, ProviderUpsertDto } from '../../shared/protocol.js';
import type { ProviderService } from '../providers/provider-service.js';

/**
 * providers.* 通道注册：一行一通道，全部转发给 ProviderService / ProviderStore。
 * 快照变更经组合根注入的 broadcast 推送（channels.providers.changed）。
 */
export function registerProviderHandlers(service: ProviderService): void {
  const store = service.getStore();

  ipcMain.handle(channels.providers.getAll, () => service.snapshot());

  ipcMain.handle(channels.providers.upsert, (_event, input: ProviderUpsertDto) =>
    store.upsert(input),
  );

  ipcMain.handle(channels.providers.remove, (_event, id: string) => {
    store.remove(id);
  });

  ipcMain.handle(
    channels.providers.addApiKey,
    (_event, providerId: string, keys: unknown, label?: unknown) => {
      // 兼容单字符串与数组；逗号 / 换行分隔批量（Cherry Studio 同款）。
      const list = typeof keys === 'string' ? keys.split(/[,\n]/) : Array.isArray(keys) ? keys : [];
      return store.addApiKeys(
        providerId,
        list.filter((item): item is string => typeof item === 'string'),
        typeof label === 'string' ? label : '',
      );
    },
  );

  ipcMain.handle(
    channels.providers.updateApiKey,
    (_event, providerId: string, keyId: string, patch: { label?: string; isEnabled?: boolean }) =>
      store.updateApiKey(providerId, keyId, patch),
  );

  ipcMain.handle(channels.providers.deleteApiKey, (_event, providerId: string, keyId: string) => {
    store.deleteApiKey(providerId, keyId);
  });

  ipcMain.handle(channels.providers.fetchModels, (_event, providerId: string) =>
    service.fetchModels(providerId),
  );

  ipcMain.handle(
    channels.providers.addModel,
    (_event, providerId: string, model: { id: string; name?: string }) =>
      store.addModel(providerId, model),
  );

  ipcMain.handle(channels.providers.removeModel, (_event, providerId: string, modelId: string) => {
    store.removeModel(providerId, modelId);
  });

  ipcMain.handle(channels.providers.activate, (_event, id: string) => {
    store.activate(id);
  });

  ipcMain.handle(channels.providers.selectModel, (_event, providerId: string, modelId: string) =>
    service.selectModel(providerId, modelId),
  );

  ipcMain.handle(channels.providers.updatePrefs, (_event, patch: Partial<ProviderPrefsDto>) => {
    store.updatePrefs(patch);
  });
}
