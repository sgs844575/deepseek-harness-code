/**
 * 应用级配置常量：集中管理，避免魔法数字散落各模块。
 * 只放静态配置，不放运行时状态。
 * 路径类常量已移至使用处（vite 产物布局见 main-window.ts）。
 */
export const appConfig = {
  productName: 'DeepSeek Harness Code',

  mainWindow: {
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
  },

  /** forge vite 插件 renderer 构建名（产物目录 .vite/renderer/<name>/）。 */
  rendererDir: 'main',
} as const;
