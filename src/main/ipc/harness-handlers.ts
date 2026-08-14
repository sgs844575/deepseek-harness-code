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

  ipcMain.handle(channels.session.create, (_event, options?: { model?: string }) =>
    harness.createSession(options).then((sessionId) => ({ sessionId })),
  );

  ipcMain.handle(channels.session.open, (_event, sessionId: string) => harness.openSession(sessionId));

  ipcMain.handle(channels.session.list, () => harness.listSessions());

  ipcMain.handle(channels.session.history, (_event, sessionId: string) =>
    harness.sessionHistory(sessionId),
  );

  ipcMain.handle(
    channels.session.prompt,
    (_event, sessionId: string, text: string, options?: { mode?: 'queue' | 'steer' }) =>
      harness.prompt(sessionId, text, options),
  );

  ipcMain.handle(channels.session.cancel, (_event, sessionId: string) =>
    harness.cancel(sessionId),
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
