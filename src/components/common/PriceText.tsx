import { useWineStore } from '@/store/useWineStore';
import { formatCompactKrw, formatKrw } from '@/services/domain/wineHelpers';

interface PriceTextProps {
  value: number;
  prefix?: string;
  compact?: boolean;
  className?: string;
}

export function PriceText({ value, prefix = '', compact = false, className = '' }: PriceTextProps) {
  const isPrivacyMode = useWineStore((s) => s.isPrivacyMode);

  if (isPrivacyMode) {
    return (
      <span className={`tabular-nums tracking-tight ${className}`} aria-label="금액 숨김">
        {prefix}••••원
      </span>
    );
  }

  return (
    <span className={`tabular-nums ${className}`}>
      {prefix}
      {compact ? formatCompactKrw(value) : formatKrw(value)}
    </span>
  );
}

interface FxNoteTextProps {
  note?: string;
  className?: string;
}

/**
 * M2 보강: 직구 외화 가격 메모(예: '9715엔', '45유로')도 프라이버시 모드 시 마스킹
 */
export function FxNoteText({ note, className = '' }: FxNoteTextProps) {
  const isPrivacyMode = useWineStore((s) => s.isPrivacyMode);
  if (!note) return null;
  return (
    <span className={`tabular-nums ${className}`}>
      {isPrivacyMode ? '••••(외화)' : note}
    </span>
  );
}

interface MemoTextProps {
  text?: string;
  className?: string;
}

/**
 * 프라이버시 모드(안 A) 보강: 비고 원문에 포함된 단가·외화 텍스트 유출을
 * 100% 차단하기 위해 프라이버시 ON 시 메모 전체를 마스킹
 */
export function MemoText({ text, className = '' }: MemoTextProps) {
  const isPrivacyMode = useWineStore((s) => s.isPrivacyMode);
  if (!text) return null;
  return (
    <span className={className} aria-label={isPrivacyMode ? '메모 숨김' : undefined}>
      {isPrivacyMode ? '•••• (메모 숨김)' : text}
    </span>
  );
}
