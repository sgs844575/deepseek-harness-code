import { ipcMain } from 'electron';
import { channels } from '../../shared/channels.js';
import type { HarnessService } from '../harness/harness-service.js';

/**
 * harness 相关 IPC 处理器：宿主状态、模型目录、会话代理。
 * 审批/提问等通道随里程碑在各自 handler 文件中扩展。
 */
export function registerHarnessHandlers(harness: HarnessService): void {
  ipcMain.handle(channels.host.getStatus, () => harness.getState());

  // 切换工作区（项目）：harness 停机 → 改 DSH_CWD → 重新 boot。
  ipcMain.handle(channels.host.switchWorkspace, (_event, cwd: string) =>
    harness.switchWorkspace(cwd),
  );

  ipcMain.handle(channels.models.list, (_event, provider: string) => harness.listModels(provider));

  ipcMain.handle(
    channels.session.create,
    (_event, options?: { model?: string; preset?: string }) => harness.createSession(options),
  );

  ipcMain.handle(channels.session.open, (_event, sessionId: string) => harness.openSession(sessionId));

  ipcMain.handle(channels.session.list, () => harness.listSessions());

  // 批量会话标题（侧栏冷启动展示；读取最近会话的 session/title 事件）。
  ipcMain.handle(channels.session.titles, () => harness.listSessionTitles());

  ipcMain.handle(channels.session.history, (_event, sessionId: string) =>
    harness.sessionHistory(sessionId),
  );

  ipcMain.handle(
    channels.session.prompt,
    (
      _event,
      sessionId: string,
      text: string,
      options?: { mode?: 'queue' | 'steer'; attachments?: { path: string; name?: string }[] },
    ) => harness.prompt(sessionId, text, options),
  );

  ipcMain.handle(channels.session.cancel, (_event, sessionId: string) =>
    harness.cancel(sessionId),
  );

  ipcMain.handle(channels.session.fork, (_event, sessionId: string) =>
    harness.forkSession(sessionId).then((forkedId) => ({ sessionId: forkedId })),
  );

  ipcMain.handle(channels.session.subagents, (_event, sessionId: string) =>
    harness.listSubagents(sessionId),
  );

  // Agent 预设：名单 / 默认值 / 空白会话切换（recompose + 事件记录）。
  ipcMain.handle(channels.presets.list, () => harness.listPresets());

  ipcMain.handle(channels.presets.getDefault, () => harness.getDefaultPreset());

  ipcMain.handle(channels.presets.setDefault, (_event, id: string) =>
    harness.setDefaultPreset(id),
  );

  ipcMain.handle(channels.presets.select, (_event, sessionId: string, presetId: string) =>
    harness.switchSessionPreset(sessionId, presetId),
  );

  ipcMain.handle(
    channels.interaction.respondApproval,
    (_event, id: string, outcome: 'allowed-once' | 'rejected') =>
      harness.respondApproval(id, outcome),
  );

  ipcMain.handle(
    channels.interaction.respondQuestion,
    (_event, id: string, answers: { id: string; selected: string[]; custom?: string }[]) =>
      harness.respondQuestion(id, answers),
  );

  ipcMain.handle(channels.settings.getDefaultModel, () => harness.getDefaultModel());

  ipcMain.handle(channels.settings.setDefaultModel, (_event, model: string) =>
    harness.setDefaultModel(model),
  );
}
