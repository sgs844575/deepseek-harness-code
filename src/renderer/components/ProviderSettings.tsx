import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderDto } from '../../shared/protocol.js';
import { requireBridge } from '../ipc/api';
import { useProviders } from '../state/providers';

/**
 * 模型服务设置（多供应商 / 多 Key，参考 Cherry Studio）：
 * 左列供应商列表（含「添加自定义」），右侧选中供应商的编辑面板——
 * 名称 / API 地址 / 多 Key 管理（批量添加、启停、删除）、模型目录
 * （一键拉取 / 手动增删 / 设为默认）与全局思考偏好。
 *
 * 明文 key 只提交给主进程，回显永远脱敏；任何变更经主进程持久化后
 * 以 providers:changed 整包推送回填。
 */

export function ProviderSettings() {
  const { snapshot, loaded, refresh } = useProviders();
  const [selectedId, setSelectedId] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const [defaultModel, setDefaultModel] = useState('');
  const [flash, setFlash] = useState('');
  const flashTimer = useRef<number | null>(null);

  const notify = useCallback((text: string) => {
    setFlash(text);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(''), 4000);
  }, []);

  useEffect(() => () => {
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
  }, []);

  // 默认选中激活供应商；快照到达后跟随一次。
  useEffect(() => {
    if (snapshot.providers.length === 0) return;
    setSelectedId((current) =>
      current.length === 0 || !snapshot.providers.some((provider) => provider.id === current)
        ? snapshot.activeProviderId
        : current,
    );
  }, [snapshot]);

  const refreshDefaultModel = useCallback(() => {
    void requireBridge()
      .settings.getDefaultModel()
      .then((selection) => setDefaultModel(selection.model))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshDefaultModel();
  }, [refreshDefaultModel, snapshot.activeProviderId]);

  const selected = useMemo(
    () => snapshot.providers.find((provider) => provider.id === selectedId),
    [snapshot.providers, selectedId],
  );

  const activate = useCallback(
    async (id: string) => {
      try {
        await requireBridge().providers.activate(id);
        refreshDefaultModel();
        notify('已切换供应商（新对话生效，进行中的请求按原配置完成）');
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error));
      }
    },
    [notify, refreshDefaultModel],
  );

  const makeDefault = useCallback(
    async (modelId: string) => {
      if (selected === undefined) return;
      try {
        await requireBridge().providers.selectModel(selected.id, modelId);
        setDefaultModel(modelId);
        notify(`默认模型已设为 ${modelId}`);
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error));
      }
    },
    [selected, notify],
  );

  if (!loaded) {
    return <div className="settingspage__cards"><div className="provflash">正在读取供应商配置…</div></div>;
  }

  return (
    <div className="providersetup">
      <aside className="providersetup__list">
        {snapshot.providers.map((provider) => (
          <button
            type="button"
            key={provider.id}
            className={`provrow${provider.id === selectedId ? ' provrow--active' : ''}`}
            onClick={() => setSelectedId(provider.id)}
          >
            <span className="provrow__dot" aria-hidden />
            <span className="provrow__main">
              <span className="provrow__name">{provider.name}</span>
              <span className="provrow__status">
                {provider.id === snapshot.activeProviderId
                  ? `使用中 · ${provider.models.length} 个模型`
                  : provider.authOptional || provider.keyConfigured
                    ? `${provider.models.length} 个模型`
                    : '未配置密钥'}
              </span>
            </span>
            {provider.id === snapshot.activeProviderId && <span className="provrow__badge">使用中</span>}
          </button>
        ))}
        <button
          type="button"
          className={`provrow provrow--add${adding ? ' provrow--addopen' : ''}`}
          onClick={() => setAdding((open) => !open)}
        >
          <span className="provrow__plus" aria-hidden>+</span>
          添加自定义供应商
        </button>
        {adding && (
          <ProviderAddForm
            onCancel={() => setAdding(false)}
            onCreated={(id) => {
              setAdding(false);
              setSelectedId(id);
              refresh();
            }}
          />
        )}
      </aside>
      {selected !== undefined ? (
        <ProviderDetail
          provider={selected}
          isActive={selected.id === snapshot.activeProviderId}
          prefs={snapshot.prefs}
          defaultModel={defaultModel}
          flash={flash}
          onActivate={() => void activate(selected.id)}
          onMakeDefault={(modelId) => void makeDefault(modelId)}
          onFlash={notify}
        />
      ) : (
        <div className="providersetup__detail provflash">选择左侧供应商查看详情</div>
      )}
    </div>
  );
}

/* ──────────────────────────── 新增自定义供应商 ──────────────────────────── */

function ProviderAddForm({ onCreated, onCancel }: { onCreated(id: string): void; onCancel(): void }) {
  const [name, setName] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    try {
      const created = await requireBridge().providers.upsert({ name, baseURL });
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="provadd">
      <input
        type="text"
        className="provadd__input"
        placeholder="名称，如 公司网关"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <input
        type="text"
        className="provadd__input"
        placeholder="API 地址，如 https://gw.example.com/v1"
        spellCheck={false}
        value={baseURL}
        onChange={(event) => setBaseURL(event.target.value)}
      />
      {error.length > 0 && <div className="provadd__error">{error}</div>}
      <div className="provadd__actions">
        <button type="button" className="provbtn" onClick={onCancel}>取消</button>
        <button
          type="button"
          className="provbtn provbtn--primary"
          disabled={name.trim().length === 0 || baseURL.trim().length === 0}
          onClick={() => void submit()}
        >
          添加
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────── 供应商详情面板 ──────────────────────────── */

function ProviderDetail({
  provider,
  isActive,
  prefs,
  defaultModel,
  flash,
  onActivate,
  onMakeDefault,
  onFlash,
}: {
  provider: ProviderDto;
  isActive: boolean;
  prefs: { thinking: 'enabled' | 'disabled'; reasoningEffort: 'off' | 'high' | 'max' };
  defaultModel: string;
  flash: string;
  onActivate(): void;
  onMakeDefault(modelId: string): void;
  onFlash(text: string): void;
}) {
  const [nameInput, setNameInput] = useState<string | undefined>(undefined);
  const [baseInput, setBaseInput] = useState<string | undefined>(undefined);
  const [keyInput, setKeyInput] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);
  const [modelInput, setModelInput] = useState('');
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    setNameInput(undefined);
    setBaseInput(undefined);
    setKeyInput('');
    setModelInput('');
  }, [provider.id]);

  const commitMeta = async () => {
    if (nameInput === undefined && baseInput === undefined) return;
    const name = (nameInput ?? provider.name).trim();
    const baseURL = (baseInput ?? provider.baseURL).trim();
    if (name === provider.name && baseURL === provider.baseURL) {
      setNameInput(undefined);
      setBaseInput(undefined);
      return;
    }
    try {
      await requireBridge().providers.upsert({ id: provider.id, name, baseURL });
      onFlash('供应商信息已保存');
      setNameInput(undefined);
      setBaseInput(undefined);
    } catch (error) {
      onFlash(error instanceof Error ? error.message : String(error));
    }
  };

  const addKeys = async () => {
    const value = keyInput.trim();
    if (value.length === 0) return;
    try {
      const added = await requireBridge().providers.addApiKey(provider.id, value);
      setKeyInput('');
      onFlash(added > 0 ? `已添加 ${added} 个密钥` : '密钥已存在，未重复添加');
    } catch (error) {
      onFlash(error instanceof Error ? error.message : String(error));
    }
  };

  const fetchModels = async () => {
    setFetching(true);
    try {
      const models = await requireBridge().providers.fetchModels(provider.id);
      onFlash(`已获取 ${models.length} 个模型`);
    } catch (error) {
      onFlash(`获取失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setFetching(false);
    }
  };

  const addModel = async () => {
    const id = modelInput.trim();
    if (id.length === 0) return;
    try {
      await requireBridge().providers.addModel(provider.id, { id });
      setModelInput('');
    } catch (error) {
      onFlash(error instanceof Error ? error.message : String(error));
    }
  };

  const updatePrefs = async (patch: Partial<typeof prefs>) => {
    try {
      await requireBridge().providers.updatePrefs(patch);
    } catch (error) {
      onFlash(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="providersetup__detail">
      {/* 名称 + 地址 + 激活 */}
      <section className="settingscard provcard">
        <div className="provcard__head">
          <div className="provcard__title-wrap">
            <input
              type="text"
              className="provcard__name"
              value={nameInput ?? provider.name}
              onChange={(event) => setNameInput(event.target.value)}
              onBlur={() => void commitMeta()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void commitMeta();
              }}
              spellCheck={false}
            />
            <div className="provcard__base-row">
              <input
                type="text"
                className="provcard__base"
                placeholder="API 地址（OpenAI 兼容，如 https://api.deepseek.com）"
                value={baseInput ?? provider.baseURL}
                onChange={(event) => setBaseInput(event.target.value)}
                onBlur={() => void commitMeta()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void commitMeta();
                }}
                spellCheck={false}
              />
              {provider.website !== undefined && (
                <button
                  type="button"
                  className="provlink"
                  onClick={() =>
                    void requireBridge().app.openExternal(provider.website ?? '').catch(() => undefined)
                  }
                >
                  获取密钥 ↗
                </button>
              )}
            </div>
          </div>
          {isActive ? (
            <span className="provbadge provbadge--active">使用中</span>
          ) : (
            <button type="button" className="provbtn provbtn--primary" onClick={onActivate}>
              使用
            </button>
          )}
        </div>
        <div className="provcard__desc">
          OpenAI 兼容端点（baseURL + /chat/completions 直连）；配置变更热生效，无需重启。
        </div>
      </section>

      {/* API 密钥（多 Key） */}
      <section className="settingscard provcard">
        <div className="provcard__section-title">
          API 密钥
          <span className="provcard__section-hint">
            {provider.apiKeys.length > 0 ? `${provider.apiKeys.filter((k) => k.isEnabled).length}/${provider.apiKeys.length} 启用 · 请求时轮询` : '支持多个密钥轮询分流'}
          </span>
        </div>
        <div className="provkey__row">
          <input
            type={keyVisible ? 'text' : 'password'}
            className="provkey__input"
            spellCheck={false}
            placeholder={provider.authOptional ? '本地服务可留空' : 'sk-...（多个用英文逗号分隔）'}
            value={keyInput}
            onChange={(event) => setKeyInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void addKeys();
            }}
          />
          <button
            type="button"
            className="proviconbtn"
            title={keyVisible ? '隐藏密钥' : '显示密钥'}
            onClick={() => setKeyVisible((visible) => !visible)}
          >
            {keyVisible ? <EyeOffIcon /> : <EyeIcon />}
          </button>
          <button
            type="button"
            className="provbtn"
            disabled={keyInput.trim().length === 0}
            onClick={() => void addKeys()}
          >
            添加
          </button>
        </div>
        {provider.apiKeys.length > 0 && (
          <div className="provkey__list">
            {provider.apiKeys.map((key) => (
              <div className="provkey" key={key.id}>
                <code className="provkey__masked">{key.masked}</code>
                <input
                  type="text"
                  className="provkey__label"
                  placeholder="标签（可选）"
                  value={key.label}
                  onChange={(event) =>
                    void requireBridge()
                      .providers.updateApiKey(provider.id, key.id, { label: event.target.value })
                      .catch(() => undefined)
                  }
                />
                <input
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={key.isEnabled}
                  onChange={(event) =>
                    void requireBridge()
                      .providers.updateApiKey(provider.id, key.id, { isEnabled: event.target.checked })
                      .catch(() => undefined)
                  }
                />
                <button
                  type="button"
                  className="proviconbtn proviconbtn--danger"
                  title="删除密钥"
                  onClick={() =>
                    void requireBridge()
                      .providers.deleteApiKey(provider.id, key.id)
                      .catch((error) => onFlash(error instanceof Error ? error.message : String(error)))
                  }
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="provcard__desc">密钥存储于本机（~/.deep-seek-harness-code），不会进入会话记录。</div>
      </section>

      {/* 模型目录 */}
      <section className="settingscard provcard">
        <div className="provcard__section-title">
          模型
          <div className="provcard__section-actions">
            <button type="button" className="provlink" disabled={fetching} onClick={() => void fetchModels()}>
              {fetching ? '获取中…' : '获取模型列表'}
            </button>
          </div>
        </div>
        <div className="provkey__row">
          <input
            type="text"
            className="provkey__input"
            placeholder="手动添加模型 ID，如 deepseek-v4-pro"
            spellCheck={false}
            value={modelInput}
            onChange={(event) => setModelInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void addModel();
            }}
          />
          <button
            type="button"
            className="provbtn"
            disabled={modelInput.trim().length === 0}
            onClick={() => void addModel()}
          >
            添加
          </button>
        </div>
        {provider.models.length === 0 ? (
          <div className="provcard__desc provcard__desc--standalone">
            暂无模型：点击「获取模型列表」从 API 拉取，或手动添加模型 ID。
          </div>
        ) : (
          <div className="provmodels">
            {provider.models.map((model) => {
              const isDefault = isActive && defaultModel === model.id;
              return (
                <div className="provmodel" key={model.id}>
                  <span className="provmodel__icon" aria-hidden />
                  <div className="provmodel__main">
                    <span className="provmodel__name">{model.name ?? model.id}</span>
                    <span className="provmodel__id">{model.id}</span>
                  </div>
                  {isDefault ? (
                    <span className="provbadge provbadge--active">默认</span>
                  ) : (
                    <button type="button" className="provlink" onClick={() => onMakeDefault(model.id)}>
                      设为默认
                    </button>
                  )}
                  <button
                    type="button"
                    className="proviconbtn proviconbtn--danger"
                    title="移除模型"
                    onClick={() =>
                      void requireBridge()
                        .providers.removeModel(provider.id, model.id)
                        .catch((error) => onFlash(error instanceof Error ? error.message : String(error)))
                    }
                  >
                    <TrashIcon />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 思考偏好（全局） */}
      <section className="settingscard provcard">
        <div className="provcard__section-title">思考偏好（全局）</div>
        <div className="settings-row">
          <div className="settings-row__main">
            <div className="settings-row__title">深度思考</div>
            <div className="settings-row__desc">关闭后所有对话请求限制为不做思考（effort 强制 off）。</div>
          </div>
          <div className="settings-row__control">
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={prefs.thinking !== 'disabled'}
              onChange={(event) =>
                void updatePrefs({ thinking: event.target.checked ? 'enabled' : 'disabled' })
              }
            />
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row__main">
            <div className="settings-row__title">推理强度</div>
            <div className="settings-row__desc">思考开启时的默认努力档位。</div>
          </div>
          <div className="settings-row__control">
            <select
              className="settingspage__select"
              value={prefs.reasoningEffort}
              onChange={(event) =>
                void updatePrefs({
                  reasoningEffort: event.target.value as 'off' | 'high' | 'max',
                })
              }
            >
              <option value="off">关闭</option>
              <option value="high">高</option>
              <option value="max">最大</option>
            </select>
          </div>
        </div>
      </section>

      {flash.length > 0 && <div className="provflash provflash--toast">{flash}</div>}
    </div>
  );
}

/* ──────────────────────────── 图标 ──────────────────────────── */

function EyeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"
        stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.8" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4.5 8.5C3.2 9.7 2.5 12 2.5 12S6 18.2 12 18.2c1.9 0 3.5-.7 4.8-1.6M9.7 6.3A9.6 9.6 0 0 1 12 5.8c6 0 9.5 6.2 9.5 6.2s-.9 1.9-2.6 3.5"
        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      />
      <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4.5 6.5h15M9.5 6V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3V6M7 6.5l.8 12.2c.06.9.8 1.6 1.7 1.6h5c.9 0 1.64-.7 1.7-1.6L17 6.5"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}
