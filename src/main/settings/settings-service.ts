import { app, BrowserWindow, dialog, Menu, nativeImage, Notification, powerSaveBlocker, session, Tray } from 'electron';
import { cp } from 'node:fs/promises';
import path from 'node:path';
import { channels } from '../../shared/channels.js';
import type { AppSettingsDto, PickDataPathResultDto } from '../../shared/protocol.js';
import { resolveHarnessPaths } from '../harness/paths.js';
import type { HarnessEventEnvelope, HarnessService } from '../harness/harness-service.js';
import type { AppSettingsStore } from './app-settings-store.js';
import { TRAY_ICON_BASE64 } from './tray-icon.js';

/**
 * 应用设置服务：把 AppSettingsStore 的持久化状态翻译成主进程副作用——
 * 网络代理（session 层）、防休眠（powerSaveBlocker）、托盘与关闭隐藏、
 * 任务桌面通知、提问自动继续、数据根目录迁移。
 *
 * 不做业务决策：每项行为只忠实执行设置值，读取永远走 store 单一来源。
 */

/** 提问自动继续的等待时长（毫秒）。 */
const AUTO_CONTINUE_MS = 5 * 60 * 1000;

export interface SettingsServiceOptions {
  store: AppSettingsStore;
  /** 设置变更 → 广播到全部窗口（组合根注入，服务自身不持有窗口表）。 */
  broadcast(channel: string, payload: unknown): void;
  /** harness 应答面（自动继续提问写回答案；Agent 权限模式切换）。 */
  harness: Pick<HarnessService, 'respondQuestion' | 'setAgentMode'>;
  /** 主窗口定位/聚焦（通知点击、托盘恢复）。 */
  windowManager: { getMain(): BrowserWindow | undefined; focusMain(): void };
}

/** 把代理写进主进程环境：harness 的 Node 侧请求在 boot 前读取（重启生效）。 */
export function applyProxyEnv(proxy: string): void {
  if (proxy.length > 0) {
    process.env.HTTP_PROXY = proxy;
    process.env.HTTPS_PROXY = proxy;
  } else {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
  }
}

export class SettingsService {
  private readonly store: AppSettingsStore;
  private readonly broadcastChannel: SettingsServiceOptions['broadcast'];
  private readonly harness: SettingsServiceOptions['harness'];
  private readonly windowManager: SettingsServiceOptions['windowManager'];
  private quitting = false;
  private tray: Tray | undefined;
  private keepAwakeId: number | undefined;
  /** 正在运行回合的会话（turn/start - turn/end 之间）。 */
  private readonly runningSessions = new Set<string>();
  /** 提问自动继续计时器（question id → timer）。 */
  private readonly questionTimers = new Map<string, NodeJS.Timeout>();

  constructor(options: SettingsServiceOptions) {
    this.store = options.store;
    this.broadcastChannel = options.broadcast;
    this.harness = options.harness;
    this.windowManager = options.windowManager;
  }

  /** 组合根在 app ready 后调用：应用初始副作用并订阅后续变更。 */
  start(): void {
    app.on('before-quit', () => {
      this.quitting = true;
    });
    this.store.subscribe((next) => this.applySettings(next));
    this.applySettings(this.store.get());
  }

  getSettings(): AppSettingsDto {
    return this.store.get();
  }

  update(patch: Partial<AppSettingsDto>): AppSettingsDto {
    return this.store.update(patch);
  }

  /**
   * 选择新数据根目录：复制现有 dsh-home → <新根>/dsh-home 并保存偏好。
   * 实际切换发生在下次启动（resolveHarnessPaths 读取该设置）。
   */
  async pickDataPath(sender: Electron.WebContents): Promise<PickDataPathResultDto> {
    const win = BrowserWindow.fromWebContents(sender);
    const options: Electron.OpenDialogOptions = {
      title: '选择数据存储路径',
      properties: ['openDirectory', 'createDirectory'],
    };
    const picked =
      win !== null ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const root = picked.filePaths[0];
    if (picked.canceled || root === undefined) return { changed: false };
    const current = resolveHarnessPaths().dshHome;
    const target = path.join(root, 'dsh-home');
    if (path.resolve(target) === path.resolve(current)) return { changed: false };
    try {
      await cp(current, target, { recursive: true, force: true });
    } catch (error) {
      return { changed: false, error: error instanceof Error ? error.message : String(error) };
    }
    this.update({ dataPath: root });
    return { changed: true, path: target };
  }

  /** 主窗口创建后挂接：开启“隐藏到托盘”时拦截关闭。 */
  attachWindow(win: BrowserWindow): void {
    win.on('close', (event) => {
      if (this.quitting) return;
      if (process.platform !== 'win32' || !this.store.get().closeToTray) return;
      event.preventDefault();
      win.hide();
    });
  }

  /* ──────────────────────────── 副作用应用 ──────────────────────────── */

  private applySettings(next: AppSettingsDto): void {
    this.broadcastChannel(channels.appSettings.changed, next);
    void this.applyProxy(next.httpProxy);
    this.applyKeepAwake(next.keepAwake);
    this.applyTray(next.closeToTray);
    // Agent 权限模式（默认询问 / 完全访问 / 计划模式）：即时应用到活跃 agent。
    this.harness.setAgentMode(next.agentMode);
    if (!next.autoContinueQuestions) this.clearAllQuestionTimers();
  }

  /** 页面请求代理（harness 的 Node 侧代理走环境变量，重启生效）。 */
  private async applyProxy(proxy: string): Promise<void> {
    try {
      await session.defaultSession.setProxy(
        proxy.length > 0 ? { mode: 'fixed_servers', proxyRules: proxy } : { mode: 'system' },
      );
    } catch (error) {
      console.error('[app-settings] 设置代理失败：', error);
    }
  }

  private applyKeepAwake(enabled: boolean): void {
    if (enabled && this.keepAwakeId === undefined) {
      // prevent-app-suspension：阻止系统空闲休眠（仍允许手动睡眠/合盖）。
      this.keepAwakeId = powerSaveBlocker.start('prevent-app-suspension');
    } else if (!enabled && this.keepAwakeId !== undefined) {
      powerSaveBlocker.stop(this.keepAwakeId);
      this.keepAwakeId = undefined;
    }
  }

  private applyTray(closeToTray: boolean): void {
    const wanted = closeToTray && process.platform === 'win32';
    if (!wanted) {
      this.tray?.destroy();
      this.tray = undefined;
      return;
    }
    if (this.tray !== undefined) return;
    const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_BASE64, 'base64'));
    this.tray = new Tray(icon);
    this.tray.setToolTip('DeepSeek Harness Code');
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示主窗口', click: () => this.windowManager.focusMain() },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() },
      ]),
    );
    this.tray.on('click', () => this.windowManager.focusMain());
  }

  /* ──────────────────── 通知与提问自动继续（事件驱动） ──────────────────── */

  /** 组合根把 harness 事件信封喂进来：通知与自动继续只消费，不再转发。 */
  handleHarnessEvent(envelope: HarnessEventEnvelope): void {
    const settings = this.store.get();
    if (envelope.kind === 'session-event') {
      const { sessionId } = envelope;
      // 主进程侧信封的 event 是 unknown（与 harness 解耦），这里收窄为事件形状。
      const event = envelope.event as { type: string; data?: unknown };
      if (event.type === 'turn/start') {
        this.runningSessions.add(sessionId);
        return;
      }
      if (event.type === 'turn/end') {
        const wasRunning = this.runningSessions.delete(sessionId);
        if (!wasRunning || !settings.notifications) return;
        // 与渲染层 sessionStore 相同的回合错误判定（reason.kind === 'error'）。
        const reason = typeof event.data === 'object' && event.data !== null
          ? (event.data as Record<string, unknown>).reason
          : undefined;
        const failed =
          typeof reason === 'object' && reason !== null && (reason as Record<string, unknown>).kind === 'error';
        this.notify(failed ? '任务失败' : '任务完成', failed ? '回合出错，请查看会话详情。' : '回合已结束。');
      }
      return;
    }
    if (envelope.kind === 'approval-requested') {
      if (settings.notifications) {
        this.notify('需要确认', `工具 ${envelope.toolName} 正在等待审批。`);
      }
      return;
    }
    if (envelope.kind === 'question-requested') {
      if (settings.notifications) {
        this.notify('等待输入', 'Agent 提问等待你的回答。');
      }
      if (settings.autoContinueQuestions) this.scheduleAutoContinue(envelope.id, envelope.questions);
      return;
    }
    if (envelope.kind === 'question-resolved') {
      this.clearQuestionTimer(envelope.id);
    }
  }

  /** 用户正盯着主窗口时不打扰（通知只服务离开场景）。 */
  private isUserWatching(): boolean {
    const win = this.windowManager.getMain();
    return win !== undefined && !win.isDestroyed() && win.isVisible() && win.isFocused();
  }

  private notify(title: string, body: string): void {
    if (this.isUserWatching()) return;
    const notice = new Notification({
      title,
      body,
      silent: !this.store.get().notificationSound,
    });
    notice.on('click', () => this.windowManager.focusMain());
    notice.show();
  }

  /** 5 分钟无人应答 → 自动继续：有选项选第一项，无选项回“继续”。 */
  private scheduleAutoContinue(
    id: string,
    questions: { id: string; options?: { label: string }[] }[],
  ): void {
    this.clearQuestionTimer(id);
    const timer = setTimeout(() => {
      this.questionTimers.delete(id);
      const answers = questions.map((question) =>
        question.options !== undefined && question.options.length > 0
          ? { id: question.id, selected: [question.options[0].label] }
          : { id: question.id, selected: [], custom: '继续' },
      );
      this.harness.respondQuestion(id, answers);
    }, AUTO_CONTINUE_MS);
    timer.unref();
    this.questionTimers.set(id, timer);
  }

  private clearQuestionTimer(id: string): void {
    const timer = this.questionTimers.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.questionTimers.delete(id);
  }

  private clearAllQuestionTimers(): void {
    for (const timer of this.questionTimers.values()) clearTimeout(timer);
    this.questionTimers.clear();
  }
}
