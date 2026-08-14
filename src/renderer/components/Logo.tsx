import { useId } from 'react';

export interface LogoMarkProps {
  size?: number;
  /** 加载动画：火花沿环公转、尖括号呼吸。 */
  animated?: boolean;
  className?: string;
}

/**
 * 应用 Logo：圆角方形渐变底（应用图标轮廓）+ 白色圆环（harness“缰绳”轨道）
 * + 代码尖括号 〈 〉（被 harness 牵引的编码 agent）+ 轨道上的火花节点。
 * 静态用于标题栏等处；animated=true 时火花公转、括号呼吸（启动加载动画）。
 */
export function LogoMark({ size = 128, animated = false, className = '' }: LogoMarkProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const bgId = `logo-bg-${uid}`;
  const glowId = `logo-glow-${uid}`;
  const sparkId = `logo-spark-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      role="img"
      aria-label="DeepSeek Harness Code"
      className={`logo${animated ? ' logo--animated' : ''}${className ? ` ${className}` : ''}`}
    >
      <defs>
        <linearGradient id={bgId} x1="12" y1="8" x2="116" y2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4d7cff" />
          <stop offset="0.55" stopColor="#0a84ff" />
          <stop offset="1" stopColor="#0b49c8" />
        </linearGradient>
        <radialGradient id={glowId} cx="0.3" cy="0.22" r="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.30" />
          <stop offset="0.65" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={sparkId} x1="56" y1="22" x2="72" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#b8ecff" />
          <stop offset="1" stopColor="#4facfe" />
        </linearGradient>
      </defs>

      {/* 图标底：squircle + 顶部高光 */}
      <rect x="4" y="4" width="120" height="120" rx="30" fill={`url(#${bgId})`} />
      <rect x="4" y="4" width="120" height="120" rx="30" fill={`url(#${glowId})`} />
      <rect
        x="4.75"
        y="4.75"
        width="118.5"
        height="118.5"
        rx="29.25"
        stroke="#ffffff"
        strokeOpacity="0.25"
        strokeWidth="1.5"
      />

      {/* harness 轨道环 */}
      <circle
        cx="64"
        cy="64"
        r="34"
        stroke="#ffffff"
        strokeOpacity="0.88"
        strokeWidth="6"
        strokeLinecap="round"
      />

      {/* 代码尖括号 〈 〉（被牵引的编码能力） */}
      <g className="logo__chevrons" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M56 51 44 64l12 13" />
        <path d="M72 51l12 13-12 13" />
      </g>

      {/* 火花节点：静态位于右上 45°，动画时沿环公转 */}
      <g
        className="logo__orbit"
        transform={animated ? undefined : 'rotate(45 64 64)'}
      >
        <circle cx="64" cy="30" r="11" fill="#4facfe" fillOpacity="0.35" />
        <circle cx="64" cy="30" r="7.5" fill={`url(#${sparkId})`} stroke="#ffffff" strokeWidth="2" />
      </g>
    </svg>
  );
}
