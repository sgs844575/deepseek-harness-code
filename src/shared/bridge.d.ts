/**
 * 渲染进程可见的桥接 API 形状。
 * preload 用它约束暴露内容，渲染层用它声明 Window.api 类型，
 * 两端共用同一份类型定义，防止契约漂移。
 */
import type {
  AppSettingsDto,
  HostStateDto,
  HarnessEventDto,
  ModelInfoDto,
  PickDataPathResultDto,
  PickFolderResultDto,
  PromptModeDto,
  ProviderDto,
  ProviderModelDto,
  ProviderPrefsDto,
  ProviderSnapshotDto,
  ProviderUpsertDto,
  QuestionAnswerDto,
  SessionEventDto,
  SessionSummaryDto,
} from './protocol.js';

export interface ElectronBridge {
  app: {
    getVersion(): Promise<string>;
    quit(): Promise<void>;
    /** 重启应用（设置中“重启后生效”类项使用）。 */
    relaunch(): Promise<void>;
    /**
     * 弹出保存对话框写入文本文件（UTF-8）。
     * 用户取消返回 { saved: false }。
     */
    exportText(filename: string, content: string): Promise<{ saved: boolean; path?: string }>;
    /** 弹出系统文件夹选择对话框（创建项目的源目录）。用户取消返回 { canceled: true }。 */
    pickFolder(): Promise<PickFolderResultDto>;
    /** 用系统默认浏览器打开外部链接（仅 https）。 */
    openExternal(url: string): Promise<void>;
  };
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    /** 订阅最大化状态变化；返回取消订阅函数。 */
    onMaximizeChanged(listener: (maximized: boolean) => void): () => void;
  };
  host: {
    getStatus(): Promise<HostStateDto>;
    /** 切换工作区（项目）：返回切换后的宿主状态。 */
    switchWorkspace(cwd: string): Promise<HostStateDto>;
    /** 订阅宿主状态推送；返回取消订阅函数。 */
    onStatus(listener: (state: HostStateDto) => void): () => void;
  };
  models: {
    list(provider: string): Promise<ModelInfoDto[]>;
  };
  session: {
    create(options?: { model?: string }): Promise<{ sessionId: string }>;
    open(sessionId: string): Promise<void>;
    list(): Promise<SessionSummaryDto[]>;
    history(sessionId: string): Promise<SessionEventDto[]>;
    prompt(sessionId: string, text: string, options?: { mode?: PromptModeDto }): Promise<void>;
    cancel(sessionId: string): Promise<void>;
    /** 订阅事件流推送；返回取消订阅函数。 */
    onEvent(listener: (envelope: HarnessEventDto) => void): () => void;
  };
  interaction: {
    respondApproval(id: string, outcome: 'allowed-once' | 'rejected'): Promise<boolean>;
    respondQuestion(id: string, answers: QuestionAnswerDto[]): Promise<boolean>;
  };
  settings: {
    getDefaultModel(): Promise<{ provider: string; model: string }>;
    setDefaultModel(model: string): Promise<void>;
  };
  providers: {
    /** 完整快照（供应商列表 / 激活项 / 思考偏好）。 */
    getAll(): Promise<ProviderSnapshotDto>;
    /** 新增（无 id）或编辑（有 id）供应商。 */
    upsert(input: ProviderUpsertDto): Promise<ProviderDto>;
    remove(id: string): Promise<void>;
    /** 批量添加 API Key（逗号分隔多 key）；返回新增条数。 */
    addApiKey(providerId: string, keys: string, label?: string): Promise<number>;
    updateApiKey(
      providerId: string,
      keyId: string,
      patch: { label?: string; isEnabled?: boolean },
    ): Promise<void>;
    deleteApiKey(providerId: string, keyId: string): Promise<void>;
    /** 从供应商 API 拉取模型目录并保存（兼作连接检查）。 */
    fetchModels(providerId: string): Promise<ProviderModelDto[]>;
    addModel(providerId: string, model: { id: string; name?: string }): Promise<void>;
    removeModel(providerId: string, modelId: string): Promise<void>;
    /** 激活供应商（推送到 harness，热生效）。 */
    activate(providerId: string): Promise<void>;
    /** 选择模型：跨供应商时先激活对应供应商，再设为默认模型。 */
    selectModel(providerId: string, modelId: string): Promise<void>;
    updatePrefs(patch: Partial<ProviderPrefsDto>): Promise<void>;
    /** 订阅快照变更推送；返回取消订阅函数。 */
    onChanged(listener: (snapshot: ProviderSnapshotDto) => void): () => void;
  };
  appSettings: {
    getAll(): Promise<AppSettingsDto>;
    /** 部分更新（服务端逐字段归一化），返回更新后的完整设置。 */
    update(patch: Partial<AppSettingsDto>): Promise<AppSettingsDto>;
    /** 选择新数据根目录：复制现有 DSH 数据并保存（重启生效）。 */
    pickDataPath(): Promise<PickDataPathResultDto>;
    /** 订阅设置变更推送；返回取消订阅函数。 */
    onChanged(listener: (settings: AppSettingsDto) => void): () => void;
  };
}
