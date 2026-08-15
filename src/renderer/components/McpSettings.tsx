import { useCallback, useEffect, useState } from 'react';
import type { McpServerDto, McpUpsertDto } from '../../shared/protocol.js';
import { requireBridge } from '../ipc/api';

/**
 * MCP 服务器设置页：列表（启停 / 编辑 / 删除）+ 新增表单。
 * 保存只写 mcp-servers.json；「应用变更」把 harness 以新组合重启
 * （MCP 是插件行，无法热生效）。工具以 mcp__<名称>__<工具> 出现在会话中。
 */

/** 表单草稿（字符串化字段，提交时归一）。 */
interface McpDraft {
  id?: string;
  name: string;
  transport: 'stdio' | 'streamable-http';
  enabled: boolean;
  command: string;
  /** 参数与键值表都以「每行一条」编辑；args 按行拆，env/headers 按 = 拆。 */
  args: string;
  env: string;
  cwd: string;
  url: string;
  headers: string;
}

const EMPTY_DRAFT: McpDraft = {
  name: '',
  transport: 'stdio',
  enabled: true,
  command: '',
  args: '',
  env: '',
  cwd: '',
  url: '',
  headers: '',
};

function draftOf(server: McpServerDto): McpDraft {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    enabled: server.enabled,
    command: server.command,
    args: server.args.join('\n'),
    env: Object.entries(server.env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
    cwd: server.cwd,
    url: server.url,
    headers: Object.entries(server.headers)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
  };
}

/** 「KEY=VALUE」行 → 记录（无 = 的行忽略；值可含 =）。 */
function parseEntries(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function parseArgs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function McpSettings() {
  const [servers, setServers] = useState<McpServerDto[]>([]);
  const [draft, setDraft] = useState<McpDraft | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [applying, setApplying] = useState(false);
  /** 上次 apply 时的列表指纹：与当前不同 = 有未应用变更。 */
  const [appliedFingerprint, setAppliedFingerprint] = useState<string>('');

  const fingerprint = JSON.stringify(servers);

  useEffect(() => {
    const bridge = requireBridge();
    let disposed = false;
    void bridge.mcp
      .getAll()
      .then((list) => {
        if (disposed) return;
        setServers(list);
        setAppliedFingerprint(JSON.stringify(list));
      })
      .catch((err) => console.error('读取 MCP 服务器失败', err));
    const unsubscribe = bridge.mcp.onChanged((list) => {
      setServers(list);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const submitDraft = useCallback(async () => {
    if (draft === null) return;
    setError('');
    const input: McpUpsertDto = {
      ...(draft.id !== undefined ? { id: draft.id } : {}),
      name: draft.name,
      transport: draft.transport,
      enabled: draft.enabled,
      command: draft.command,
      args: parseArgs(draft.args),
      env: parseEntries(draft.env),
      cwd: draft.cwd,
      url: draft.url,
      headers: parseEntries(draft.headers),
    };
    try {
      await requireBridge().mcp.upsert(input);
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [draft]);

  const removeServer = useCallback(async (id: string) => {
    setError('');
    try {
      await requireBridge().mcp.remove(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const apply = useCallback(async () => {
    setApplying(true);
    setError('');
    setNotice('');
    try {
      await requireBridge().mcp.apply();
      setAppliedFingerprint(fingerprint);
      setNotice('引擎已按新配置重启，会话列表已刷新。');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }, [fingerprint]);

  const dirty = fingerprint !== appliedFingerprint;

  return (
    <div className="mcpsetup">
      <div className="mcp-head">
        <h1 className="settingspage__title">MCP 服务器</h1>
        <div className="mcp-head__actions">
          {dirty && <span className="mcp-pending">有未应用的更改</span>}
          <button
            type="button"
            className="settingspage__save settingspage__save--primary"
            disabled={!dirty || applying}
            onClick={() => void apply()}
          >
            {applying ? '应用中…' : '应用变更（重启引擎）'}
          </button>
          <button
            type="button"
            className="settingspage__save"
            disabled={draft !== null}
            onClick={() => {
              setDraft({ ...EMPTY_DRAFT });
              setError('');
            }}
          >
            添加服务器
          </button>
        </div>
      </div>
      <div className="settingspage__cards">
        <section className="settingscard">
          <div className="settings-row settings-row--stack">
            <div className="settings-row__main">
              <div className="settings-row__title">说明</div>
              <div className="settings-row__desc">
                每台服务器在引擎启动时接入（stdio 启动命令或 Streamable HTTP 地址），其工具以
                <code> mcp__名称__工具 </code>注入会话。配置保存在本地 mcp-servers.json
                （环境变量为明文，请勿放入共享环境）。stdio 建议写已安装的可执行文件，
                避免 npx 首次下载超时。
              </div>
              {notice.length > 0 && (
                <div className="settings-row__desc settings-row__desc--accent">{notice}</div>
              )}
              {error.length > 0 && (
                <div className="settings-row__desc settings-row__desc--error">{error}</div>
              )}
            </div>
          </div>
          {draft !== null && (
            <McpServerForm
              draft={draft}
              onChange={setDraft}
              onSubmit={() => void submitDraft()}
              onCancel={() => {
                setDraft(null);
                setError('');
              }}
            />
          )}
          {servers.length === 0 && draft === null && (
            <div className="settings-row">
              <div className="settings-row__main">
                <div className="settings-row__desc">暂无服务器——点击右上角「添加服务器」。</div>
              </div>
            </div>
          )}
          {servers.map((server) => (
            <div key={server.id} className="settings-row">
              <div className="settings-row__main">
                <div className="settings-row__title">
                  {server.name}
                  <span className="mcp-badge">{server.transport === 'stdio' ? 'stdio' : 'HTTP'}</span>
                  {!server.enabled && <span className="mcp-badge mcp-badge--off">已停用</span>}
                </div>
                <div className="settings-row__desc">
                  {server.transport === 'stdio'
                    ? `${server.command}${server.args.length > 0 ? ` ${server.args.join(' ')}` : ''}`
                    : server.url}
                </div>
              </div>
              <div className="settings-row__control">
                <button
                  type="button"
                  className="settingspage__save"
                  onClick={() => setDraft(draftOf(server))}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="settingspage__save"
                  onClick={() => void requireBridge().mcp.setEnabled(server.id, !server.enabled)}
                >
                  {server.enabled ? '停用' : '启用'}
                </button>
                <button
                  type="button"
                  className="settingspage__save"
                  onClick={() => void removeServer(server.id)}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function McpServerForm({
  draft,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: McpDraft;
  onChange(next: McpDraft): void;
  onSubmit(): void;
  onCancel(): void;
}) {
  const patch = (part: Partial<McpDraft>): void => onChange({ ...draft, ...part });
  return (
    <div className="mcp-form">
      <div className="mcp-form__row">
        <label className="mcp-form__field">
          <span>名称（工具命名空间，字母/数字/_/-）</span>
          <input
            className="settingspage__input"
            value={draft.name}
            spellCheck={false}
            maxLength={32}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </label>
        <label className="mcp-form__field mcp-form__field--narrow">
          <span>类型</span>
          <select
            className="settingspage__select"
            value={draft.transport}
            onChange={(event) =>
              patch({ transport: event.target.value === 'streamable-http' ? 'streamable-http' : 'stdio' })
            }
          >
            <option value="stdio">stdio（本地命令）</option>
            <option value="streamable-http">HTTP（Streamable HTTP）</option>
          </select>
        </label>
      </div>
      {draft.transport === 'stdio' ? (
        <>
          <div className="mcp-form__row">
            <label className="mcp-form__field">
              <span>启动命令（可执行文件名或绝对路径）</span>
              <input
                className="settingspage__input"
                value={draft.command}
                spellCheck={false}
                placeholder="mcp-server-memory"
                onChange={(event) => patch({ command: event.target.value })}
              />
            </label>
            <label className="mcp-form__field">
              <span>工作目录（可选）</span>
              <input
                className="settingspage__input"
                value={draft.cwd}
                spellCheck={false}
                onChange={(event) => patch({ cwd: event.target.value })}
              />
            </label>
          </div>
          <label className="mcp-form__field">
            <span>参数（每行一个）</span>
            <textarea
              className="mcp-form__textarea"
              value={draft.args}
              spellCheck={false}
              onChange={(event) => patch({ args: event.target.value })}
            />
          </label>
          <label className="mcp-form__field">
            <span>环境变量（每行 KEY=VALUE）</span>
            <textarea
              className="mcp-form__textarea"
              value={draft.env}
              spellCheck={false}
              placeholder={'MEMORY_DIR=D:\\mcp-memory'}
              onChange={(event) => patch({ env: event.target.value })}
            />
          </label>
        </>
      ) : (
        <>
          <label className="mcp-form__field">
            <span>服务器地址</span>
            <input
              className="settingspage__input"
              value={draft.url}
              spellCheck={false}
              placeholder="https://example.com/mcp"
              onChange={(event) => patch({ url: event.target.value })}
            />
          </label>
          <label className="mcp-form__field">
            <span>请求头（每行 KEY=VALUE，如 Authorization）</span>
            <textarea
              className="mcp-form__textarea"
              value={draft.headers}
              spellCheck={false}
              onChange={(event) => patch({ headers: event.target.value })}
            />
          </label>
        </>
      )}
      <div className="mcp-form__row mcp-form__row--end">
        <button type="button" className="settingspage__save" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="settingspage__save settingspage__save--primary"
          disabled={draft.name.trim().length === 0}
          onClick={onSubmit}
        >
          保存
        </button>
      </div>
    </div>
  );
}
