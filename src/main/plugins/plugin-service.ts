import { readFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  HostStateDto,
  PluginSnapshotDto,
  UserPluginDto,
  UserPluginUpsertDto,
} from '../../shared/protocol.js';
import { resolveHarnessPaths } from '../harness/paths.js';
import type { HarnessService } from '../harness/harness-service.js';
import type { SettingsService } from '../settings/settings-service.js';

/**
 * 插件服务：设置页「插件」分区的数据面——
 * - 内置插件 = cordis.yml 静态组合行（只读，状态随宿主整体加载）；
 * - 自定义插件 = app-settings.plugins，boot 时经补丁注入组合行；
 *   启用/停用/删除即时落盘，「应用变更」重启引擎生效（与 MCP 同路径）。
 *
 * harness 没有逐插件的装载状态面：插件行加载失败会让整个 boot 进入
 * error 态，因此状态按宿主状态整体映射（loaded / disabled / error）。
 */
export class PluginService {
  private readonly settings: SettingsService;
  private readonly harness: HarnessService;

  constructor(options: { settings: SettingsService; harness: HarnessService }) {
    this.settings = options.settings;
    this.harness = options.harness;
  }

  /** 插件状态快照（内置 + 自定义）。 */
  snapshot(): PluginSnapshotDto {
    const hostStatus = this.harness.getState().status;
    const builtinStatus = hostStatus === 'error' ? 'error' : 'loaded';
    return {
      builtin: this.readBuiltinIds().map((id) => ({ id, status: builtinStatus })),
      user: this.settings.getSettings().plugins.map((plugin) => ({
        ...plugin,
        status: !plugin.enabled ? 'disabled' : builtinStatus,
      })),
    };
  }

  /** 新增 / 编辑自定义插件：入口文件必须存在且为 JS 模块；返回落盘后的条目。 */
  upsert(input: UserPluginUpsertDto): UserPluginDto {
    const entryPath = path.resolve(input.entryPath.trim());
    if (!/\.(js|cjs|mjs)$/i.test(entryPath)) {
      throw new Error('插件入口必须是 .js / .cjs / .mjs 文件');
    }
    try {
      if (!statSync(entryPath).isFile()) throw new Error('not-a-file');
    } catch {
      throw new Error(`插件入口文件不存在：${entryPath}`);
    }
    const name = input.name.trim().slice(0, 60) || path.basename(path.dirname(entryPath));
    const current = this.settings.getSettings().plugins;
    const existing = input.id !== undefined ? current.find((item) => item.id === input.id) : undefined;
    // 同路径覆盖（含换名）；否则新增。
    const next: UserPluginDto = {
      id: existing?.id ?? randomUUID(),
      name,
      entryPath,
      enabled: existing?.enabled ?? true,
    };
    this.settings.update({
      plugins: [
        ...current.filter(
          (item) => item.id !== next.id && item.entryPath.toLowerCase() !== entryPath.toLowerCase(),
        ),
        next,
      ],
    });
    return next;
  }

  remove(id: string): void {
    this.settings.update({
      plugins: this.settings.getSettings().plugins.filter((item) => item.id !== id),
    });
  }

  setEnabled(id: string, enabled: boolean): void {
    this.settings.update({
      plugins: this.settings.getSettings().plugins.map((item) =>
        item.id === id ? { ...item, enabled } : item,
      ),
    });
  }

  /** 应用变更：harness 停机并以新组合重启（渲染层负责提示与状态复位）。 */
  async apply(): Promise<HostStateDto> {
    return this.harness.restart();
  }

  /** cordis.yml 的静态组合行 id（注释与空行忽略；boot 补丁行不在文件里）。 */
  private readBuiltinIds(): string[] {
    try {
      const content = readFileSync(resolveHarnessPaths().configPath, 'utf8');
      const ids: string[] = [];
      for (const line of content.split(/\r?\n/)) {
        if (/^\s*#/.test(line)) continue;
        const match = /^\s*-\s*id:\s*([\w-]+)/.exec(line);
        if (match !== null) ids.push(match[1] ?? '');
      }
      return ids.filter((id) => id.length > 0);
    } catch {
      return [];
    }
  }
}
