import { useEffect, useState } from 'react';
import type { HostStateDto } from '../../shared/protocol.js';
import { requireBridge } from '../ipc/api';

/**
 * 底部状态栏：harness 宿主状态指示灯 + 工作区路径。
 * 状态来源：初始 invoke host.getStatus + 订阅 host:status-changed 推送。
 */
export function StatusBar() {
  const [host, setHost] = useState<HostStateDto | null>(null);

  useEffect(() => {
    const bridge = requireBridge();
    void bridge.host.getStatus().then(setHost);
    const unsubscribe = bridge.host.onStatus(setHost);
    return unsubscribe;
  }, []);

  return (
    <footer className="statusbar">
      <span className={`statusbar__dot statusbar__dot--${host?.status ?? 'booting'}`} />
      <span className="statusbar__text">
        {host === null
          ? '连接中…'
          : host.status === 'booting'
            ? 'harness 启动中…'
            : host.status === 'ready'
              ? 'harness 就绪'
              : `harness 启动失败：${host.error ?? '未知错误'}`}
      </span>
      <span className="statusbar__spacer" />
      {host && (
        <span className="statusbar__workspace" title={host.workspace}>
          工作区 {host.workspace}
        </span>
      )}
    </footer>
  );
}
