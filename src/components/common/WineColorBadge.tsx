import { WINE_COLOR_LABELS, type WineColor } from '@/types/schema';

const COLOR_CSS_VAR: Record<WineColor, string> = {
  R: 'var(--wine-r)',
  W: 'var(--wine-w)',
  SP: 'var(--wine-sp)',
  SW: 'var(--wine-sw)',
  RO: 'var(--wine-ro)',
};

export function getWineColorCssVar(color: WineColor): string {
  return COLOR_CSS_VAR[color];
}

export function getWineColorFgCssVar(color: WineColor): string {
  return color === 'W' ? 'var(--wine-w-fg)' : '#ffffff';
}

export function getWineColorBorderCssVar(color: WineColor): string | undefined {
  return color === 'W' ? 'var(--wine-w-border)' : undefined;
}

interface WineColorBadgeProps {
  color: WineColor;
  showLabel?: boolean;
  size?: 'sm' | 'md';
}

export function WineColorBadge({ color, showLabel = false, size = 'sm' }: WineColorBadgeProps) {
  const bg = COLOR_CSS_VAR[color];
  const fg = getWineColorFgCssVar(color);
  const border = getWineColorBorderCssVar(color);
  const sizeClass = size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold leading-none shadow-sm ${
        border ? 'border' : ''
      } ${sizeClass}`}
      style={{
        backgroundColor: bg,
        color: fg,
        borderColor: border,
      }}
      title={WINE_COLOR_LABELS[color]}
    >
      <span className="tabular-nums">{color}</span>
      {showLabel && <span className="font-medium opacity-95">{WINE_COLOR_LABELS[color]}</span>}
    </span>
  );
}
