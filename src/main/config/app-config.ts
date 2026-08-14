import path from 'node:path';

/**
 * 应用级配置常量：集中管理，避免魔法数字散落各模块。
 * 只放静态配置，不放运行时状态。
 */
export const appConfig = {
  productName: 'DeepSeek Harness Code',

  mainWindow: {
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
  },

  rendererEntry: path.join(__dirname, '..', '..', 'renderer', 'index.html'),
} as const;
