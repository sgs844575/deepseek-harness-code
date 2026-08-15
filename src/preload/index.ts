import { contextBridge, ipcRenderer } from 'electron';
import { channels } from '../shared/channels.js';
import type { ElectronBridge } from '../shared/bridge.js';
import type {
  AgentPresetDto,
  AppSettingsDto,
  HarnessEventDto,
  HostStateDto,
  McpServerDto,
  McpUpsertDto,
  ProviderPrefsDto,
  ProviderSnapshotDto,
  ProviderUpsertDto,
} from '../shared/protocol.js';

/**
 * 渲染进程与主进程之间唯一的桥梁。
 * 只按白名单暴露明确的方法，不把 ipcRenderer 原样交出去，
 * 渲染层拿不到任意 invoke 的能力。
 * 桥的形状由 shared/bridge.d.ts 的 ElectronBridge 约束。
 */
const bridge: ElectronBridge = {
  app: {
    getVersion: () => ipcRenderer.invoke(channels.app.getVersion),
    quit: () => ipcRenderer.invoke(channels.app.quit),
    relaunch: () => ipcRenderer.invoke(channels.app.relaunch),
    exportText: (filename: string, content: string) =>
      ipcRenderer.invoke(channels.app.exportText, filename, content),
    pickFolder: () => ipcRenderer.invoke(channels.app.pickFolder),
    openExternal: (url: string) => ipcRenderer.invoke(channels.app.openExternal, url),
  },
  window: {
    minimize: () => ipcRenderer.invoke(channels.window.minimize),
    toggleMaximize: () => ipcRenderer.invoke(channels.window.toggleMaximize),
    close: () => ipcRenderer.invoke(channels.window.close),
    isMaximized: () => ipcRenderer.invoke(channels.window.isMaximized),
    onMaximizeChanged: (listener: (maximized: boolean) => void) => {
      const handler = (_event: unknown, maximized: boolean): void => listener(maximized);
      ipcRenderer.on(channels.window.maximizeChanged, handler);
      return () => {
        ipcRenderer.removeListener(channels.window.maximizeChanged, handler);
      };
    },
  },
  host: {
    getStatus: () => ipcRenderer.invoke(channels.host.getStatus),
    switchWorkspace: (cwd: string) => ipcRenderer.invoke(channels.host.switchWorkspace, cwd),
    onStatus: (listener: (state: HostStateDto) => void) => {
      const handler = (_event: unknown, state: HostStateDto): void => listener(state);
      ipcRenderer.on(channels.host.statusChanged, handler);
      return () => {
        ipcRenderer.removeListener(channels.host.statusChanged, handler);
      };
    },
  },
  models: {
    list: (provider: string) => ipcRenderer.invoke(channels.models.list, provider),
  },
  session: {
    create: (options?: { model?: string; preset?: string }) =>
      ipcRenderer.invoke(channels.session.create, options),
    open: (sessionId: string) => ipcRenderer.invoke(channels.session.open, sessionId),
    list: () => ipcRenderer.invoke(channels.session.list),
    history: (sessionId: string) => ipcRenderer.invoke(channels.session.history, sessionId),
    prompt: (sessionId: string, text: string, options?: { mode?: 'queue' | 'steer' }) =>
      ipcRenderer.invoke(channels.session.prompt, sessionId, text, options),
    cancel: (sessionId: string) => ipcRenderer.invoke(channels.session.cancel, sessionId),
    fork: (sessionId: string) => ipcRenderer.invoke(channels.session.fork, sessionId),
    subagents: (sessionId: string) => ipcRenderer.invoke(channels.session.subagents, sessionId),
    onEvent: (listener: (envelope: HarnessEventDto) => void) => {
      const handler = (_event: unknown, envelope: HarnessEventDto): void => listener(envelope);
      ipcRenderer.on(channels.session.event, handler);
      return () => {
        ipcRenderer.removeListener(channels.session.event, handler);
      };
    },
  },
  presets: {
    list: (): Promise<AgentPresetDto[]> => ipcRenderer.invoke(channels.presets.list),
    getDefault: (): Promise<string | undefined> => ipcRenderer.invoke(channels.presets.getDefault),
    setDefault: (id: string): Promise<void> => ipcRenderer.invoke(channels.presets.setDefault, id),
    select: (sessionId: string, presetId: string): Promise<void> =>
      ipcRenderer.invoke(channels.presets.select, sessionId, presetId),
  },
  interaction: {
    respondApproval: (id: string, outcome: 'allowed-once' | 'rejected') =>
      ipcRenderer.invoke(channels.interaction.respondApproval, id, outcome),
    respondQuestion: (id: string, answers: { id: string; selected: string[]; custom?: string }[]) =>
      ipcRenderer.invoke(channels.interaction.respondQuestion, id, answers),
  },
  settings: {
    getDefaultModel: () => ipcRenderer.invoke(channels.settings.getDefaultModel),
    setDefaultModel: (model: string) =>
      ipcRenderer.invoke(channels.settings.setDefaultModel, model),
  },
  providers: {
    getAll: () => ipcRenderer.invoke(channels.providers.getAll),
    upsert: (input: ProviderUpsertDto) => ipcRenderer.invoke(channels.providers.upsert, input),
    remove: (id: string) => ipcRenderer.invoke(channels.providers.remove, id),
    addApiKey: (providerId: string, keys: string, label?: string) =>
      ipcRenderer.invoke(channels.providers.addApiKey, providerId, keys, label),
    updateApiKey: (providerId: string, keyId: string, patch: { label?: string; isEnabled?: boolean }) =>
      ipcRenderer.invoke(channels.providers.updateApiKey, providerId, keyId, patch),
    deleteApiKey: (providerId: string, keyId: string) =>
      ipcRenderer.invoke(channels.providers.deleteApiKey, providerId, keyId),
    fetchModels: (providerId: string) => ipcRenderer.invoke(channels.providers.fetchModels, providerId),
    addModel: (providerId: string, model: { id: string; name?: string }) =>
      ipcRenderer.invoke(channels.providers.addModel, providerId, model),
    removeModel: (providerId: string, modelId: string) =>
      ipcRenderer.invoke(channels.providers.removeModel, providerId, modelId),
    activate: (providerId: string) => ipcRenderer.invoke(channels.providers.activate, providerId),
    selectModel: (providerId: string, modelId: string) =>
      ipcRenderer.invoke(channels.providers.selectModel, providerId, modelId),
    updatePrefs: (patch: Partial<ProviderPrefsDto>) =>
      ipcRenderer.invoke(channels.providers.updatePrefs, patch),
    onChanged: (listener: (snapshot: ProviderSnapshotDto) => void) => {
      const handler = (_event: unknown, snapshot: ProviderSnapshotDto): void => listener(snapshot);
      ipcRenderer.on(channels.providers.changed, handler);
      return () => {
        ipcRenderer.removeListener(channels.providers.changed, handler);
      };
    },
  },
  appSettings: {
    getAll: () => ipcRenderer.invoke(channels.appSettings.getAll),
    update: (patch: Partial<AppSettingsDto>) =>
      ipcRenderer.invoke(channels.appSettings.update, patch),
    pickDataPath: () => ipcRenderer.invoke(channels.appSettings.pickDataPath),
    onChanged: (listener: (settings: AppSettingsDto) => void) => {
      const handler = (_event: unknown, settings: AppSettingsDto): void => listener(settings);
      ipcRenderer.on(channels.appSettings.changed, handler);
      return () => {
        ipcRenderer.removeListener(channels.appSettings.changed, handler);
      };
    },
  },
  mcp: {
    getAll: () => ipcRenderer.invoke(channels.mcp.getAll),
    upsert: (input: McpUpsertDto) => ipcRenderer.invoke(channels.mcp.upsert, input),
    remove: (id: string) => ipcRenderer.invoke(channels.mcp.remove, id),
    setEnabled: (id: string, enabled: boolean) =>
      ipcRenderer.invoke(channels.mcp.setEnabled, id, enabled),
    apply: () => ipcRenderer.invoke(channels.mcp.apply),
    onChanged: (listener: (servers: McpServerDto[]) => void) => {
      const handler = (_event: unknown, servers: McpServerDto[]): void => listener(servers);
      ipcRenderer.on(channels.mcp.changed, handler);
      return () => {
        ipcRenderer.removeListener(channels.mcp.changed, handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld('api', bridge);
