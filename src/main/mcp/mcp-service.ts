import type { HostStateDto } from '../../shared/protocol.js';
import type { HarnessService } from '../harness/harness-service.js';
import type { McpStore } from './mcp-store.js';

/**
 * MCP 服务：McpStore 之上的薄封装——应用（apply）= harness 以最新
 * boot 补丁重启（MCP 服务器是插件行，无法热生效；组合重启与会话切换
 * 同一条 stop/start 路径，会话日志按事件即时落盘，重启后可恢复）。
 */
export class McpService {
  private readonly store: McpStore;
  private harness: HarnessService | undefined;

  constructor(store: McpStore) {
    this.store = store;
  }

  attach(harness: HarnessService): void {
    this.harness = harness;
  }

  list() {
    return this.store.snapshot();
  }

  upsert(input: Parameters<McpStore['upsert']>[0]) {
    return this.store.upsert(input);
  }

  remove(id: string): void {
    this.store.remove(id);
  }

  setEnabled(id: string, enabled: boolean): void {
    this.store.setEnabled(id, enabled);
  }

  /** 应用变更：harness 停机重启（渲染层负责提示与状态复位）。 */
  async apply(): Promise<HostStateDto> {
    if (this.harness === undefined) throw new Error('harness 尚未就绪');
    return this.harness.restart();
  }
}
