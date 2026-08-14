/**
 * forge vite 插件注入的编译期常量（见 vite.renderer.config.ts 的 renderer name: 'main'）。
 * 开发模式下 MAIN_VITE_DEV_SERVER_URL 是 vite dev server 地址；生产构建时为 undefined。
 */
declare const MAIN_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_VITE_NAME: string;
