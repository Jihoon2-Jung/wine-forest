import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  Eye,
  FileText,
  Info,
  Link2,
  Share2,
  ShieldAlert,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BottomSheet } from '@/components/common/BottomSheet';
import type { WineGroupItem } from '@/components/wines/WineGroupCard';
import {
  canUseNativeShareSheet,
  copyTextToClipboard,
  shareTextOrUrl,
} from '@/services/native/nativeBridge';
import {
  buildSharedWinePayload,
  buildShareUrl,
  DEFAULT_SHARE_PRIVACY_OPTIONS,
  encodeSharedPayload,
  evaluateShareUrlLength,
  formatSharedListAsText,
  type SharePrivacyOptions,
  type ShareSoftExpiryOption,
} from '@/services/share/shareCodec';
import { useWineStore } from '@/store/useWineStore';

interface ShareListModalProps {
  open: boolean;
  onClose: () => void;
  groups: WineGroupItem[];
  filterSummary?: string;
}

const EXPIRY_OPTIONS: Array<{ value: ShareSoftExpiryOption; label: string }> = [
  { value: 'none', label: '제한 없음' },
  { value: '7d', label: '7일' },
  { value: '30d', label: '30일' },
];

export function ShareListModal({
  open,
  onClose,
  groups,
  filterSummary,
}: ShareListModalProps) {
  const navigate = useNavigate();
  const isPrivacyMode = useWineStore((s) => s.isPrivacyMode);
  const showToast = useWineStore((s) => s.showToast);

  const [title, setTitle] = useState('');
  const [options, setOptions] = useState<SharePrivacyOptions>({
    ...DEFAULT_SHARE_PRIVACY_OPTIONS,
  });
  const [expiry, setExpiry] = useState<ShareSoftExpiryOption>('none');
  const [encodedToken, setEncodedToken] = useState<string>('');
  const [shareUrl, setShareUrl] = useState<string>('');
  const [isEncoding, setIsEncoding] = useState(false);
  const [copiedKind, setCopiedKind] = useState<'link' | 'text' | null>(null);

  const wasOpenRef = useRef(false);
  const openedAtRef = useRef<Date>(new Date());
  const encodeSeqRef = useRef(0);

  const totalBottles = useMemo(
    () => groups.reduce((sum, g) => sum + g.inStockBottles.length, 0),
    [groups],
  );

  // 모달이 새로 열릴 때마다 프라이버시 체크박스 4종을 반드시 OFF로 초기화
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      openedAtRef.current = new Date();
      const defaultTitle = filterSummary
        ? `${filterSummary} 와인 리스트`.slice(0, 80)
        : '내 셀러 와인 리스트';
      setTitle(defaultTitle);
      setOptions({ ...DEFAULT_SHARE_PRIVACY_OPTIONS });
      setExpiry('none');
      setCopiedKind(null);
    }
    wasOpenRef.current = open;
  }, [open, filterSummary]);

  const payload = useMemo(() => {
    if (!open) return null;
    return buildSharedWinePayload(groups, {
      title,
      filterSummary,
      options,
      expiry,
      now: openedAtRef.current,
    });
  }, [open, groups, title, filterSummary, options, expiry]);

  useEffect(() => {
    if (!open || !payload) {
      setEncodedToken('');
      setShareUrl('');
      setIsEncoding(false);
      return;
    }

    const seq = ++encodeSeqRef.current;
    setIsEncoding(true);

    void encodeSharedPayload(payload)
      .then((token) => {
        if (seq !== encodeSeqRef.current) return;
        setEncodedToken(token);
        setShareUrl(buildShareUrl(token));
      })
      .catch(() => {
        if (seq !== encodeSeqRef.current) return;
        setEncodedToken('');
        setShareUrl('');
      })
      .finally(() => {
        if (seq === encodeSeqRef.current) {
          setIsEncoding(false);
        }
      });
  }, [open, payload]);

  const lengthEval = useMemo(
    () => (shareUrl ? evaluateShareUrlLength(shareUrl) : null),
    [shareUrl],
  );

  const supportsNativeShare = useMemo(() => canUseNativeShareSheet(), []);

  const toggleOption = (key: keyof SharePrivacyOptions) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
    setCopiedKind(null);
  };

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    const ok = await copyTextToClipboard(shareUrl);
    if (!ok) {
      showToast('링크 복사에 실패했습니다. 브라우저 권한을 확인해 주세요.', 'error');
      return;
    }
    setCopiedKind('link');
    if (lengthEval && lengthEval.level !== 'safe') {
      showToast(
        '공유 링크를 복사했습니다. (길이가 길어 일부 메신저에서 잘릴 수 있습니다)',
        'warning',
      );
    } else {
      showToast('공유 링크를 복사했습니다.', 'success');
    }
  };

  const handleNativeShare = async () => {
    if (!shareUrl || !payload) return;
    try {
      const res = await shareTextOrUrl({
        title: payload.title,
        text: `${payload.title} (${payload.items.length}종 · ${totalBottles}병)`,
        url: shareUrl,
      });
      if (res === 'shared') {
        showToast('공유 시트를 열었습니다.', 'success');
      } else if (res === 'copied') {
        setCopiedKind('link');
        showToast('공유 링크를 복사했습니다.', 'success');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '공유 실행에 실패했습니다.';
      showToast(msg, 'error');
    }
  };

  const handleCopyText = async () => {
    if (!payload) return;
    const text = formatSharedListAsText(payload);
    const ok = await copyTextToClipboard(text);
    if (!ok) {
      showToast('텍스트 복사에 실패했습니다. 브라우저 권한을 확인해 주세요.', 'error');
      return;
    }
    setCopiedKind('text');
    showToast('메신저용 와인 텍스트 목록을 복사했습니다.', 'success');
  };

  const handlePreview = () => {
    if (!encodedToken) return;
    // BottomSheet의 body overflow 잠금을 먼저 해제한 뒤 공유 경로로 이동
    onClose();
    navigate(`/share?d=${encodeURIComponent(encodedToken)}`);
  };

  const lengthStyle =
    lengthEval?.level === 'safe'
      ? 'border-status-ok/35 bg-status-ok/10 text-status-ok'
      : lengthEval?.level === 'warning'
        ? 'border-status-warn/40 bg-status-warn/10 text-status-warn'
        : 'border-status-danger/35 bg-status-danger/10 text-status-danger';

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="와인 리스트 공유"
      subtitle={`현재 표시 중 ${groups.length}종 · ${totalBottles}병 스냅샷`}
      maxWidthClass="md:max-w-lg"
      footer={
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isEncoding || !shareUrl}
              onClick={() => void handleCopyLink()}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-forest px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-forest-hover disabled:opacity-50"
            >
              {copiedKind === 'link' ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
              <span>{copiedKind === 'link' ? '링크 복사됨' : '링크 복사'}</span>
            </button>

            {supportsNativeShare && (
              <button
                type="button"
                disabled={isEncoding || !shareUrl}
                onClick={() => void handleNativeShare()}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-forest/35 bg-forest/10 px-3.5 py-2.5 text-sm font-bold text-forest transition-colors hover:bg-forest/20 disabled:opacity-50"
              >
                <Share2 className="h-4 w-4" />
                <span>공유하기</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!payload}
              onClick={() => void handleCopyText()}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-subtle bg-elevated px-3.5 py-2 text-xs font-bold text-primary transition-colors hover:bg-surface disabled:opacity-50"
            >
              {copiedKind === 'text' ? (
                <Check className="h-3.5 w-3.5 text-status-ok" />
              ) : (
                <FileText className="h-3.5 w-3.5 text-secondary" />
              )}
              <span>{copiedKind === 'text' ? '텍스트 복사됨' : '텍스트 목록 복사'}</span>
            </button>

            <button
              type="button"
              disabled={isEncoding || !encodedToken}
              onClick={handlePreview}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-subtle bg-surface px-3.5 py-2 text-xs font-bold text-secondary transition-colors hover:border-forest/40 hover:text-primary disabled:opacity-50"
            >
              <Eye className="h-3.5 w-3.5" />
              <span>미리보기</span>
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* 무서버 스냅샷 및 비회수 고지 */}
        <div className="flex items-start gap-2.5 rounded-2xl border border-subtle bg-elevated/80 p-3 text-xs leading-relaxed text-secondary">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-forest" />
          <p>
            현재 목록을 압축해 링크 주소에 직접 담는 <strong className="text-primary">무서버 스냅샷</strong>입니다.
            원격 서버에 저장되지 않으므로 한 번 전달한 링크는 원격으로 회수·삭제할 수 없습니다.
          </p>
        </div>

        {/* 제목 & 필터 요약 */}
        <div className="space-y-1.5">
          <label htmlFor="share-list-title" className="block text-xs font-bold text-primary">
            공유 제목
          </label>
          <input
            id="share-list-title"
            type="text"
            maxLength={80}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 부르고뉴 레드 추천 리스트"
            className="w-full rounded-xl border border-subtle bg-elevated px-3.5 py-2.5 text-sm text-primary focus:border-forest focus:outline-none"
          />
          {filterSummary && (
            <p className="text-[11px] text-secondary">
              적용 필터: <span className="font-semibold text-primary">{filterSummary}</span>
            </p>
          )}
        </div>

        {/* 프라이버시 체크박스 4종 (기본 OFF) */}
        <div className="space-y-2 rounded-2xl border border-subtle bg-surface p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-primary">포함할 추가 정보 (기본 모두 숨김)</span>
            <span className="text-[11px] font-medium text-secondary">라벨·시음 사진 미포함</span>
          </div>

          <div className="space-y-2 pt-1 text-xs">
            <label className="flex cursor-pointer items-center gap-2.5 text-primary">
              <input
                type="checkbox"
                checked={options.includeLocation}
                onChange={() => toggleOption('includeLocation')}
                className="h-4 w-4 rounded accent-forest"
              />
              <span>셀러 보관 위치 포함 (예: 삼성 1-1)</span>
            </label>

            <label className="flex cursor-pointer items-center gap-2.5 text-primary">
              <input
                type="checkbox"
                checked={options.includePrice}
                onChange={() => toggleOption('includePrice')}
                className="h-4 w-4 rounded accent-forest"
              />
              <span>구매 가격 · 환율 메모 포함</span>
            </label>

            {isPrivacyMode && options.includePrice && (
              <div className="flex items-start gap-2 rounded-xl border border-status-warn/40 bg-status-warn/10 px-3 py-2 text-[11px] text-status-warn">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  현재 프라이버시 모드가 켜져 있지만, 체크된 상태에서는 공유 링크에 구매 가격이 포함됩니다.
                </span>
              </div>
            )}

            <label className="flex cursor-pointer items-center gap-2.5 text-primary">
              <input
                type="checkbox"
                checked={options.includeSourceAndDate}
                onChange={() => toggleOption('includeSourceAndDate')}
                className="h-4 w-4 rounded accent-forest"
              />
              <span>구입처 · 최근 구입일 포함</span>
            </label>

            <label className="flex cursor-pointer items-center gap-2.5 text-primary">
              <input
                type="checkbox"
                checked={options.includeMemo}
                onChange={() => toggleOption('includeMemo')}
                className="h-4 w-4 rounded accent-forest"
              />
              <span>병 메모 포함</span>
            </label>
          </div>

          <p className="pt-1 text-[11px] text-secondary">
            체크 해제된 항목과 사진 ID는 링크 데이터에서 완전히 제거됩니다.
          </p>
        </div>

        {/* 소프트 만료일 옵션 */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-primary">
            <Clock className="h-3.5 w-3.5 text-secondary" />
            <span>열람 기한 (소프트 만료)</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {EXPIRY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setExpiry(opt.value);
                  setCopiedKind(null);
                }}
                className={`rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${
                  expiry === opt.value
                    ? 'border-forest bg-forest text-white'
                    : 'border-subtle bg-elevated text-secondary hover:text-primary'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {expiry !== 'none' && payload?.expiresAt && (
            <p className="text-[11px] text-secondary">
              {payload.expiresAt} 이후 열람 화면을 자동으로 가립니다. (기술적 원격 파기가 아닌 화면 표시 제한)
            </p>
          )}
        </div>

        {/* 실시간 URL 길이 상태 게이지 */}
        {lengthEval && (
          <div className={`rounded-2xl border p-3 text-xs ${lengthStyle}`}>
            <div className="flex items-center justify-between gap-2 font-bold">
              <span className="inline-flex items-center gap-1.5">
                {lengthEval.level === 'safe' ? (
                  <Copy className="h-3.5 w-3.5" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5" />
                )}
                <span>
                  {lengthEval.level === 'safe'
                    ? '링크 길이 양호'
                    : lengthEval.level === 'warning'
                      ? '링크 길이 주의'
                      : '링크 매우 김 (텍스트 복사 권장)'}
                </span>
              </span>
              <span className="tabular-nums">{lengthEval.length.toLocaleString('ko-KR')}자</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed opacity-90">{lengthEval.message}</p>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
