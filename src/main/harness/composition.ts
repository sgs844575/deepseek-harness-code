import type { McpServerRecord } from '../mcp/mcp-store.js';

/**
 * boot() 补丁层（cordis-plugin-include 的 PatchOptions）的构建器：
 * 在不动 config/harness/cordis.yml 的前提下，把「应用设置驱动的动态组合」
 * 以 id 定向覆盖 / insert 追加行注入插件树——MCP 服务器与沙箱栈。
 *
 * 插件 name 与 cordis.yml 同风格：相对本组合文件所在目录（dev = 仓库
 * config/harness，打包态 = resources/config/harness，../../deepseek-harness
 * 布局一致）。
 */

/** cordis-plugin-include PatchOptions 的本地结构化视图（鸭子匹配）。 */
export interface LoaderPatch {
  id?: string;
  name?: string;
  config?: unknown;
  insert?: LoaderEntry[];
}

export interface LoaderEntry {
  id: string;
  name: string;
  config?: unknown;
}

/** 组合输入：MCP 服务器记录 + 沙箱开关 + 工作区根。 */
export interface BootCompositionInput {
  mcpServers: McpServerRecord[];
  sandbox: boolean;
  workspaceRoot: string;
}

/** cordis.yml 同款的 harness 插件相对路径（基于配置目录）。 */
export function harnessPlugin(packagePath: string): string {
  return `../../deepseek-harness/packages/${packagePath}`;
}

/** 单台 MCP 服务器 → mcp-client 插件行（每 server 一实例）。 */
export function mcpServerEntry(server: McpServerRecord): LoaderEntry {
  const config =
    server.transport === 'stdio'
      ? {
          transport: 'stdio',
          serverName: server.name,
          command: server.command,
          args: server.args,
          env: server.env,
          ...(server.cwd.length > 0 ? { cwd: server.cwd } : {}),
        }
      : {
          transport: 'streamable-http',
          serverName: server.name,
          url: server.url,
          headers: server.headers,
        };
  return {
    id: `mcp-${server.name}`,
    name: harnessPlugin('mcp/mcp-client/lib/index.js'),
    config,
  };
}

/** 沙箱栈补丁：pwsh-local → pwsh-sandbox、fs-local → fs-sandbox（同名直替，
 * 保留原行 config），并追加 sandbox 后端与策略服务。默认档 workspace-write
 * （工作区与临时目录可写，越界写走 pwsh 工具的 sandbox_permissions 升级审批）。 */
export function sandboxPatches(workspaceRoot: string): LoaderPatch[] {
  return [
    { id: 'pwsh', name: harnessPlugin('shell/pwsh-sandbox/lib/index.js') },
    { id: 'fs-local', name: harnessPlugin('fs/fs-sandbox/lib/index.js') },
    {
      insert: [
        { id: 'sandbox', name: harnessPlugin('sandbox/sandbox-local/lib/index.js') },
        {
          id: 'sandbox-policy',
          name: harnessPlugin('sandbox/sandbox-policy/lib/index.js'),
          config: { mode: 'workspace-write', workspaceRoot },
        },
      ],
    },
  ];
}

/** 构建完整 boot 补丁列表（顺序：沙箱换行 → MCP 追加行）。 */
export function buildBootPatches(input: BootCompositionInput): LoaderPatch[] {
  const patches: LoaderPatch[] = [];
  if (input.sandbox) patches.push(...sandboxPatches(input.workspaceRoot));
  const entries = input.mcpServers.map(mcpServerEntry);
  if (entries.length > 0) patches.push({ insert: entries });
  return patches;
}
