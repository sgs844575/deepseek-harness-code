import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { loadAppSettingsFile } from '../settings/app-settings-store.js';
import { appSettingsFilePath, resolveAppHome } from '../paths/app-paths.js';

/**
 * harness 相关路径的唯一事实来源。
 * dev：app.getAppPath() 即项目根，config/harness 与 deepseek-harness 都在其下。
 * 打包态：UI 进 app.asar（appRoot 指向 asar 内部），cordis.yml 与 harness 树
 * 由 build-release.mjs 以真实目录放在 resources/ 下（运行时动态 import 的
 * 模块不进 asar），故以 process.resourcesPath 为基准根。
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
  const packaged = app.isPackaged;
  const base = packaged ? process.resourcesPath : appRoot;
  const harnessRootFromEnv = process.env.DSH_HARNESS_ROOT;
  return {
    harnessRoot: harnessRootFromEnv && harnessRootFromEnv.length > 0
      ? path.resolve(harnessRootFromEnv)
      : path.join(base, 'deepseek-harness'),
    configPath: path.join(base, 'config', 'harness', 'cordis.yml'),
    dshHome: resolveDshHome(),
    // 打包态 appRoot 在 asar 内部，不能作默认工作区（dev 保持项目根）。
    workspace: process.env.DSH_CWD && process.env.DSH_CWD.length > 0
      ? path.resolve(process.env.DSH_CWD)
      : packaged
        ? os.homedir()
        : appRoot,
  };
}
