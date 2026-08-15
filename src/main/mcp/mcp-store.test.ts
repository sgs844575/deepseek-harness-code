import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { McpStore, normalizeMcpServersFile } from './mcp-store.js';

const tempDirs: string[] = [];

function tempFile(content?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'dshc-mcp-test-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'mcp-servers.json');
  if (content !== undefined) writeFileSync(file, content, 'utf8');
  return file;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('normalizeMcpServersFile', () => {
  it('非法输入回落空列表', () => {
    expect(normalizeMcpServersFile(undefined)).toEqual({ version: 1, servers: [] });
    expect(normalizeMcpServersFile('nope' as unknown)).toEqual({ version: 1, servers: [] });
  });

  it('剔除非法记录：serverName 不合规 / 缺 command / url 非 http', () => {
    const normalized = normalizeMcpServersFile({
      servers: [
        { name: '带空格的名字', transport: 'stdio', command: 'x' },
        { name: 'ok', transport: 'stdio' },
        { name: 'bad-url', transport: 'streamable-http', url: 'ftp://x' },
        { name: 'http-ok', transport: 'streamable-http', url: 'https://x/mcp' },
      ],
    });
    expect(normalized.servers.map((server) => server.name)).toEqual(['http-ok']);
  });

  it('serverName 重复时后者丢弃', () => {
    const normalized = normalizeMcpServersFile({
      servers: [
        { name: 'a', transport: 'stdio', command: 'x' },
        { name: 'a', transport: 'stdio', command: 'y' },
      ],
    });
    expect(normalized.servers).toHaveLength(1);
    expect(normalized.servers[0]?.command).toBe('x');
  });

  it('env/headers 归一化：非字符串值剔除、键值修剪', () => {
    const normalized = normalizeMcpServersFile({
      servers: [
        {
          name: 'a',
          transport: 'stdio',
          command: 'x',
          env: { K: 'v', BAD: 1, '  ': 'x' },
          args: ['--a', ' ', 3, '--b'],
        },
      ],
    });
    expect(normalized.servers[0]?.env).toEqual({ K: 'v' });
    expect(normalized.servers[0]?.args).toEqual(['--a', '--b']);
  });
});

describe('McpStore', () => {
  it('缺文件时种子空列表并落盘', () => {
    const store = new McpStore(tempFile());
    expect(store.snapshot()).toEqual([]);
    expect(store.enabledRecords()).toEqual([]);
  });

  it('upsert 新增 / 编辑 / 名称冲突', () => {
    const store = new McpStore(tempFile());
    const created = store.upsert({
      name: 'memory',
      transport: 'stdio',
      command: 'mcp-server-memory',
    });
    expect(created.name).toBe('memory');
    expect(store.snapshot()).toHaveLength(1);

    const edited = store.upsert({ id: created.id, name: 'memory', transport: 'stdio', command: 'other' });
    expect(edited.command).toBe('other');
    expect(store.snapshot()).toHaveLength(1);

    expect(() =>
      store.upsert({ name: 'memory', transport: 'stdio', command: 'x' }),
    ).toThrow('已被占用');
  });

  it('upsert 校验：stdio 需命令、http 需地址、名称约束', () => {
    const store = new McpStore(tempFile());
    expect(() => store.upsert({ name: 'x', transport: 'stdio' })).toThrow('启动命令');
    expect(() =>
      store.upsert({ name: 'x', transport: 'streamable-http', url: 'notaurl' }),
    ).toThrow('http(s)');
    expect(() => store.upsert({ name: '名', transport: 'stdio', command: 'x' })).toThrow('服务器名称');
  });

  it('setEnabled / remove / enabledRecords 只含启用项', () => {
    const store = new McpStore(tempFile());
    const a = store.upsert({ name: 'a', transport: 'stdio', command: 'x' });
    const b = store.upsert({ name: 'b', transport: 'stdio', command: 'y' });
    store.setEnabled(a.id, false);
    expect(store.enabledRecords().map((server) => server.name)).toEqual(['b']);
    store.remove(b.id);
    expect(store.snapshot()).toHaveLength(1);
    expect(() => store.remove('nope')).toThrow('不存在');
  });
});
