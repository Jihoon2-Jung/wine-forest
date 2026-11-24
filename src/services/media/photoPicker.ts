import type { PhotoPreset } from './imageProcessor';

export type PhotoPickSource = 'prompt' | 'camera' | 'photos';

export interface PickImageOptions {
  /**
   * 'prompt' (기본): OS 파일/카메라 선택 시트
   * 'camera': 모바일 웹에서 후면 카메라 우선 (capture="environment")
   * 'photos': 앨범 선택
   */
  source?: PhotoPickSource;
  /** 용도 힌트 ('label' | 'tasting') — 추후 네이티브 카메라 1차 리사이즈 기준에 활용 */
  preset?: PhotoPreset;
}

/**
 * 단일 이미지 선택 진입점 (Web / Capacitor 공용 어댑터 포인트)
 *
 * [NEXT AGENT HANDOFF — Mobile M1~M3 (@capacitor/camera 연동 지점)]
 * 추후 Capacitor 모바일 전환 시 UI 컴포넌트(WineDetailSheet, QuickConsumeModal, HistoryCard)는
 * 전혀 수정하지 말고, 이 함수 상단에 아래 네이티브 분기만 추가하십시오:
 *
 * ```ts
 * if (Capacitor.isNativePlatform()) {
 *   const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
 *   const capSource =
 *     options.source === 'camera'
 *       ? CameraSource.Camera
 *       : options.source === 'photos'
 *         ? CameraSource.Photos
 *         : CameraSource.Prompt;
 *   const photo = await Camera.getPhoto({
 *     resultType: CameraResultType.Uri,
 *     source: capSource,
 *     quality: 80,
 *     width: options.preset === 'label' ? 1000 : 1600,
 *     correctOrientation: true,
 *   });
 *   if (!photo.webPath) return null;
 *   const res = await fetch(photo.webPath);
 *   return res.blob();
 * }
 * ```
 *
 * 반환된 Blob(웹에서는 File)은 useWineStore의 uploadWineLabelPhoto / uploadTastingPhoto로
 * 그대로 전달되어 imageProcessor.ts(500px/1024px WebP 압축) → StorageAdapter.uploadPhoto()를 탑니다.
 */
export function pickImageFile(options: PickImageOptions = {}): Promise<Blob | null> {
  if (typeof document === 'undefined') {
    return Promise.resolve(null);
  }

  return new Promise<Blob | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (options.source === 'camera') {
      input.setAttribute('capture', 'environment');
    }
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.opacity = '0';

    let settled = false;
    const cleanup = (result: Blob | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', handleWindowFocus);
      input.remove();
      resolve(result);
    };

    const handleChange = () => {
      const file = input.files?.[0] ?? null;
      cleanup(file);
    };

    const handleCancel = () => {
      cleanup(null);
    };

    // 일부 구형 브라우저(Safari 등)는 취소 시 cancel 이벤트를 발생시키지 않으므로 focus 복귀 후 정리
    const handleWindowFocus = () => {
      window.setTimeout(() => {
        if (!settled && (!input.files || input.files.length === 0)) {
          cleanup(null);
        }
      }, 400);
    };

    input.addEventListener('change', handleChange, { once: true });
    input.addEventListener('cancel', handleCancel, { once: true });
    window.addEventListener('focus', handleWindowFocus, { once: true });

    document.body.appendChild(input);
    input.click();
  });
}
