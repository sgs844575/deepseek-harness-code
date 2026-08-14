import type { ElectronBridge } from '../../shared/bridge.js';

/**
 * window.api 的防御式访问封装：preload 缺失（异常环境）时给出明确错误，
 * 渲染层其余代码只依赖这里导出的类型安全入口，不直接触碰 window。
 */
export function requireBridge(): ElectronBridge {
  const api = (window as { api?: ElectronBridge }).api;
  if (!api) {
    throw new Error('window.api 不可用：preload 脚本未正确加载');
  }
  return api;
}
