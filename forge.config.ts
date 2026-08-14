import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import VitePlugin from '@electron-forge/plugin-vite';

/**
 * Electron Forge 配置：vite 插件负责主进程 / preload / 渲染层三路构建。
 * 主进程产物为 ESM（.vite/build/index.mjs），preload 保持 CJS（sandbox 要求）。
 */
const config: ForgeConfig = {
  packagerConfig: {
    // 不用 asar：harness 树与 config/harness 以真实目录随包分发（见
    // scripts/build-release.mjs），运行时 paths.ts 以 app.getAppPath() 为根
    // 做路径拼接，asar 内的目录对 file:// 动态加载与 pnpm node_modules 均不可行。
    asar: false,
  },
  rebuildConfig: {},
  makers: [new MakerZIP()],
  plugins: [
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
