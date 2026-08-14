import { defineConfig } from 'vite';

/**
 * preload 构建：沿用 forge vite 插件默认（CJS、.vite/build/index.js）。
 * sandbox: true 的 preload 只能是普通 CJS 脚本，不能是 ESM。
 */
export default defineConfig({});
