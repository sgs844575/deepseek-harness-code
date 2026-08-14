import { windowApi } from './api.js';
import { showAppVersion } from './app-info.js';
import { bindWindowControls } from './window-controls.js';

/** 渲染层入口：只做模块组装，行为分散在各自的小模块中。 */
bindWindowControls(
  {
    minimizeButton: document.getElementById('btn-minimize'),
    toggleMaximizeButton: document.getElementById('btn-toggle-maximize'),
    closeButton: document.getElementById('btn-close'),
  },
  windowApi,
);

void showAppVersion(document.getElementById('app-version'));
