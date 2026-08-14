import type { HostStateDto } from '../../shared/protocol.js';
import { LogoMark } from './Logo';

export interface SplashProps {
  /** null = 尚未收到任何状态（连接中）；booting/error 显示对应文案。 */
  host: HostStateDto | null;
}

/**
 * harness 启动等待页：Logo 加载动画（火花沿轨道环公转、尖括号呼吸）
 * + 状态文案 + 不定式进度条；启动失败时切换为错误态。
 */
export function Splash({ host }: SplashProps) {
  const failed = host?.status === 'error';

  return (
    <div className={`splash${failed ? ' splash--error' : ''}`}>
      <LogoMark size={96} animated />
      <div className="splash__name">DeepSeek Harness Code</div>
      <div className="splash__status" aria-live="polite">
        {failed ? 'harness 启动失败' : host === null ? '正在连接 harness' : '正在启动 harness'}
        {!failed && (
          <span className="splash__dots" aria-hidden>
            <span />
            <span />
            <span />
          </span>
        )}
      </div>
      {failed && host?.error !== undefined && (
        <div className="splash__error" title={host.error}>
          {host.error}
        </div>
      )}
      <div className="splash__bar" aria-hidden />
    </div>
  );
}
