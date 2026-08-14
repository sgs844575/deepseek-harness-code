import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type UserConfig } from 'vite';

/**
 * 渲染层构建。CSP 通过 @@CSP@@ 占位符注入：
 * 生产保持严格策略；开发模式放宽 inline script / HMR websocket 所需指令
 * （@vitejs/plugin-react 的 refresh 前置脚本与 vite HMR 都需要）。
 */
const PROD_CSP = "default-src 'self'; style-src 'self'";
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' ws: http://localhost:* http://127.0.0.1:*",
  "font-src 'self' data:",
].join('; ');

function cspInjector(command: 'serve' | 'build'): Plugin {
  const policy = command === 'serve' ? DEV_CSP : PROD_CSP;
  return {
    name: 'inject-csp',
    transformIndexHtml: (html) => html.replaceAll('@@CSP@@', policy),
  };
}

export default defineConfig(({ command }): UserConfig => ({
  plugins: [react(), cspInjector(command)],
}));
