import { defineConfig } from 'vite';

/**
 * 主进程构建：ESM 单文件产物 .vite/build/index.mjs。
 * Electron ≥28 支持以 .mjs 入口加载 ESM 主进程；
 * preload 保持 CJS，因此 package.json 不能加 "type": "module"。
 * 显式 external 三类模块：electron、node 内置（node: 前缀）与运行时依赖
 * （如 yaml——其 CJS 互操作层会调用 require('process')，打进 ESM bundle
 * 会在启动期崩溃，外部化后运行时直接从 node_modules 解析）。
 */
export default defineConfig({
  build: {
    lib: {
      entry: 'src/main/index.ts',
      formats: ['es'],
      fileName: () => 'index.mjs',
    },
    rollupOptions: {
      // 数组形式：forge dev 的 rolldown watch 不接受函数式 external。
      external: ['electron', 'yaml', /^node:/, /^electron\//],
    },
  },
});
