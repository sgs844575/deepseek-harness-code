import { useCallback, useEffect, useState } from 'react';
import type { PluginSnapshotDto, UserPluginDto, UserPluginUpsertDto } from '../../shared/protocol.js';
import { requireBridge } from '../ipc/api';

/**
 * 插件设置页：内置组合行（cordis.yml，只读状态）+ 自定义插件
 * （名称 + 入口 JS 文件，boot 补丁注入）。「应用变更」重启引擎生效
 * （插件行无法热装载，与 MCP 同一条 restart 路径）。
 */

const STATUS_LABELS: Record<string, string> = {
  loaded: '已加载',
  disabled: '已停用',
  error: '加载失败',
};

export function PluginSettings() {
  const [snapshot, setSnapshot] = useState<PluginSnapshotDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserPluginDto | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [applying, setApplying] = useState(false);
  /** 上次 apply 时的用户插件指纹：不同 = 有未应用变更。 */
  const [appliedFingerprint, setAppliedFingerprint] = useState('');

  const refresh = useCallback(async () => {
    try {
      const next = await requireBridge().plugins.getAll();
      setSnapshot(next);
    } catch (err) {
      console.error('读取插件状态失败', err);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const fingerprint = JSON.stringify(snapshot?.user ?? []);
  const dirty = fingerprint !== appliedFingerprint;

  const submit = useCallback(
    async (input: UserPluginUpsertDto) => {
      setError('');
      try {
        await requireBridge().plugins.upsert(input);
        setFormOpen(false);
        setEditing(null);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  const removePlugin = useCallback(
    async (id: string) => {
      setError('');
      try {
        await requireBridge().plugins.remove(id);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  const toggle = useCallback(
    async (plugin: UserPluginDto) => {
      await requireBridge().plugins.setEnabled(plugin.id, !plugin.enabled).catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
      await refresh();
    },
    [refresh],
  );

  const apply = useCallback(async () => {
    setApplying(true);
    setError('');
    setNotice('');
    try {
      await requireBridge().plugins.apply();
      setAppliedFingerprint(fingerprint);
      await refresh();
      setNotice('引擎已按新插件组合重启。');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }, [fingerprint, refresh]);

  return (
    <div className="mcpsetup">
      <div className="mcp-head">
        <h1 className="settingspage__title">插件</h1>
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
            disabled={formOpen}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
              setError('');
            }}
          >
            安装插件
          </button>
        </div>
      </div>
      <div className="settingspage__cards">
        <section className="settingscard">
          <div className="settings-row settings-row--stack">
            <div className="settings-row__main">
              <div className="settings-row__title">内置插件（{snapshot?.builtin.length ?? 0}）</div>
              <div className="settings-row__desc">
                引擎静态组合（config/harness/cordis.yml）的插件行，随宿主一起装载；
                MCP 服务器与命令沙箱等动态组合行不在此列。
              </div>
              {error.length > 0 && (
                <div className="settings-row__desc settings-row__desc--error">{error}</div>
              )}
              {notice.length > 0 && (
                <div className="settings-row__desc settings-row__desc--accent">{notice}</div>
              )}
            </div>
          </div>
          <div className="plugin-grid">
            {(snapshot?.builtin ?? []).map((plugin) => (
              <span key={plugin.id} className="plugin-chip">
                <span className="plugin-chip__name">{plugin.id}</span>
                <span className={`plugin-chip__status plugin-chip__status--${plugin.status}`}>
                  {STATUS_LABELS[plugin.status] ?? plugin.status}
                </span>
              </span>
            ))}
          </div>
        </section>
        <section className="settingscard">
          <div className="settings-row settings-row--stack">
            <div className="settings-row__main">
              <div className="settings-row__title">自定义插件</div>
              <div className="settings-row__desc">
                指定一个 cordis 插件入口 JS 文件（默认导出插件类或 apply 函数），保存后
                「应用变更」随引擎重启挂载；入口需与组合目录（应用安装盘）在同一磁盘分区。
              </div>
            </div>
          </div>
          {formOpen && (
            <PluginForm
              initial={editing}
              onCancel={() => {
                setFormOpen(false);
                setEditing(null);
              }}
              onSubmit={(input) => void submit(input)}
            />
          )}
          {(snapshot?.user.length ?? 0) === 0 && !formOpen && (
            <div className="settings-row">
              <div className="settings-row__main">
                <div className="settings-row__desc">暂无自定义插件——点击右上角「安装插件」。</div>
              </div>
            </div>
          )}
          {(snapshot?.user ?? []).map((plugin) => (
            <div key={plugin.id} className="settings-row">
              <div className="settings-row__main">
                <div className="settings-row__title">
                  {plugin.name}
                  <span className={`plugin-chip__status plugin-chip__status--${plugin.status}`}>
                    {STATUS_LABELS[plugin.status] ?? plugin.status}
                  </span>
                </div>
                <div className="settings-row__desc" title={plugin.entryPath}>
                  {plugin.entryPath}
                </div>
              </div>
              <div className="settings-row__control">
                <button
                  type="button"
                  className="settingspage__save"
                  onClick={() => {
                    setEditing(plugin);
                    setFormOpen(true);
                  }}
                >
                  编辑
                </button>
                <button type="button" className="settingspage__save" onClick={() => void toggle(plugin)}>
                  {plugin.enabled ? '停用' : '启用'}
                </button>
                <button type="button" className="settingspage__save" onClick={() => void removePlugin(plugin.id)}>
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

/** 安装 / 编辑表单：名称 + 入口文件（系统文件选择器，单选）。 */
function PluginForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: UserPluginDto | null;
  onCancel(): void;
  onSubmit(input: UserPluginUpsertDto): void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [entryPath, setEntryPath] = useState(initial?.entryPath ?? '');
  const [picking, setPicking] = useState(false);

  const pick = async (): Promise<void> => {
    setPicking(true);
    try {
      const result = await requireBridge().app.pickFiles();
      if (!result.canceled && result.paths.length > 0) {
        const file = result.paths[0] ?? '';
        setEntryPath(file);
        if (name.trim().length === 0) {
          const parts = file.split(/[\\/]/).filter(Boolean);
          // 入口通常是 <插件名>/lib/index.js：取倒数第三段作名称兜底。
          setName(parts[parts.length - 3] ?? parts[0] ?? '');
        }
      }
    } catch (error) {
      console.error('选择插件入口失败', error);
    } finally {
      setPicking(false);
    }
  };

  const canSubmit = entryPath.trim().length > 0 && !picking;

  return (
    <div className="settings-row settings-row--stack automation-form">
      <div className="settings-row__main">
        <div className="settings-row__title">{initial === null ? '安装插件' : `编辑：${initial.name}`}</div>
        <div className="settings-row__inline">
          <input
            type="text"
            className="settingspage__input"
            placeholder="插件名称（展示用）"
            value={name}
            spellCheck={false}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="settings-row__inline">
          <input
            type="text"
            className="settingspage__input"
            placeholder="插件入口文件（lib/index.js）"
            value={entryPath}
            spellCheck={false}
            onChange={(event) => setEntryPath(event.target.value)}
          />
          <button
            type="button"
            className="settingspage__save"
            disabled={picking}
            onClick={() => void pick()}
          >
            {picking ? '选择中…' : '浏览…'}
          </button>
        </div>
      </div>
      <div className="settings-row__control">
        <button type="button" className="settingspage__save" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="settingspage__save settingspage__save--primary"
          disabled={!canSubmit}
          onClick={() =>
            onSubmit({
              ...(initial !== null ? { id: initial.id } : {}),
              name,
              entryPath: entryPath.trim(),
            })
          }
        >
          保存
        </button>
      </div>
    </div>
  );
}
