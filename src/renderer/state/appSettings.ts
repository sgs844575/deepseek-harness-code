import { useCallback, useSyncExternalStore } from 'react';
import type { AppSettingsDto } from '../../shared/protocol.js';
import { requireBridge } from '../ipc/api';

/**
 * 应用设置（主进程持久化）的渲染层镜像。
 *
 * 真值在主进程 app-settings.json：初始经 getAll 拉取，之后靠
 * app-settings:changed 推送保持同步。首帧先展示默认值（与主进程默认一致），
 * 加载完成后无缝替换。更新走乐观本地应用 + invoke 服务端归一化回填。
 */

const DEFAULTS: AppSettingsDto = {
  terminalShell: 'system',
  httpProxy: '',
  hardwareAcceleration: true,
  notifications: true,
  notificationSound: true,
  closeToTray: false,
  keepAwake: false,
  interactionBehavior: 'queue',
  agentMode: 'ask',
  autoContinueQuestions: false,
  showThinking: true,
  showTodos: true,
  autoArchive: false,
  archiveRetentionDays: 7,
  dataPath: '',
  projects: [],
  automations: [],
  sandboxEnabled: false,
};

let settings: AppSettingsDto = { ...DEFAULTS };
/** 本次进程启动时主进程的快照：用于“重启后生效”类项的已变更判断。 */
let bootSettings: AppSettingsDto = { ...DEFAULTS };
let loaded = false;
const listeners = new Set<() => void>();

function publish(next: AppSettingsDto): void {
  settings = next;
  for (const notify of listeners) notify();
}

/** 挂载前调用一次：拉取主进程真值并订阅推送。失败时保持默认值可用。 */
export function initAppSettings(): void {
  const bridge = requireBridge();
  void bridge.appSettings
    .getAll()
    .then((value) => {
      bootSettings = value;
      publish(value);
    })
    .catch((error) => console.error('读取应用设置失败', error))
    .finally(() => {
      loaded = true;
      for (const notify of listeners) notify();
    });
  bridge.appSettings.onChanged((value) => publish(value));
}

export function getAppSettings(): AppSettingsDto {
  return settings;
}

/** 本次启动时的设置快照（判断“重启后生效”项是否已被修改）。 */
export function getBootAppSettings(): AppSettingsDto {
  return bootSettings;
}

export function isAppSettingsLoaded(): boolean {
  return loaded;
}

/** 更新：本地乐观生效，服务端归一化后以返回值为准回填。 */
export function updateAppSettings(patch: Partial<AppSettingsDto>): void {
  publish({ ...settings, ...patch });
  void requireBridge()
    .appSettings.update(patch)
    .then((value) => publish(value))
    .catch((error) => console.error('保存应用设置失败', error));
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

/** React hook：读应用设置并订阅变更（loaded 表示主进程真值已到）。 */
export function useAppSettings(): {
  settings: AppSettingsDto;
  boot: AppSettingsDto;
  loaded: boolean;
  update: (patch: Partial<AppSettingsDto>) => void;
} {
  const value = useSyncExternalStore(subscribe, getAppSettings);
  const boot = useSyncExternalStore(subscribe, getBootAppSettings);
  const ready = useSyncExternalStore(subscribe, isAppSettingsLoaded);
  const update = useCallback((patch: Partial<AppSettingsDto>) => updateAppSettings(patch), []);
  return { settings: value, boot, loaded: ready, update };
}
