import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { channels } from '../../shared/channels.js';
import type { AgentRulesDto } from '../../shared/protocol.js';
import type { HarnessService } from '../harness/harness-service.js';
import { resolveHarnessPaths } from '../harness/paths.js';

/** Agent 规则文件的写入上限（防御性；harness 渲染预算 64 KiB，超限部分自身会截断）。 */
const RULES_MAX_BYTES = 1024 * 1024;

/**
 * 应用级 IPC 处理器：版本查询、退出、文本导出、文件夹选择、
 * Agent 规则文件（AGENTS.md）读写等。每个函数只注册自己领域的通道。
 */
export function registerAppHandlers(harness: HarnessService): void {
  ipcMain.handle(channels.app.getVersion, () => app.getVersion());

  ipcMain.handle(channels.app.quit, () => {
    app.quit();
  });

  // 重启应用：设置中“重启后生效”类项（硬件加速 / 代理环境 / 数据路径）使用。
  ipcMain.handle(channels.app.relaunch, () => {
    app.relaunch();
    app.quit();
  });

  ipcMain.handle(
    channels.app.exportText,
    async (event, filename: unknown, content: unknown) => {
      if (typeof filename !== 'string' || typeof content !== 'string') {
        throw new Error('exportText 参数必须是字符串');
      }
      const win = BrowserWindow.fromWebContents(event.sender);
      // 文件名只留安全字符，避免默认名里混入路径分隔符等。
      const safeName = filename.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || 'export.md';
      const options = {
        defaultPath: safeName,
        filters: [{ name: 'Markdown', extensions: ['md'] }] as Electron.FileFilter[],
      };
      const { canceled, filePath } =
        win !== null ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (canceled || filePath === undefined) return { saved: false };
      await writeFile(filePath, content, 'utf-8');
      return { saved: true, path: filePath };
    },
  );

  // 选择文件夹（创建项目的源目录）。
  ipcMain.handle(channels.app.pickFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: '选择项目文件夹',
      properties: ['openDirectory'] as Electron.OpenDialogOptions['properties'],
    };
    const { canceled, filePaths } =
      win !== null ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const folder = filePaths[0];
    if (canceled || folder === undefined) return { canceled: true };
    return { canceled: false, path: folder };
  });

  // 用系统默认浏览器打开外部链接（仅接受 https，防 file:/javascript: 注入）。
  ipcMain.handle(channels.app.openExternal, async (_event, url: unknown) => {
    if (typeof url !== 'string') throw new Error('openExternal 参数必须是字符串');
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('无效的链接');
    }
    if (parsed.protocol !== 'https:') throw new Error('仅支持 https 链接');
    await shell.openExternal(parsed.href);
  });

  /* Agent 规则文件（AGENTS.md）：global = 数据目录（harness 用户全局层），
   * project = 当前工作区（harness 从项目根到 cwd 逐层合并的项目层）。
   * harness 在会话启动时自动发现读取，写入即对后续会话生效。 */
  const parseRulesScope = (scope: unknown): { scope: 'global' | 'project'; path: string } => {
    if (scope !== 'global' && scope !== 'project') throw new Error('规则作用域必须是 global 或 project');
    return {
      scope,
      path:
        scope === 'global'
          ? join(resolveHarnessPaths().dshHome, 'AGENTS.md')
          : join(harness.getState().workspace, 'AGENTS.md'),
    };
  };

  ipcMain.handle(channels.app.readRules, async (_event, scope: unknown): Promise<AgentRulesDto> => {
    const { scope: normalized, path } = parseRulesScope(scope);
    try {
      const info = await stat(path);
      if (!info.isFile()) throw new Error('不是常规文件');
      const content = await readFile(path, 'utf-8');
      return { scope: normalized, path, exists: true, content };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { scope: normalized, path, exists: false, content: '' };
      }
      throw error;
    }
  });

  ipcMain.handle(
    channels.app.writeRules,
    async (_event, scope: unknown, content: unknown): Promise<AgentRulesDto> => {
      if (typeof content !== 'string') throw new Error('规则内容必须是字符串');
      if (Buffer.byteLength(content, 'utf-8') > RULES_MAX_BYTES) {
        throw new Error('规则文件超过 1 MiB 上限');
      }
      const { scope: normalized, path } = parseRulesScope(scope);
      await writeFile(path, content, 'utf-8');
      return { scope: normalized, path, exists: true, content };
    },
  );
}
