import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { McpServerDto, McpUpsertDto } from '../../shared/protocol.js';

/**
 * MCP 服务器配置存储（<appHome>/mcp-servers.json）。
 *
 * 每条记录在 boot 时由 composition 层渲染成一行 mcp-client 插件补丁
 * （stdio / streamable-http），工具以 mcp__<serverName>__<tool> 注入会话。
 * env / headers 按本地明文保存（与 VS Code mcp.json、Claude Desktop 同级
 * 的定位：本机配置文件，不进入渲染层持久化）。
 */

export const MCP_SERVERS_FILE_NAME = 'mcp-servers.json';

/** harness mcp-client 的 serverName 约束（[A-Za-z0-9_-]{1,32}）。 */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** 单台 MCP 服务器记录。 */
export interface McpServerRecord {
  id: string;
  /** harness 侧 serverName（工具命名空间 mcp__<name>__*），全局唯一。 */
  name: string;
  transport: 'stdio' | 'streamable-http';
  enabled: boolean;
  /* stdio */
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  /* streamable-http */
  url: string;
  headers: Record<string, string>;
}

export interface McpServersFile {
  version: 1;
  servers: McpServerRecord[];
}

export function emptyMcpServersFile(): McpServersFile {
  return { version: 1, servers: [] };
}

/** 键值表归一化：string→string、键值修剪、键去重（后者胜）、上限 32 项。 */
function normalizeStringMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  let count = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= 32) break;
    const k = key.trim();
    if (k.length === 0 || typeof value !== 'string') continue;
    out[k] = value;
    count += 1;
  }
  return out;
}

function normalizeArgs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 64);
}

/** 单条记录归一化：字段防御 + 合法性校验，非法记录整体丢弃。 */
export function normalizeMcpServer(raw: unknown): McpServerRecord | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!SERVER_NAME_PATTERN.test(name)) return undefined;
  const transport =
    record.transport === 'streamable-http' ? 'streamable-http' : record.transport === 'stdio' ? 'stdio' : undefined;
  if (transport === undefined) return undefined;
  if (transport === 'stdio') {
    const command = typeof record.command === 'string' ? record.command.trim() : '';
    if (command.length === 0) return undefined;
  } else {
    const url = typeof record.url === 'string' ? record.url.trim() : '';
    if (!/^https?:\/\/\S+$/i.test(url)) return undefined;
  }
  return {
    id: typeof record.id === 'string' && record.id.length > 0 ? record.id : `mcp-${randomUUID()}`,
    name,
    transport,
    enabled: record.enabled !== false,
    command: typeof record.command === 'string' ? record.command.trim() : '',
    args: normalizeArgs(record.args),
    env: normalizeStringMap(record.env),
    cwd: typeof record.cwd === 'string' ? record.cwd.trim() : '',
    url: typeof record.url === 'string' ? record.url.trim() : '',
    headers: normalizeStringMap(record.headers),
  };
}

/** 文件级归一化：非法项剔除、serverName 去重（先到先得）、上限 32 台。 */
export function normalizeMcpServersFile(raw: unknown): McpServersFile {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(record.servers) ? record.servers : [];
  const servers: McpServerRecord[] = [];
  const seenNames = new Set<string>();
  const seenIds = new Set<string>();
  for (const item of list.slice(0, 32)) {
    const server = normalizeMcpServer(item);
    if (server === undefined || seenNames.has(server.name) || seenIds.has(server.id)) continue;
    seenNames.add(server.name);
    seenIds.add(server.id);
    servers.push(server);
  }
  return { version: 1, servers };
}

type Listener = (snapshot: McpServerDto[]) => void;

export class McpStore {
  private readonly filePath: string;
  private file: McpServersFile;
  private readonly listeners = new Set<Listener>();

  constructor(filePath: string) {
    this.filePath = filePath;
    this.file = this.load();
  }

  private load(): McpServersFile {
    try {
      return normalizeMcpServersFile(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch {
      const empty = emptyMcpServersFile();
      this.persist(empty);
      return empty;
    }
  }

  private persist(next: McpServersFile): void {
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(next, null, 2), 'utf8');
    } catch (error) {
      console.error('[mcp] 写入失败：', error);
    }
  }

  private commit(next: McpServersFile): void {
    this.file = next;
    this.persist(next);
    for (const listener of this.listeners) listener(this.snapshot());
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): McpServerDto[] {
    return this.file.servers.map((server) => ({ ...server, args: [...server.args] }));
  }

  /** 供 composition 层读取的原始记录（boot 补丁渲染）。 */
  enabledRecords(): McpServerRecord[] {
    return this.file.servers.filter((server) => server.enabled);
  }

  /** 新增 / 编辑服务器。serverName 冲突（其他记录占用）时抛错。 */
  upsert(input: McpUpsertDto): McpServerDto {
    const name = input.name.trim();
    if (!SERVER_NAME_PATTERN.test(name)) {
      throw new Error('服务器名称仅允许 1-32 位字母 / 数字 / 下划线 / 连字符');
    }
    const transport = input.transport;
    const command = (input.command ?? '').trim();
    const url = (input.url ?? '').trim();
    if (transport === 'stdio' && command.length === 0) throw new Error('stdio 服务器必须填写启动命令');
    if (transport === 'streamable-http' && !/^https?:\/\/\S+$/i.test(url)) {
      throw new Error('HTTP 服务器地址必须是 http(s):// 开头的有效地址');
    }
    const servers = [...this.file.servers];
    const conflict = servers.find((server) => server.name === name && server.id !== input.id);
    if (conflict !== undefined) throw new Error(`服务器名称「${name}」已被占用`);
    const base: McpServerRecord = {
      id: input.id ?? `mcp-${randomUUID()}`,
      name,
      transport,
      enabled: input.enabled ?? true,
      command,
      args: normalizeArgs(input.args),
      env: normalizeStringMap(input.env),
      cwd: (input.cwd ?? '').trim(),
      url,
      headers: normalizeStringMap(input.headers),
    };
    if (input.id !== undefined) {
      const index = servers.findIndex((server) => server.id === input.id);
      if (index === -1) throw new Error('MCP 服务器不存在');
      servers[index] = base;
      this.commit({ ...this.file, servers });
      return { ...base, args: [...base.args] };
    }
    servers.push(base);
    this.commit({ ...this.file, servers });
    return { ...base, args: [...base.args] };
  }

  remove(id: string): void {
    const servers = this.file.servers.filter((server) => server.id !== id);
    if (servers.length === this.file.servers.length) throw new Error('MCP 服务器不存在');
    this.commit({ ...this.file, servers });
  }

  setEnabled(id: string, enabled: boolean): void {
    const servers = this.file.servers.map((server) => (server.id === id ? { ...server, enabled } : server));
    if (servers.every((server, index) => server === this.file.servers[index])) {
      throw new Error('MCP 服务器不存在');
    }
    this.commit({ ...this.file, servers });
  }
}
