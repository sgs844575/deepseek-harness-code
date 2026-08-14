import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  maskApiKey,
  normalizeProvidersFile,
  ProviderStore,
  seedProvidersFile,
} from './provider-store.js';

let tempDirs: string[] = [];

function makeStore(): ProviderStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'dshc-providers-'));
  tempDirs.push(dir);
  return new ProviderStore(path.join(dir, 'providers.json'));
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe('maskApiKey', () => {
  it('保留前 3 后 4，短 key 全掩码', () => {
    expect(maskApiKey('sk-1234567890abcdef')).toBe('sk-***cdef');
    expect(maskApiKey('short')).toBe('****');
    expect(maskApiKey('  sk-1234567890  ')).toBe('sk-***7890');
  });
});

describe('normalizeProvidersFile', () => {
  it('空对象回落预设种子', () => {
    const file = normalizeProvidersFile({});
    expect(file.providers.length).toBeGreaterThan(1);
    expect(file.activeProviderId).toBe('deepseek');
    expect(file.providers[0]?.models.length).toBe(2);
  });

  it('非法供应商剔除，激活项不存在时回落第一个', () => {
    const file = normalizeProvidersFile({
      providers: [
        { id: 'ok', name: 'A', baseURL: 'https://a.example.com/v1', apiKeys: [] },
        { id: 'bad', name: '', baseURL: 'https://b.example.com' },
        'garbage',
      ],
      activeProviderId: 'missing',
    });
    expect(file.providers.map((provider) => provider.id)).toEqual(['ok']);
    expect(file.activeProviderId).toBe('ok');
  });

  it('apiKeys 去重与掩码不落盘（快照不含明文）', () => {
    const store = makeStore();
    store.addApiKeys('deepseek', ['sk-aaaaaaaa1111', 'sk-aaaaaaaa1111', 'sk-bbbbbbbb2222']);
    const snapshot = store.snapshot();
    const deepseek = snapshot.providers.find((provider) => provider.id === 'deepseek');
    expect(deepseek?.apiKeys.length).toBe(2);
    expect(deepseek?.apiKeys.every((key) => !JSON.stringify(key).includes('sk-aaaaaaaa'))).toBe(true);
    expect(deepseek?.keyConfigured).toBe(true);
  });
});

describe('ProviderStore 多 key 轮询', () => {
  it('单 key 恒定返回；多 key 顺序轮转', () => {
    const store = makeStore();
    store.addApiKeys('deepseek', ['sk-single000001']);
    expect(store.rotateApiKey('deepseek')).toBe('sk-single000001');
    expect(store.rotateApiKey('deepseek')).toBe('sk-single000001');

    const multi = makeStore();
    multi.addApiKeys('deepseek', ['sk-multi0000001', 'sk-multi0000002', 'sk-multi0000003']);
    const seen = [
      multi.rotateApiKey('deepseek'),
      multi.rotateApiKey('deepseek'),
      multi.rotateApiKey('deepseek'),
      multi.rotateApiKey('deepseek'),
    ];
    expect(seen.slice(0, 3).sort()).toEqual(['sk-multi0000001', 'sk-multi0000002', 'sk-multi0000003']);
    expect(seen[3]).toBe(seen[0]);
  });

  it('禁用的 key 不参与轮询；全部禁用返回 undefined', () => {
    const store = makeStore();
    store.addApiKeys('deepseek', ['sk-multi0000001', 'sk-multi0000002']);
    const first = store.snapshot().providers[0];
    const secondKeyId = first.apiKeys.find((key) => key.masked.endsWith('0002'))?.id;
    if (secondKeyId === undefined) throw new Error('测试前提失败');
    store.updateApiKey('deepseek', secondKeyId, { isEnabled: false });
    expect(store.rotateApiKey('deepseek')).toBe('sk-multi0000001');

    for (const key of store.snapshot().providers[0].apiKeys) {
      store.updateApiKey('deepseek', key.id, { isEnabled: false });
    }
    expect(store.rotateApiKey('deepseek')).toBeUndefined();
  });
});

describe('ProviderStore 激活与迁移', () => {
  it('无 key 的非本地供应商拒绝激活；Ollama 放行', () => {
    const store = makeStore();
    expect(() => store.activate('openai')).toThrow(/API Key/);
    expect(() => store.activate('ollama')).not.toThrow();
  });

  it('激活中的供应商不可删除', () => {
    const store = makeStore();
    expect(() => store.remove('deepseek')).toThrow(/使用中/);
  });

  it('旧版单 key 仅在 DeepSeek 无 key 时迁移一次', () => {
    const store = makeStore();
    expect(store.migrateLegacyKey('sk-legacy000001')).toBe(true);
    expect(store.migrateLegacyKey('sk-legacy000002')).toBe(false);
    const deepseek = store.snapshot().providers.find((provider) => provider.id === 'deepseek');
    expect(deepseek?.apiKeys.length).toBe(1);
    expect(deepseek?.apiKeys[0]?.masked).toBe('sk-***0001');
  });

  it('持久化往返：重启后配置仍在', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dshc-providers-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'providers.json');
    writeFileSync(file, JSON.stringify(seedProvidersFile()), 'utf8');
    const first = new ProviderStore(file);
    first.addApiKeys('deepseek', ['sk-persist00001']);
    const second = new ProviderStore(file);
    const deepseek = second.snapshot().providers.find((provider) => provider.id === 'deepseek');
    expect(deepseek?.apiKeys.length).toBe(1);
    expect(second.rotateApiKey('deepseek')).toBe('sk-persist00001');
  });
});

describe('ProviderStore upsert', () => {
  it('新增自定义供应商并编辑', () => {
    const store = makeStore();
    const created = store.upsert({ name: '网关', baseURL: 'https://gw.example.com/v1/' });
    expect(created.baseURL).toBe('https://gw.example.com/v1');
    const updated = store.upsert({ id: created.id, name: '网关 2', baseURL: 'https://gw2.example.com' });
    expect(updated.name).toBe('网关 2');
    store.remove(created.id);
    expect(store.snapshot().providers.some((provider) => provider.id === created.id)).toBe(false);
  });

  it('配置密钥后可激活自定义供应商', () => {
    const store = makeStore();
    const created = store.upsert({ name: '网关', baseURL: 'https://gw.example.com/v1' });
    store.addApiKeys(created.id, ['sk-custom0000001']);
    store.activate(created.id);
    expect(store.snapshot().activeProviderId).toBe(created.id);
  });

  it('非法 baseURL 拒绝', () => {
    const store = makeStore();
    expect(() => store.upsert({ name: 'x', baseURL: 'ftp://bad' })).toThrow();
  });
});
