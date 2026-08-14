import { useEffect, useState } from 'react';
import { requireBridge } from '../ipc/api';
import { resolvedTheme, updateAppearance, useAppearance } from '../state/appearance';
import { LogoMark } from './Logo';

/**
 * 自定义标题栏（无边框窗口）：左侧应用标题，右侧功能按钮（主题切换）
 * + Windows 风格窗口控制（— 最小化 / □ 最大化-还原 / × 关闭，关闭悬停红色）。
 * 拖拽移动 + 双击最大化；全部走 window.api 的白名单方法。
 * 设置入口在会话侧栏右下角（全页设置视图），标题栏不再重复放置。
 */
export function Titlebar() {
  const [version, setVersion] = useState<string>('');
  const [maximized, setMaximized] = useState(false);
  const { appearance } = useAppearance();

  useEffect(() => {
    const bridge = requireBridge();
    void bridge.app.getVersion().then(setVersion).catch(() => setVersion('未知版本'));
    void bridge.window.isMaximized().then(setMaximized).catch(() => setMaximized(false));
    return bridge.window.onMaximizeChanged(setMaximized);
  }, []);

  const dark = resolvedTheme(appearance.theme) === 'dark';
  const toggleTheme = (): void => {
    updateAppearance({ theme: dark ? 'light' : 'dark' });
  };

  return (
    <header className="titlebar" onDoubleClick={() => void requireBridge().window.toggleMaximize()}>
      <span className="titlebar__title">
        <LogoMark size={17} className="titlebar__logo" />
        <span className="titlebar__title-text">
          DeepSeek Harness Code{version ? ` · v${version}` : ''}
        </span>
      </span>
      <div className="titlebar__actions">
        <button
          type="button"
          title={dark ? '切换浅色主题' : '切换深色主题'}
          className="titlebar__icon-btn"
          onClick={toggleTheme}
        >
          {dark ? <MoonIcon /> : <SunIcon />}
        </button>
      </div>
      <div className="titlebar__caption">
        <button
          type="button"
          title="最小化"
          className="titlebar__caption-btn"
          onClick={() => void requireBridge().window.minimize()}
        >
          <MinimizeIcon />
        </button>
        <button
          type="button"
          title={maximized ? '还原' : '最大化'}
          className="titlebar__caption-btn"
          onClick={() => void requireBridge().window.toggleMaximize()}
        >
          {maximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button
          type="button"
          title="关闭"
          className="titlebar__caption-btn titlebar__caption-btn--close"
          onClick={() => void requireBridge().window.close()}
        >
          <CloseIcon />
        </button>
      </div>
    </header>
  );
}

/* ---- Windows 窗口控制图标（细线，非 Segoe 字形，避免 PUA 字符丢失问题） ---- */

function MinimizeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="3.7" y="3.7" width="8.6" height="8.6" rx="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/** 还原：两层叠加方框 */
function RestoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2.9" y="5.7" width="7.4" height="7.4" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M5.7 2.9h6a1.4 1.4 0 0 1 1.4 1.4v6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ---- 功能按钮图标 ---- */

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 2.5V5m0 14v2.5M2.5 12H5m14 0h2.5M5.3 5.3l1.7 1.7m10 10 1.7 1.7m0-13.4-1.7 1.7m-10 10-1.7 1.7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20.6 14.4A8.7 8.7 0 0 1 9.6 3.4a8.7 8.7 0 1 0 11 11Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
