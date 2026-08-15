import { ipcMain } from 'electron';
import { channels } from '../../shared/channels.js';
import type { McpUpsertDto } from '../../shared/protocol.js';
import type { McpService } from '../mcp/mcp-service.js';

/**
 * MCP 服务器管理 IPC：列表 / 增删改 / 启停 + apply（harness 以新组合重启）。
 */
export function registerMcpHandlers(mcp: McpService): void {
  ipcMain.handle(channels.mcp.getAll, () => mcp.list());
  ipcMain.handle(channels.mcp.upsert, (_event, input: McpUpsertDto) => mcp.upsert(input));
  ipcMain.handle(channels.mcp.remove, (_event, id: string) => mcp.remove(id));
  ipcMain.handle(channels.mcp.setEnabled, (_event, id: string, enabled: boolean) =>
    mcp.setEnabled(id, enabled),
  );
  ipcMain.handle(channels.mcp.apply, () => mcp.apply());
}
