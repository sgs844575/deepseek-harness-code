import type { ProviderModelDto } from '../../shared/protocol.js';

/**
 * 内置供应商预设（全部为 OpenAI 兼容端点，harness llm-deepseek 适配器
 * 以 baseURL + /chat/completions 直连）。预设只是种子数据：实例化后
 * 名称 / 地址 / 模型目录均可改，与 Cherry Studio 的 provider 预设一致。
 */
export interface ProviderPreset {
  id: string;
  name: string;
  baseURL: string;
  /** 控制台 / 获取密钥地址。 */
  website?: string;
  /** 本地服务（无鉴权）允许无密钥使用。 */
  authOptional?: boolean;
  /** 预置模型目录（可经「获取模型列表」覆盖）。 */
  models?: ProviderModelDto[];
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek 官方',
    baseURL: 'https://api.deepseek.com',
    website: 'https://platform.deepseek.com/api_keys',
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: 1_000_000 },
      { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: 1_000_000 },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    website: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    website: 'https://openrouter.ai/keys',
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    baseURL: 'https://api.siliconflow.cn/v1',
    website: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'moonshot',
    name: '月之暗面 Kimi',
    baseURL: 'https://api.moonshot.cn/v1',
    website: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    website: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'ollama',
    name: 'Ollama（本地）',
    baseURL: 'http://127.0.0.1:11434/v1',
    authOptional: true,
  },
] as const;
