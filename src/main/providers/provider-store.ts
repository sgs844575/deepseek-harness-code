import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  ApiKeyEntryDto,
  ProviderDto,
  ProviderModelDto,
  ProviderPrefsDto,
  ProviderSnapshotDto,
  ProviderUpsertDto,
} from '../../shared/protocol.js';
import { PROVIDER_PRESETS } from './presets.js';

/**
 * 多供应商模型配置存储（<appHome>/providers.json）。
 *
 * 参考 Cherry Studio 的建模：一个供应商 = 一个 API 地址 + 一组 API Key
 * （`ApiKeyEntry[] {id, key, label, isEnabled}`，多 key 请求时轮询）。
 * 明文 key 只留在主进程本文件与凭据文档中，渲染层只见脱敏视图。
 *
 * 读写为同步小文件操作；归一化保证磁盘脏数据不会击穿运行时。
 */

export const PROVIDERS_FILE_NAME = 'providers.json';

/** 明文 key 记录（仅主进程内存与 providers.json）。 */
export interface ApiKeyRecord {
  id: string;
  key: string;
  label: string;
  isEnabled: boolean;
}

/** 供应商持久化记录。 */
export interface ProviderRecord {
  id: string;
  presetId?: string;
  name: string;
  baseURL: string;
  enabled: boolean;
  authOptional: boolean;
  website?: string;
  models: ProviderModelDto[];
  apiKeys: ApiKeyRecord[];
}

export interface ProvidersFile {
  version: 1;
  activeProviderId: string;
  prefs: ProviderPrefsDto;
  providers: ProviderRecord[];
}

export const DEFAULT_PREFS: ProviderPrefsDto = {
  thinking: 'enabled',
  reasoningEffort: 'high',
};

/** 正整数（>0）；非法值归 undefined（= harness 默认）。 */
function positiveIntOrUndefined(value: unknown): number | undefined {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(num) && num > 0 ? num : undefined;
}

/** 掩码展示：保留前 3 后 4，其余以 * 代替；短 key 全掩码。 */
export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length < 12) return '****';
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-4)}`;
}

function normalizeBaseURL(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/\/+$/, '');
  return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : '';
}

function normalizeModels(raw: unknown): ProviderModelDto[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const models: ProviderModelDto[] = [];
  for (const item of raw.slice(0, 500)) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== 'string' || record.id.trim().length === 0) continue;
    const id = record.id.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    const name = typeof record.name === 'string' && record.name.trim().length > 0
      ? record.name.trim().slice(0, 120)
      : undefined;
    const contextWindow = positiveIntOrUndefined(record.contextWindow);
    models.push(
      name === undefined && contextWindow === undefined
        ? { id }
        : {
            id,
            ...(name === undefined ? {} : { name }),
            ...(contextWindow === undefined ? {} : { contextWindow }),
          },
    );
  }
  return models;
}

function normalizeApiKeys(raw: unknown): ApiKeyRecord[] {
  if (!Array.isArray(raw)) return [];
  const seenKeys = new Set<string>();
  const keys: ApiKeyRecord[] = [];
  for (const item of raw.slice(0, 100)) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.key !== 'string' || record.key.trim().length === 0) continue;
    const key = record.key.trim();
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    keys.push({
      id: typeof record.id === 'string' && record.id.length > 0 ? record.id : randomUUID(),
      key,
      label: typeof record.label === 'string' ? record.label.trim().slice(0, 60) : '',
      isEnabled: record.isEnabled !== false,
    });
  }
  return keys;
}

function normalizeProvider(raw: unknown): ProviderRecord | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const baseURL = normalizeBaseURL(record.baseURL);
  const name = typeof record.name === 'string' && record.name.trim().length > 0
    ? record.name.trim().slice(0, 60)
    : '';
  if (baseURL.length === 0 || name.length === 0) return undefined;
  return {
    id: typeof record.id === 'string' && record.id.length > 0 ? record.id : `provider-${randomUUID()}`,
    presetId: typeof record.presetId === 'string' && record.presetId.length > 0 ? record.presetId : undefined,
    name,
    baseURL,
    enabled: record.enabled !== false,
    authOptional: record.authOptional === true,
    website: typeof record.website === 'string' && record.website.length > 0 ? record.website : undefined,
    models: normalizeModels(record.models),
    apiKeys: normalizeApiKeys(record.apiKeys),
  };
}

/** 首次运行（无文件）时按预设全量种子；DeepSeek 为激活项。 */
export function seedProvidersFile(): ProvidersFile {
  const providers: ProviderRecord[] = PROVIDER_PRESETS.map((preset) => ({
    id: preset.id,
    presetId: preset.id,
    name: preset.name,
    baseURL: preset.baseURL,
    enabled: true,
    authOptional: preset.authOptional === true,
    website: preset.website,
    models: preset.models !== undefined ? normalizeModels(preset.models) : [],
    apiKeys: [],
  }));
  return {
    version: 1,
    activeProviderId: 'deepseek',
    prefs: { ...DEFAULT_PREFS },
    providers,
  };
}

/** 防御性归一化：非法供应商剔除、id 去重、激活项兜底、偏好回落默认。 */
export function normalizeProvidersFile(raw: unknown): ProvidersFile {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(record.providers) ? record.providers : [];
  const providers: ProviderRecord[] = [];
  const seenIds = new Set<string>();
  for (const item of list.slice(0, 50)) {
    const provider = normalizeProvider(item);
    if (provider === undefined || seenIds.has(provider.id)) continue;
    seenIds.add(provider.id);
    providers.push(provider);
  }
  if (providers.length === 0) return seedProvidersFile();
  const activeProviderId =
    typeof record.activeProviderId === 'string' && seenIds.has(record.activeProviderId)
      ? record.activeProviderId
      : providers[0].id;
  const prefsRecord =
    record.prefs !== undefined && typeof record.prefs === 'object'
      ? (record.prefs as Record<string, unknown>)
      : {};
  return {
    version: 1,
    activeProviderId,
    prefs: {
      thinking: prefsRecord.thinking === 'disabled' ? 'disabled' : 'enabled',
      reasoningEffort:
        prefsRecord.reasoningEffort === 'off' || prefsRecord.reasoningEffort === 'max' || prefsRecord.reasoningEffort === 'high'
          ? prefsRecord.reasoningEffort
          : DEFAULT_PREFS.reasoningEffort,
      ...(positiveIntOrUndefined(prefsRecord.maxTokens) !== undefined
        ? { maxTokens: positiveIntOrUndefined(prefsRecord.maxTokens) }
        : {}),
      ...(positiveIntOrUndefined(prefsRecord.contextWindow) !== undefined
        ? { contextWindow: positiveIntOrUndefined(prefsRecord.contextWindow) }
        : {}),
    },
    providers,
  };
}

type Listener = (snapshot: ProviderSnapshotDto) => void;

/** 轮询游标（providerId → 上次使用的 key id），仅内存，随进程重启归零。 */
const rotationCursor = new Map<string, string>();

export class ProviderStore {
  private readonly filePath: string;
  private file: ProvidersFile;
  private readonly listeners = new Set<Listener>();

  constructor(filePath: string) {
    this.filePath = filePath;
    this.file = this.load();
  }

  private load(): ProvidersFile {
    try {
      return normalizeProvidersFile(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch {
      const seeded = seedProvidersFile();
      this.persist(seeded);
      return seeded;
    }
  }

  private persist(next: ProvidersFile): void {
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(next, null, 2), 'utf8');
    } catch (error) {
      console.error('[providers] 写入失败：', error);
    }
  }

  private commit(next: ProvidersFile): void {
    this.file = next;
    this.persist(next);
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /* ──────────────────────────── 只读视图 ──────────────────────────── */

  snapshot(): ProviderSnapshotDto {
    return {
      providers: this.file.providers.map((provider) => this.toDto(provider)),
      activeProviderId: this.file.activeProviderId,
      prefs: { ...this.file.prefs },
    };
  }

  private toDto(provider: ProviderRecord): ProviderDto {
    return {
      id: provider.id,
      presetId: provider.presetId,
      name: provider.name,
      baseURL: provider.baseURL,
      enabled: provider.enabled,
      authOptional: provider.authOptional,
      website: provider.website,
      models: provider.models.map((model) => ({ ...model })),
      apiKeys: provider.apiKeys.map<ApiKeyEntryDto>((key) => ({
        id: key.id,
        label: key.label,
        masked: maskApiKey(key.key),
        isEnabled: key.isEnabled,
      })),
      keyConfigured: provider.apiKeys.some((key) => key.isEnabled),
    };
  }

  getRecord(id: string): ProviderRecord | undefined {
    return this.file.providers.find((provider) => provider.id === id);
  }

  get activeRecord(): ProviderRecord {
    const active = this.getRecord(this.file.activeProviderId);
    if (active === undefined) throw new Error('没有可用的供应商配置');
    return active;
  }

  get prefs(): ProviderPrefsDto {
    return { ...this.file.prefs };
  }

  /** 下一个可用密钥：启用的 key 轮询（round-robin）；无启用 key 返回 undefined。 */
  rotateApiKey(providerId: string): string | undefined {
    const provider = this.getRecord(providerId);
    if (provider === undefined) return undefined;
    const enabled = provider.apiKeys.filter((key) => key.isEnabled);
    if (enabled.length === 0) return undefined;
    if (enabled.length === 1) return enabled[0].key;
    const lastId = rotationCursor.get(providerId);
    const lastIndex = enabled.findIndex((key) => key.id === lastId);
    const next = enabled[(lastIndex + 1) % enabled.length];
    rotationCursor.set(providerId, next.id);
    return next.key;
  }

  /* ──────────────────────────── 变更操作 ──────────────────────────── */

  /** 新增 / 编辑供应商。新增自定义供应商默认启用。 */
  upsert(input: ProviderUpsertDto): ProviderDto {
    const baseURL = normalizeBaseURL(input.baseURL);
    if (baseURL.length === 0) throw new Error('API 地址必须是 http(s):// 开头的有效地址');
    const name = input.name.trim().slice(0, 60);
    if (name.length === 0) throw new Error('供应商名称不能为空');
    const providers = [...this.file.providers];
    if (input.id !== undefined) {
      const index = providers.findIndex((provider) => provider.id === input.id);
      if (index === -1) throw new Error('供应商不存在');
      const previous = providers[index];
      providers[index] = {
        ...previous,
        name,
        baseURL,
        enabled: input.enabled ?? previous.enabled,
        website: input.website !== undefined && input.website.length > 0 ? input.website : previous.website,
      };
      this.commit({ ...this.file, providers });
      return this.toDto(providers[index]);
    }
    const id = `provider-${randomUUID()}`;
    const created: ProviderRecord = {
      id,
      name,
      baseURL,
      enabled: input.enabled ?? true,
      authOptional: false,
      website: input.website,
      models: [],
      apiKeys: [],
    };
    providers.push(created);
    this.commit({ ...this.file, providers });
    return this.toDto(created);
  }

  /** 删除供应商（激活项不可删；预设实例删除后可在设置里重新添加）。 */
  remove(id: string): void {
    if (id === this.file.activeProviderId) throw new Error('不能删除使用中的供应商');
    const providers = this.file.providers.filter((provider) => provider.id !== id);
    if (providers.length === this.file.providers.length) throw new Error('供应商不存在');
    this.commit({ ...this.file, providers });
  }

  /** 批量添加 API Key：逗号 / 换行分隔，去重；已存在的 key 静默跳过。 */
  addApiKeys(providerId: string, keys: string[], label = ''): number {
    const provider = this.getRecord(providerId);
    if (provider === undefined) throw new Error('供应商不存在');
    const existing = new Set(provider.apiKeys.map((key) => key.key));
    const additions: ApiKeyRecord[] = [];
    for (const raw of keys) {
      const key = raw.trim();
      if (key.length === 0 || existing.has(key)) continue;
      existing.add(key);
      additions.push({ id: randomUUID(), key, label: label.trim().slice(0, 60), isEnabled: true });
    }
    if (additions.length === 0) return 0;
    const providers = this.file.providers.map((item) =>
      item.id === providerId ? { ...item, apiKeys: [...item.apiKeys, ...additions] } : item,
    );
    this.commit({ ...this.file, providers });
    return additions.length;
  }

  updateApiKey(providerId: string, keyId: string, patch: { label?: string; isEnabled?: boolean }): void {
    const provider = this.getRecord(providerId);
    if (provider === undefined) throw new Error('供应商不存在');
    const providers = this.file.providers.map((item) =>
      item.id === providerId
        ? {
            ...item,
            apiKeys: item.apiKeys.map((key) =>
              key.id === keyId
                ? {
                    ...key,
                    label: patch.label !== undefined ? patch.label.trim().slice(0, 60) : key.label,
                    isEnabled: patch.isEnabled !== undefined ? patch.isEnabled : key.isEnabled,
                  }
                : key,
            ),
          }
        : item,
    );
    this.commit({ ...this.file, providers });
  }

  deleteApiKey(providerId: string, keyId: string): void {
    const provider = this.getRecord(providerId);
    if (provider === undefined) throw new Error('供应商不存在');
    const providers = this.file.providers.map((item) =>
      item.id === providerId
        ? { ...item, apiKeys: item.apiKeys.filter((key) => key.id !== keyId) }
        : item,
    );
    this.commit({ ...this.file, providers });
  }

  setModels(providerId: string, models: ProviderModelDto[]): void {
    const provider = this.getRecord(providerId);
    if (provider === undefined) throw new Error('供应商不存在');
    const normalized = normalizeModels(models);
    const providers = this.file.providers.map((item) =>
      item.id === providerId ? { ...item, models: normalized } : item,
    );
    this.commit({ ...this.file, providers });
  }

  addModel(providerId: string, model: ProviderModelDto): void {
    const provider = this.getRecord(providerId);
    if (provider === undefined) throw new Error('供应商不存在');
    const id = model.id.trim();
    if (id.length === 0) throw new Error('模型 ID 不能为空');
    if (provider.models.some((item) => item.id === id)) return;
    const name = model.name !== undefined && model.name.trim().length > 0 ? model.name.trim() : undefined;
    const providers = this.file.providers.map((item) =>
      item.id === providerId
        ? { ...item, models: [...item.models, name === undefined ? { id } : { id, name }] }
        : item,
    );
    this.commit({ ...this.file, providers });
  }

  removeModel(providerId: string, modelId: string): void {
    const provider = this.getRecord(providerId);
    if (provider === undefined) throw new Error('供应商不存在');
    const providers = this.file.providers.map((item) =>
      item.id === providerId ? { ...item, models: item.models.filter((model) => model.id !== modelId) } : item,
    );
    this.commit({ ...this.file, providers });
  }

  /** 激活供应商（校验可用性：本地服务或有启用密钥）。 */
  activate(id: string): void {
    const provider = this.getRecord(id);
    if (provider === undefined) throw new Error('供应商不存在');
    if (!provider.authOptional && !provider.apiKeys.some((key) => key.isEnabled)) {
      throw new Error(`请先为「${provider.name}」配置至少一个启用的 API Key`);
    }
    this.commit({ ...this.file, activeProviderId: id });
  }

  updatePrefs(patch: Partial<ProviderPrefsDto>): void {
    const current = this.file.prefs;
    const maxTokens =
      patch.maxTokens === undefined && !Object.prototype.hasOwnProperty.call(patch, 'maxTokens')
        ? current.maxTokens
        : positiveIntOrUndefined(patch.maxTokens);
    const contextWindow =
      patch.contextWindow === undefined && !Object.prototype.hasOwnProperty.call(patch, 'contextWindow')
        ? current.contextWindow
        : positiveIntOrUndefined(patch.contextWindow);
    const prefs = {
      thinking:
        patch.thinking === 'disabled' || patch.thinking === 'enabled' ? patch.thinking : current.thinking,
      reasoningEffort:
        patch.reasoningEffort === 'off' || patch.reasoningEffort === 'high' || patch.reasoningEffort === 'max'
          ? patch.reasoningEffort
          : current.reasoningEffort,
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
    };
    this.commit({ ...this.file, prefs });
  }

  /** 旧版单 key 迁移：凭据文档中的 DEEPSEEK_API_KEY 灌入 DeepSeek 供应商。 */
  migrateLegacyKey(key: string): boolean {
    const trimmed = key.trim();
    if (trimmed.length === 0) return false;
    const provider = this.getRecord('deepseek');
    if (provider === undefined) return false;
    if (provider.apiKeys.length > 0 || provider.apiKeys.some((item) => item.key === trimmed)) return false;
    const providers = this.file.providers.map((item) =>
      item.id === 'deepseek'
        ? { ...item, apiKeys: [{ id: randomUUID(), key: trimmed, label: '迁移自旧版', isEnabled: true }] }
        : item,
    );
    this.commit({ ...this.file, providers });
    return true;
  }
}
