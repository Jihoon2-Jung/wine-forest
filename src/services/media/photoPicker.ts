import { Capacitor } from '@capacitor/core';
import { useWineStore } from '@/store/useWineStore';
import type { PhotoPreset } from './imageProcessor';

export type PhotoPickSource = 'prompt' | 'camera' | 'photos';

export interface PickImageOptions {
  /**
   * 'prompt' (기본): OS 파일/카메라 선택 시트
   * 'camera': 모바일 웹에서 후면 카메라 우선 (capture="environment")
   * 'photos': 앨범 선택
   */
  source?: PhotoPickSource;
  /** 용도 힌트 ('label' | 'tasting') — 네이티브 카메라 1차 리사이즈 기준에 활용 */
  preset?: PhotoPreset;
}

/**
 * 단일 이미지 선택 진입점 (Web / Capacitor 공용 어댑터 포인트)
 */
export async function pickImageFile(options: PickImageOptions = {}): Promise<Blob | null> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
      const capSource =
        options.source === 'camera'
          ? CameraSource.Camera
          : options.source === 'photos'
            ? CameraSource.Photos
            : CameraSource.Prompt;
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.Uri,
        source: capSource,
        quality: 80,
        width: options.preset === 'label' ? 1000 : 1600,
        correctOrientation: true,
        promptLabelHeader: '사진 선택',
        promptLabelPhoto: '앨범에서 선택',
        promptLabelPicture: '카메라로 촬영',
        promptLabelCancel: '취소',
      });
      if (!photo.webPath) return null;
      const res = await fetch(photo.webPath);
      if (!res.ok) return null;
      return await res.blob();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? '');
      // 사용자 취소만 조용히 null 반환, 권한 거부·설정 누락 등은 토스트로 명확히 안내
      if (/cancel/i.test(msg)) {
        return null;
      }
      const friendly = /denied|permission/i.test(msg)
        ? '카메라 또는 사진 라이브러리 접근 권한이 거부되었습니다. 기기 설정에서 권한을 허용해 주세요.'
        : `사진을 불러오지 못했습니다: ${msg || '알 수 없는 오류'}`;
      useWineStore.getState().showToast(friendly, 'error');
      return null;
    }
  }

  if (typeof document === 'undefined') {
    return null;
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
    let focusTimerId: number | null = null;
    const supportsNativeCancel =
      'oncancel' in (input as unknown as Record<string, unknown>);

    const cleanup = (result: Blob | null) => {
      if (settled) return;
      settled = true;
      if (focusTimerId !== null) {
        window.clearTimeout(focusTimerId);
        focusTimerId = null;
      }
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

    // cancel 이벤트 미지원 구형 브라우저에서만 focus 복귀 후 3초 대기(iOS Safari iCloud/HEIC 변환 시간 확보)
    const handleWindowFocus = () => {
      if (supportsNativeCancel) return;
      if (focusTimerId !== null) window.clearTimeout(focusTimerId);
      focusTimerId = window.setTimeout(() => {
        if (!settled && (!input.files || input.files.length === 0)) {
          cleanup(null);
        }
      }, 3000);
    };

    input.addEventListener('change', handleChange, { once: true });
    input.addEventListener('cancel', handleCancel, { once: true });
    if (!supportsNativeCancel) {
      window.addEventListener('focus', handleWindowFocus, { once: true });
    }

    document.body.appendChild(input);
    input.click();
  });
}
