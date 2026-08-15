import { describe, expect, it } from 'vitest';
import { buildBootPatches, mcpServerEntry, sandboxPatches } from './composition.js';
import type { McpServerRecord } from '../mcp/mcp-store.js';

/** 最小 MCP 记录构造（仅 composition 消费的字段）。 */
function server(partials: Partial<McpServerRecord>): McpServerRecord {
  return {
    id: 'mcp-1',
    name: 'memory',
    transport: 'stdio',
    enabled: true,
    command: '',
    args: [],
    env: {},
    cwd: '',
    url: '',
    headers: {},
    ...partials,
  };
}

describe('buildBootPatches', () => {
  it('无 MCP 且沙箱关闭时不产生补丁', () => {
    expect(buildBootPatches({ mcpServers: [], sandbox: false, workspaceRoot: 'D:/ws' })).toEqual([]);
  });

  it('每台启用的 MCP 服务器渲染为一行 mcp-client 插件（stdio）', () => {
    const patches = buildBootPatches({
      mcpServers: [
        server({
          name: 'memory',
          transport: 'stdio',
          command: 'mcp-server-memory',
          args: ['--foo'],
          env: { MEMORY_DIR: 'D:/m' },
          cwd: 'D:/ws',
        }),
      ],
      sandbox: false,
      workspaceRoot: 'D:/ws',
    });
    expect(patches).toEqual([
      {
        insert: [
          {
            id: 'mcp-memory',
            name: '../../deepseek-harness/packages/mcp/mcp-client/lib/index.js',
            config: {
              transport: 'stdio',
              serverName: 'memory',
              command: 'mcp-server-memory',
              args: ['--foo'],
              env: { MEMORY_DIR: 'D:/m' },
              cwd: 'D:/ws',
            },
          },
        ],
      },
    ]);
  });

  it('streamable-http 形态输出 url/headers，不含 stdio 字段', () => {
    const entry = mcpServerEntry(
      server({
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer x' },
      }),
    );
    expect(entry.id).toBe('mcp-memory');
    expect(entry.config).toEqual({
      transport: 'streamable-http',
      serverName: 'memory',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer x' },
    });
  });

  it('stdio 且 cwd 为空时不输出 cwd 键', () => {
    const entry = mcpServerEntry(server({ command: 'srv' }));
    expect(entry.config).not.toHaveProperty('cwd');
  });

  it('沙箱开启时：pwsh / fs-local 换执行器 + 追加 sandbox 与策略行', () => {
    const patches = sandboxPatches('D:/ws');
    expect(patches[0]).toEqual({ id: 'pwsh', name: expect.stringContaining('pwsh-sandbox') });
    expect(patches[1]).toEqual({ id: 'fs-local', name: expect.stringContaining('fs-sandbox') });
    const inserted = patches[2]?.insert ?? [];
    expect(inserted.map((entry) => entry.id)).toEqual(['sandbox', 'sandbox-policy']);
    expect(inserted[1]?.config).toEqual({ mode: 'workspace-write', workspaceRoot: 'D:/ws' });
  });
});
