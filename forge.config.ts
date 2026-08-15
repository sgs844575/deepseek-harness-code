import fs from 'node:fs';
import path from 'node:path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import AutoUnpackNatives from '@electron-forge/plugin-auto-unpack-natives';
import VitePlugin from '@electron-forge/plugin-vite';

/**
 * 打包期 harness 树暂出（OOM 根因修复）：
 * vendored deepseek-harness/（pnpm 工作区 + node_modules，几十万文件）留在
 * 仓库内供 dev 与 clone 即用，但绝不能进入 forge 打包输入——packager 对它的
 * 遍历/复制才是打包 OOM 的来源（asar 与否、ignore 与否都躲不掉）。prePackage
 * 把整棵树同卷 rename 到仓库外暂存（瞬时），postPackage 移回；generateAssets
 * 在 start/package 之前自愈（上次打包中断的残留先归位）。
 */
const repoRoot = process.cwd();
const harnessDir = path.join(repoRoot, 'deepseek-harness');
const harnessStash = path.resolve(repoRoot, '..', 'deepseek-harness.pack-stash');

async function stashHarnessTree(): Promise<void> {
  const inRepo = fs.existsSync(harnessDir);
  const stashed = fs.existsSync(harnessStash);
  if (inRepo && stashed) {
    throw new Error(
      `打包前状态异常：${harnessStash} 与仓库内 deepseek-harness/ 同时存在` +
        '（上次打包中断的残留？）。请手动确认后删除暂存目录再重试。',
    );
  }
  if (!inRepo) return; // 已处于暂存态（上次打包中断），保持现状即可
  fs.renameSync(harnessDir, harnessStash);
  console.info(`[hooks] deepseek-harness/ 已暂出打包管线 → ${harnessStash}`);
}

async function restoreHarnessTree(): Promise<void> {
  if (!fs.existsSync(harnessStash)) return;
  if (fs.existsSync(harnessDir)) return; // 仓库内已有（不应发生），保守不动
  fs.renameSync(harnessStash, harnessDir);
  console.info('[hooks] deepseek-harness/ 已移回仓库');
}

/**
 * Electron Forge 配置：vite 插件负责主进程 / preload / 渲染层三路构建。
 * 主进程产物为 ESM（.vite/build/index.mjs），preload 保持 CJS（sandbox 要求）。
 */
const config: ForgeConfig = {
  packagerConfig: {
    // 经典 asar 形态：只有 UI（三路构建产物 + 运行时 node_modules）进 app.asar。
    // cordis.yml 与 harness 树不进 asar，打包后以真实目录住在 resources/ 下
    // （config/harness 与 deepseek-harness，由 scripts/build-release.mjs 拷入）：
    // 运行时动态 import 的模块（boot / 官方插件 / seam）要求真实文件系统，
    // 运行时路径见 src/main/harness/paths.ts。
    // 注意：不要自定义 packagerConfig.ignore——一旦设置会禁用 vite 插件自带的
    // ignore / node_modules 裁剪（实测 asar 从 2MB 膨胀到 418MB）。
    asar: true,
  },
  rebuildConfig: {},
  makers: [new MakerZIP()],
  hooks: {
    generateAssets: restoreHarnessTree,
    prePackage: stashHarnessTree,
    postPackage: restoreHarnessTree,
  },
  plugins: [
    // asar 内的原生模块自动改判 asarUnpack（.node 二进制无法从 asar 加载）。
    new AutoUnpackNatives({}),
    new VitePlugin({
      // main: 自定义 lib 输出 ESM；preload: 插件默认 CJS。
      build: [
        { entry: 'src/main/index.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/preload/index.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [{ name: 'main', config: 'vite.renderer.config.ts' }],
    }),
  ],
};

export default config;
