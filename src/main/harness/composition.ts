import path from 'node:path';
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

/** 组合输入：MCP 服务器记录 + 沙箱开关 + 工作区根 + 自定义插件。 */
export interface BootCompositionInput {
  mcpServers: McpServerRecord[];
  sandbox: boolean;
  workspaceRoot: string;
  /** 自定义 harness 插件（启用项注入组合；相对组合目录定位）。 */
  userPlugins: { id: string; entryPath: string }[];
  /** 组合文件所在目录（自定义插件入口换算相对路径的基准）。 */
  configDir: string;
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

/** 自定义插件 → 组合行：入口换算成相对组合目录的加载路径（与 cordis.yml
 * 同风格）。跨盘（Windows 不同卷）时 path.relative 返回绝对路径，加载器
 * 无法消费——直接抛错，调用方在保存期就拦下。 */
export function userPluginEntry(
  plugin: { id: string; entryPath: string },
  configDir: string,
): LoaderEntry {
  const relative = path.relative(configDir, plugin.entryPath).split(path.sep).join('/');
  if (path.isAbsolute(relative)) {
    throw new Error(
      `插件入口与组合目录不在同一磁盘分区，无法挂载：${plugin.entryPath}`,
    );
  }
  return { id: `user-${plugin.id}`, name: relative };
}

/** 构建完整 boot 补丁列表（顺序：沙箱换行 → 自定义插件追加 → MCP 追加行）。 */
export function buildBootPatches(input: BootCompositionInput): LoaderPatch[] {
  const patches: LoaderPatch[] = [];
  if (input.sandbox) patches.push(...sandboxPatches(input.workspaceRoot));
  const pluginEntries = input.userPlugins.map((plugin) =>
    userPluginEntry(plugin, input.configDir),
  );
  if (pluginEntries.length > 0) patches.push({ insert: pluginEntries });
  const entries = input.mcpServers.map(mcpServerEntry);
  if (entries.length > 0) patches.push({ insert: entries });
  return patches;
}
