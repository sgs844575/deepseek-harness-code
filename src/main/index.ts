import { app } from 'electron';
import { WindowManager } from './windows/window-manager.js';
import { HarnessService } from './harness/harness-service.js';
import { buildBootPatches } from './harness/composition.js';
import { registerIpcHandlers } from './ipc/index.js';
import { initLifecycle } from './lifecycle.js';
import { channels } from '../shared/channels.js';
import { AppSettingsStore, loadAppSettingsFile } from './settings/app-settings-store.js';
import { SettingsService, applyProxyEnv } from './settings/settings-service.js';
import { AutomationService } from './automation/automation-service.js';
import { ProviderStore } from './providers/provider-store.js';
import { ProviderService } from './providers/provider-service.js';
import { McpStore } from './mcp/mcp-store.js';
import { McpService } from './mcp/mcp-service.js';
import {
  appSettingsFilePath,
  mcpServersFilePath,
  migrateLegacyUserData,
  providersFilePath,
  resolveCacheDir,
} from './paths/app-paths.js';

/**
 * 主进程组合根：只做模块组装与依赖注入，不含任何业务逻辑。
 * 阅读顺序建议：lifecycle → window-manager → harness-service → settings → ipc → preload。
 */
const windowManager = new WindowManager();
const mcpStore = new McpStore(mcpServersFilePath());
const mcpService = new McpService(mcpStore);
// boot 补丁在每次 start 时读取最新应用设置（沙箱开关）与 MCP 服务器列表。
const harnessService = new HarnessService({
  buildPatches: () =>
    buildBootPatches({
      mcpServers: mcpStore.enabledRecords(),
      sandbox: loadAppSettingsFile(appSettingsFilePath()).sandboxEnabled,
      workspaceRoot: process.env.DSH_CWD ?? process.cwd(),
    }),
});

// 旧布局（Electron userData）一次性迁移到 ~/.deep-seek-harness-code；
// 必须先于任何设置/路径读取执行。
migrateLegacyUserData();

// 启动期一次性读取设置：硬件加速必须在 app ready 前关闭；
// 代理环境变量必须在 harness boot 前就位（两者都只随重启变化）。
const bootSettings = loadAppSettingsFile(appSettingsFilePath());
if (!bootSettings.hardwareAcceleration) app.disableHardwareAcceleration();
applyProxyEnv(bootSettings.httpProxy);

// 未打包的 Windows 应用没有安装器登记的 AppUserModelId，系统通知会静默失败；
// 用可执行文件路径作 AUMID 是 Electron 的通行做法。
if (process.platform === 'win32') app.setAppUserModelId(process.execPath);

const settingsStore = new AppSettingsStore(appSettingsFilePath());
const providerStore = new ProviderStore(providersFilePath());
const providerService = new ProviderService(providerStore);
// 缓存目录随启动就位（<appHome>/cache）。
resolveCacheDir();

function broadcast(channel: string, payload: unknown): void {
  for (const win of windowManager.getAll()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

const settingsService = new SettingsService({
  store: settingsStore,
  broadcast,
  harness: harnessService,
  windowManager,
});
// 自动化调度：设置即数据源（store 变更即时生效），触发走 harness 会话面。
const automationService = new AutomationService({ store: settingsStore, harness: harnessService });

initLifecycle({
  windowManager,
  onReady: () => {
    registerIpcHandlers({ harness: harnessService, settings: settingsService, providers: providerService, mcp: mcpService });
    settingsService.start();
    automationService.start();
    // 宿主状态与事件流推送到所有窗口；事件同时喂给设置服务（通知 / 提问自动继续）。
    harnessService.onStatus((state) => broadcast(channels.host.statusChanged, state));
    harnessService.onEvent((envelope) => {
      settingsService.handleHarnessEvent(envelope);
      broadcast(channels.session.event, envelope);
    });
    // 供应商快照与 MCP 列表变更推送（多窗口同步）。
    providerStore.subscribe((snapshot) => broadcast(channels.providers.changed, snapshot));
    mcpStore.subscribe((servers) => broadcast(channels.mcp.changed, servers));
    const mainWin = windowManager.createMainWindow();
    settingsService.attachWindow(mainWin);
    // harness 启动不阻塞窗口展示；状态经 host:status-changed 推送。
    // 就绪后注入 key 轮换器并推送激活供应商配置（baseURL / 模型 / 密钥）。
    void harnessService.start().then(() => {
      harnessService.setKeyResolver(() => providerService.keyForNextTurn());
      providerService.attach(harnessService);
      mcpService.attach(harnessService);
    });
  },
});

// 停机时尽力销毁 harness 根 fiber（会话日志按事件即时落盘，尽力即可）。
app.on('before-quit', () => {
  automationService.stop();
  void harnessService.stop();
});
