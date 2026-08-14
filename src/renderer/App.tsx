import { Titlebar } from './components/Titlebar';
import { Workspace } from './components/Workspace';
import { StatusBar } from './components/StatusBar';
import { SettingsView, type SettingsSectionId } from './components/SettingsView';
import { useCallback, useEffect, useState } from 'react';

/**
 * 应用根组件：整体布局为「标题栏 + 对话工作台 + 状态栏」。
 * 设置为全页视图（非弹窗），从侧栏账户菜单 / Ctrl+, 进入，覆盖工作区展示；
 * 打开时可指定定位分区（如账户菜单「API Key」→ 模型与凭据）。
 */
export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('general');

  const openSettings = useCallback((section: SettingsSectionId = 'general') => {
    setSettingsSection(section);
    setSettingsOpen(true);
  }, []);

  // 全局 Ctrl+, 打开/关闭设置（与账户菜单「设置」行展示的快捷键一致）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key === ',') {
        event.preventDefault();
        setSettingsOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="app">
      <Titlebar />
      <main className="app__content">
        <Workspace onOpenSettings={openSettings} />
        {settingsOpen && (
          <SettingsView
            initialSection={settingsSection}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </main>
      <StatusBar />
    </div>
  );
}
