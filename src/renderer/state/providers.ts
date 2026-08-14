import { useCallback, useSyncExternalStore } from 'react';
import type {
  ProviderDto,
  ProviderPrefsDto,
  ProviderSnapshotDto,
} from '../../shared/protocol.js';
import { requireBridge } from '../ipc/api';

/**
 * 供应商配置（主进程 providers.json）的渲染层镜像。
 *
 * 真值在主进程：初始经 providers:get-all 拉取，之后靠 providers:changed
 * 推送保持同步（任何 key / 模型 / 激活 / 偏好变更都会整包重推）。
 * 渲染层永远只见脱敏 key；所有变更经 bridge 调主进程，回填以推送为准。
 */

const EMPTY_SNAPSHOT: ProviderSnapshotDto = {
  providers: [],
  activeProviderId: '',
  prefs: { thinking: 'enabled', reasoningEffort: 'high' },
};

let snapshot: ProviderSnapshotDto = EMPTY_SNAPSHOT;
let loaded = false;
const listeners = new Set<() => void>();

function publish(next: ProviderSnapshotDto): void {
  snapshot = next;
  for (const notify of listeners) notify();
}

/** 挂载前调用一次：拉取主进程真值并订阅推送。失败时保持空快照可用。 */
export function initProviders(): void {
  const bridge = requireBridge();
  void bridge.providers
    .getAll()
    .then(publish)
    .catch((error) => console.error('读取供应商配置失败', error))
    .finally(() => {
      loaded = true;
      for (const notify of listeners) notify();
    });
  bridge.providers.onChanged(publish);
}

export function getProviderSnapshot(): ProviderSnapshotDto {
  return snapshot;
}

export function isProvidersLoaded(): boolean {
  return loaded;
}

/** 激活供应商对象（快照缺省时返回 undefined）。 */
export function getActiveProvider(): ProviderDto | undefined {
  return snapshot.providers.find((provider) => provider.id === snapshot.activeProviderId);
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

/** React hook：读供应商快照并订阅变更。 */
export function useProviders(): {
  snapshot: ProviderSnapshotDto;
  loaded: boolean;
  activeProvider: ProviderDto | undefined;
  refresh: () => void;
} {
  const value = useSyncExternalStore(subscribe, getProviderSnapshot);
  const ready = useSyncExternalStore(subscribe, isProvidersLoaded);
  const refresh = useCallback(
    () => void requireBridge().providers.getAll().then(publish).catch(() => undefined),
    [],
  );
  return {
    snapshot: value,
    loaded: ready,
    activeProvider:
      value.providers.find((provider) => provider.id === value.activeProviderId) ?? undefined,
    refresh,
  };
}

/** 思考偏好更新的便捷封装（主进程推送回填）。 */
export function updateProviderPrefs(patch: Partial<ProviderPrefsDto>): void {
  void requireBridge()
    .providers.updatePrefs(patch)
    .catch((error) => console.error('保存思考偏好失败', error));
}
