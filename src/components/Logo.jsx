import React from 'react';

// 灵犀TV 品牌 LOGO：渐变圆角屏 + 播放三角（视频创作）+ 四芒星（灵感/灵犀）+ 底部信号弧
// 渐变与 tokens.css 的 --grad-brand（#7c8cff → #a855f7）保持一致
export default function Logo({ size = 30, className, style }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      style={style}
      role="img"
      aria-label="灵犀TV"
    >
      <defs>
        <linearGradient id="ltv-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c8cff" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      {/* 渐变圆角屏 */}
      <rect x="3" y="3" width="42" height="42" rx="13" fill="url(#ltv-g)" />
      {/* 顶部高光 */}
      <ellipse cx="15.5" cy="12.5" rx="10" ry="5.5" fill="#fff" opacity=".16" transform="rotate(-22 15.5 12.5)" />
      {/* 播放三角（视频） */}
      <path d="M18.5 16.8 L30.5 24 L18.5 31.2 Z" fill="#fff" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      {/* 四芒星（灵感 / 灵犀一点光） */}
      <path
        d="M34.6 9.4 l1.9 4.6 4.6 1.9 -4.6 1.9 -1.9 4.6 -1.9 -4.6 -4.6 -1.9 4.6 -1.9 Z"
        fill="#fff"
      />
      {/* 底部信号弧 */}
      <path
        d="M13.5 35.5 Q24 41.5 34.5 35.5"
        stroke="#fff"
        strokeOpacity=".85"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
