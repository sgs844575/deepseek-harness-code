import { appApi } from './api.js';

/** 职责：把应用信息渲染到指定元素上。 */
export async function showAppVersion(element: HTMLElement | null): Promise<void> {
  if (!element) return;
  try {
    element.textContent = await appApi.getVersion();
  } catch (err) {
    element.textContent = 'unavailable';
    console.error('获取应用版本失败:', err);
  }
}
