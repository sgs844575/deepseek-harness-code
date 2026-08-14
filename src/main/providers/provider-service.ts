import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ProviderModelDto, ProviderSnapshotDto } from '../../shared/protocol.js';
import type { HarnessService } from '../harness/harness-service.js';
import { resolveHarnessPaths } from '../harness/paths.js';
import { ProviderStore } from './provider-store.js';

/**
 * 供应商服务：把 ProviderStore 的持久化状态翻译成 harness 副作用——
 * 激活供应商的 baseURL / 模型目录 / 思考偏好写入 llm-deepseek 设置段，
 * 轮询密钥写入受管凭据文档；任何配置变更后自动重推（免重启热生效）。
 *
 * 多 key 轮询（Cherry Studio 同款 round-robin）：每轮对话前取下一把
 * 启用的 key，key 未变化则跳过凭据写入。
 */

/** 凭据文档中旧版单 key 的引用名。 */
const LEGACY_KEY_REF = 'DEEPSEEK_API_KEY';

/** 拉取模型目录的请求超时。 */
const FETCH_MODELS_TIMEOUT_MS = 15_000;

export interface LlmSectionDto {
  baseURL: string;
  models: ProviderModelDto[];
  thinking: 'enabled' | 'disabled';
  reasoningEffort: 'off' | 'high' | 'max';
}

export class ProviderService {
  private readonly store: ProviderStore;
  private harness: HarnessService | undefined;
  /** 最近写入凭据文档的 key（避免每轮重复写盘）。 */
  private lastAppliedKey: string | undefined;

  constructor(store: ProviderStore) {
    this.store = store;
  }

  /** 组合根在 harness 就绪后注入；同时启动「变更即重推」。 */
  attach(harness: HarnessService): void {
    this.harness = harness;
    this.store.subscribe(() => {
      void this.applyToHarness().catch((error) =>
        console.error('[providers] 推送 harness 配置失败：', error),
      );
    });
    this.migrateLegacyCredential();
    void this.applyToHarness().catch((error) =>
      console.error('[providers] 推送 harness 配置失败：', error),
    );
  }

  snapshot(): ProviderSnapshotDto {
    return this.store.snapshot();
  }

  getStore(): ProviderStore {
    return this.store;
  }

  /**
   * 下一轮对话使用的密钥：round-robin；与上次相同（或无可用 key）时返回
   * undefined，调用方跳过凭据写入。
   */
  keyForNextTurn(): string | undefined {
    const key = this.store.rotateApiKey(this.store.snapshot().activeProviderId);
    if (key === undefined || key === this.lastAppliedKey) return undefined;
    this.lastAppliedKey = key;
    return key;
  }

  /** 当前激活供应商的 llm 设置段（thinking disabled 时强制 effort=off）。 */
  llmSection(): LlmSectionDto {
    const snapshot = this.store.snapshot();
    const provider = this.store.activeRecord;
    const thinking = snapshot.prefs.thinking;
    const reasoningEffort =
      thinking === 'disabled' && snapshot.prefs.reasoningEffort !== 'off'
        ? 'off'
        : snapshot.prefs.reasoningEffort;
    return {
      baseURL: provider.baseURL,
      models: provider.models,
      thinking,
      reasoningEffort,
    };
  }

  /**
   * 把激活供应商推送给 harness：设置段整段替换（llm-deepseek 对
   * baseURL/目录/密钥按请求时解析，改完下一请求即生效）+ 轮询密钥写入
   * 凭据文档 + 默认模型不在目录时回落到第一个模型。
   */
  async applyToHarness(): Promise<void> {
    const harness = this.harness;
    if (harness === undefined || !harness.isReady()) return;
    const provider = this.store.activeRecord;
    await harness.updateLlmSection(this.llmSection());
    if (!provider.authOptional) {
      const key = this.store.rotateApiKey(provider.id);
      if (key !== undefined) {
        await harness.setCredential(key);
        this.lastAppliedKey = key;
      }
    }
    // 默认模型可能属于上一个供应商：不在当前目录时回落到第一个模型。
    const selection = await harness.getDefaultModel();
    if (!provider.models.some((model) => model.id === selection.model)) {
      const first = provider.models[0];
      if (first !== undefined) await harness.setDefaultModel(first.id);
    }
  }

  /**
   * 选择模型（聊天头部下拉用）：跨供应商时先激活，推送配置后设为默认模型。
   */
  async selectModel(providerId: string, modelId: string): Promise<void> {
    if (this.store.snapshot().activeProviderId !== providerId) {
      this.store.activate(providerId); // 触发订阅者自动重推
    }
    await this.applyToHarness();
    const harness = this.harness;
    if (harness !== undefined && harness.isReady()) {
      await harness.setDefaultModel(modelId);
    }
  }

  /**
   * 从供应商 API 拉取模型目录（GET {baseURL}/models，OpenAI 兼容格式）
   * 并保存。成功同时说明地址与密钥可用（兼作连接检查）。
   */
  async fetchModels(providerId: string): Promise<ProviderModelDto[]> {
    const provider = this.store.getRecord(providerId);
    if (provider === undefined) throw new Error('供应商不存在');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (!provider.authOptional) {
      const key = this.store.rotateApiKey(providerId);
      if (key === undefined) throw new Error('无启用的 API Key，无法拉取模型列表');
      headers.Authorization = `Bearer ${key}`;
    }
    const response = await fetch(`${provider.baseURL}/models`, {
      headers,
      signal: AbortSignal.timeout(FETCH_MODELS_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`供应商返回 ${response.status} ${response.statusText}`);
    }
    const payload = (await response.json()) as { data?: unknown };
    const raw = Array.isArray(payload.data) ? payload.data : [];
    const models: ProviderModelDto[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      if (typeof item !== 'object' || item === null) continue;
      const id = (item as Record<string, unknown>).id;
      if (typeof id !== 'string' || id.trim().length === 0 || seen.has(id)) continue;
      seen.add(id);
      models.push({ id });
    }
    models.sort((a, b) => a.id.localeCompare(b.id));
    if (models.length === 0) throw new Error('供应商未返回任何模型');
    this.store.setModels(providerId, models);
    return models;
  }

  /** 旧版迁移：凭据文档里的 DEEPSEEK_API_KEY 灌入 DeepSeek 供应商（仅一次）。 */
  private migrateLegacyCredential(): void {
    try {
      const credentialsPath = path.join(resolveHarnessPaths().dshHome, '.credentials.yaml');
      const document = parseYaml(readFileSync(credentialsPath, 'utf8')) as Record<string, unknown> | undefined;
      const key = document?.[LEGACY_KEY_REF];
      if (typeof key === 'string' && key.length > 0) {
        this.store.migrateLegacyKey(key);
        console.info('[providers] 已迁移旧版 API Key 到 DeepSeek 供应商');
      }
    } catch {
      // 无旧凭据或读取失败：忽略（新装用户没有旧文件）。
    }
  }
}
