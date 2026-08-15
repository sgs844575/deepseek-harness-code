/**
 * IPC 通道契约：主进程与 preload 共享的唯一事实来源。
 * 渲染进程不直接拼通道字符串，只调用 window.api 暴露的方法，
 * 因此通道名只在本文件与各 handler / preload 中流转。
 */
export const channels = {
  app: {
    getVersion: 'app:get-version',
    quit: 'app:quit',
    /** 重启应用（设置中“重启后生效”类项使用）。 */
    relaunch: 'app:relaunch',
    /** 导出文本文件：弹出系统保存对话框后落盘（会话导出 Markdown）。 */
    exportText: 'app:export-text',
    /** 选择文件夹（创建项目时选源目录）。 */
    pickFolder: 'app:pick-folder',
    /** 选择文件（附件上传，多选）。 */
    pickFiles: 'app:pick-files',
    /** 用系统默认浏览器打开外部链接（仅 https）。 */
    openExternal: 'app:open-external',
    /** 读取 Agent 规则文件（AGENTS.md：global=数据目录 / project=当前工作区）。 */
    readRules: 'app:read-rules',
    /** 写入 Agent 规则文件（不存在则创建）。 */
    writeRules: 'app:write-rules',
  },
  window: {
    minimize: 'window:minimize',
    toggleMaximize: 'window:toggle-maximize',
    close: 'window:close',
    isMaximized: 'window:is-maximized',
    /** 主进程 → 渲染层：最大化状态变化推送（无边框窗口自定义按钮用）。 */
    maximizeChanged: 'window:maximize-changed',
  },
  host: {
    getStatus: 'host:get-status',
    /** 主进程 → 渲染层的状态推送。 */
    statusChanged: 'host:status-changed',
    /** 切换工作区（项目）：harness 停机 → 改 DSH_CWD → 重新 boot。 */
    switchWorkspace: 'host:switch-workspace',
  },
  models: {
    list: 'models:list',
  },
  session: {
    create: 'session:create',
    open: 'session:open',
    list: 'session:list',
    /** 批量读取会话标题（侧栏冷启动展示；session/title 事件折叠值）。 */
    titles: 'session:titles',
    history: 'session:history',
    prompt: 'session:prompt',
    cancel: 'session:cancel',
    /** 派生会话：以父会话已完成回合为种子创建新会话。 */
    fork: 'session:fork',
    /** 父会话的子代理目录（冷数据）。 */
    subagents: 'session:subagents',
    /** 主进程 → 渲染层的事件流推送（统一信封）。 */
    event: 'session:event',
  },
  presets: {
    /** Agent 预设名单（无 roster 组合返回空数组）。 */
    list: 'presets:list',
    /** 默认预设（未指定时新会话挂载它）。 */
    getDefault: 'presets:get-default',
    /** 设置默认预设（影响之后创建的会话）。 */
    setDefault: 'presets:set-default',
    /** 切换空白会话的预设（已开始的会话拒绝：agent-preset-locked 语义）。 */
    select: 'presets:select',
  },
  interaction: {
    respondApproval: 'interaction:respond-approval',
    respondQuestion: 'interaction:respond-question',
  },
  settings: {
    getDefaultModel: 'settings:get-default-model',
    setDefaultModel: 'settings:set-default-model',
  },
  providers: {
    /** 完整快照（供应商列表 / 激活项 / 思考偏好）。 */
    getAll: 'providers:get-all',
    /** 新增或编辑供应商（自定义或改预设实例的名称/地址）。 */
    upsert: 'providers:upsert',
    /** 删除供应商（预设实例可重建，激活项不可删）。 */
    remove: 'providers:remove',
    /** 追加 API Key（逗号分隔多 key 批量添加，Cherry Studio 风格）。 */
    addApiKey: 'providers:add-api-key',
    /** 更新 Key 标签 / 启停。 */
    updateApiKey: 'providers:update-api-key',
    deleteApiKey: 'providers:delete-api-key',
    /** 从供应商 API 拉取模型目录（GET {baseURL}/models）并保存。 */
    fetchModels: 'providers:fetch-models',
    /** 手动添加 / 移除模型。 */
    addModel: 'providers:add-model',
    removeModel: 'providers:remove-model',
    /** 激活供应商（推送到 harness：baseURL / 模型目录 / 轮询密钥）。 */
    activate: 'providers:activate',
    /** 选择模型：跨供应商时先激活对应供应商，再设为默认模型。 */
    selectModel: 'providers:select-model',
    /** 更新思考偏好（thinking / reasoningEffort）。 */
    updatePrefs: 'providers:update-prefs',
    /** 主进程 → 渲染层：快照变更推送。 */
    changed: 'providers:changed',
  },
  appSettings: {
    getAll: 'app-settings:get-all',
    update: 'app-settings:update',
    /** 选择新数据根目录：复制现有 DSH 数据并保存（重启生效）。 */
    pickDataPath: 'app-settings:pick-data-path',
    /** 主进程 → 渲染层：设置变更推送。 */
    changed: 'app-settings:changed',
  },
  mcp: {
    /** 服务器列表快照。 */
    getAll: 'mcp:get-all',
    /** 新增 / 编辑服务器。 */
    upsert: 'mcp:upsert',
    /** 删除服务器。 */
    remove: 'mcp:remove',
    /** 启停服务器（不改其余字段）。 */
    setEnabled: 'mcp:set-enabled',
    /** 应用变更：harness 停机并以新组合重启。 */
    apply: 'mcp:apply',
    /** 主进程 → 渲染层：列表变更推送。 */
    changed: 'mcp:changed',
  },
} as const;

export type AppChannel = (typeof channels.app)[keyof typeof channels.app];
export type WindowChannel = (typeof channels.window)[keyof typeof channels.window];
export type HostChannel = (typeof channels.host)[keyof typeof channels.host];
export type ModelsChannel = (typeof channels.models)[keyof typeof channels.models];
export type SessionChannel = (typeof channels.session)[keyof typeof channels.session];
export type PresetChannel = (typeof channels.presets)[keyof typeof channels.presets];
export type InteractionChannel = (typeof channels.interaction)[keyof typeof channels.interaction];
export type SettingsChannel = (typeof channels.settings)[keyof typeof channels.settings];
export type ProviderChannel = (typeof channels.providers)[keyof typeof channels.providers];
export type AppSettingsChannel = (typeof channels.appSettings)[keyof typeof channels.appSettings];
export type McpChannel = (typeof channels.mcp)[keyof typeof channels.mcp];

/** 全部合法通道的字面量联合，供校验使用。 */
export type IpcChannel =
  | AppChannel
  | WindowChannel
  | HostChannel
  | ModelsChannel
  | SessionChannel
  | PresetChannel
  | InteractionChannel
  | SettingsChannel
  | ProviderChannel
  | AppSettingsChannel
  | McpChannel;
