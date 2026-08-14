import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { APP_SETTINGS_FILE_NAME } from '../settings/app-settings-store.js';

/**
 * 应用数据目录的唯一事实来源。
 *
 * 与其他 agent CLI（~/.claude、~/.dsh、~/.cherrystudio）保持一致：
 * 配置与缓存收敛在用户主目录 ~/.deep-seek-harness-code 下，
 * 跨平台仅依赖 os.homedir()（Windows / Linux / macOS 行为一致）。
 *
 * 目录布局：
 *   ~/.deep-seek-harness-code/
 *     app-settings.json   客户端自身设置
 *     providers.json      多供应商模型配置（含 API keys）
 *     dsh-home/           harness 数据（settings.yaml / .credentials.yaml / sessions/）
 *     cache/              缓存（可随时删除重建）
 */

/** 用户主目录下的应用根目录名。 */
export const APP_HOME_DIRNAME = '.deep-seek-harness-code';

/** 缓存子目录名（<appHome>/cache）。 */
export const CACHE_DIRNAME = 'cache';

let appHomeCache: string | undefined;

/**
 * 应用数据根目录：环境变量 DSHC_HOME 优先（测试/便携场景），否则
 * ~/.deep-seek-harness-code。进程内缓存，并确保目录存在。
 */
export function resolveAppHome(): string {
  if (appHomeCache !== undefined) return appHomeCache;
  const fromEnv = process.env.DSHC_HOME;
  appHomeCache =
    fromEnv !== undefined && fromEnv.length > 0
      ? path.resolve(fromEnv)
      : path.join(os.homedir(), APP_HOME_DIRNAME);
  mkdirSync(appHomeCache, { recursive: true });
  return appHomeCache;
}

/** 缓存目录（<appHome>/cache），确保存在。 */
export function resolveCacheDir(): string {
  const dir = path.join(resolveAppHome(), CACHE_DIRNAME);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 客户端设置文件路径（<appHome>/app-settings.json）。 */
export function appSettingsFilePath(): string {
  return path.join(resolveAppHome(), APP_SETTINGS_FILE_NAME);
}

/** 供应商配置文件路径（<appHome>/providers.json）。 */
export function providersFilePath(): string {
  return path.join(resolveAppHome(), 'providers.json');
}

/**
 * 一次性迁移旧布局（Electron userData 下的 app-settings.json 与 dsh-home）
 * 到 ~/.deep-seek-harness-code。幂等：新位置已存在对应项时跳过；
 * 跨盘 rename 失败时退化为复制（复制成功后不删除旧目录，保留为备份）。
 */
export function migrateLegacyUserData(): void {
  const home = resolveAppHome();
  const legacyRoot = (() => {
    try {
      return app.getPath('userData');
    } catch {
      return '';
    }
  })();
  if (legacyRoot.length === 0) return;

  const legacySettings = path.join(legacyRoot, APP_SETTINGS_FILE_NAME);
  const nextSettings = path.join(home, APP_SETTINGS_FILE_NAME);
  if (!existsSync(nextSettings) && existsSync(legacySettings)) {
    try {
      renameSync(legacySettings, nextSettings);
    } catch {
      try {
        cpSync(legacySettings, nextSettings);
        // 设置文件含密钥类偏好，复制成功后即从旧位置移除。
        rmSync(legacySettings, { force: true });
      } catch (error) {
        console.error('[paths] 迁移 app-settings.json 失败：', error);
      }
    }
  }

  const legacyDshHome = path.join(legacyRoot, 'dsh-home');
  const nextDshHome = path.join(home, 'dsh-home');
  if (!existsSync(nextDshHome) && existsSync(legacyDshHome)) {
    try {
      renameSync(legacyDshHome, nextDshHome);
    } catch {
      try {
        cpSync(legacyDshHome, nextDshHome, { recursive: true });
        console.info(`[paths] dsh-home 已复制到 ${nextDshHome}（旧目录保留在 userData 下作备份）`);
      } catch (error) {
        console.error('[paths] 迁移 dsh-home 失败：', error);
      }
    }
  }
}
