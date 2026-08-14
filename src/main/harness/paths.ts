import path from 'node:path';
import { app } from 'electron';
import { loadAppSettingsFile } from '../settings/app-settings-store.js';
import { appSettingsFilePath, resolveAppHome } from '../paths/app-paths.js';

/**
 * harness 相关路径的唯一事实来源。
 * 开发期 app.getAppPath() 即项目根；打包分发形态在二期处理。
 */
export interface HarnessPaths {
  /** deepseek-harness 仓库根（boot 模块与全部插件产物所在）。 */
  harnessRoot: string;
  /** 我们的 agent 组合配置（boot 的配置入口，插件相对路径基于此目录）。 */
  configPath: string;
  /** harness 数据主目录（settings.yaml / .credentials.yaml / sessions/）。 */
  dshHome: string;
  /** 一期工作区：默认项目根，可用 DSH_CWD 环境变量覆盖（后续提供 UI 选择）。 */
  workspace: string;
}

/** 数据根覆盖（应用设置 dataPath）进程内缓存：只随重启变化。 */
let dshHomeCache: string | undefined;

function resolveDshHome(): string {
  if (dshHomeCache !== undefined) return dshHomeCache;
  const settings = loadAppSettingsFile(appSettingsFilePath());
  dshHomeCache =
    settings.dataPath.length > 0
      ? path.join(settings.dataPath, 'dsh-home')
      : path.join(resolveAppHome(), 'dsh-home');
  return dshHomeCache;
}

export function resolveHarnessPaths(): HarnessPaths {
  const appRoot = app.getAppPath();
  const harnessRootFromEnv = process.env.DSH_HARNESS_ROOT;
  return {
    harnessRoot: harnessRootFromEnv && harnessRootFromEnv.length > 0
      ? path.resolve(harnessRootFromEnv)
      : path.join(appRoot, 'deepseek-harness'),
    configPath: path.join(appRoot, 'config', 'harness', 'cordis.yml'),
    dshHome: resolveDshHome(),
    workspace: process.env.DSH_CWD && process.env.DSH_CWD.length > 0
      ? path.resolve(process.env.DSH_CWD)
      : appRoot,
  };
}
