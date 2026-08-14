import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initAppearance } from './state/appearance';
import { initAppSettings } from './state/appSettings';
import { initProviders } from './state/providers';
import './styles/main.css';

// 主题/字体在首帧渲染前应用到 <html>，避免默认主题闪变。
initAppearance();
// 应用设置（主进程真值）异步拉取，加载完成前先渲染与主进程一致的默认值。
initAppSettings();
// 供应商配置（多供应商 / 多 key）同样异步拉取 + 推送同步。
initProviders();

const container = document.getElementById('root');
if (!container) throw new Error('找不到 #root 挂载点');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
