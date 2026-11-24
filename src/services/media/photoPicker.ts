import { Capacitor } from '@capacitor/core';
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
      });
      if (!photo.webPath) return null;
      const res = await fetch(photo.webPath);
      if (!res.ok) return null;
      return await res.blob();
    } catch {
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

    // 일부 구형 브라우저(iOS Safari iCloud 변환 포함)는 cancel 이벤트가 지연/미발생하므로 focus 복귀 후 1초 대기
    const handleWindowFocus = () => {
      window.setTimeout(() => {
        if (!settled && (!input.files || input.files.length === 0)) {
          cleanup(null);
        }
      }, 1000);
    };

    input.addEventListener('change', handleChange, { once: true });
    input.addEventListener('cancel', handleCancel, { once: true });
    window.addEventListener('focus', handleWindowFocus, { once: true });

    document.body.appendChild(input);
    input.click();
  });
}
