export type PhotoPreset = 'label' | 'tasting';

const PRESET_CONFIG: Record<PhotoPreset, { maxDim: number; quality: number }> = {
  label: { maxDim: 500, quality: 0.82 },
  tasting: { maxDim: 1024, quality: 0.84 },
};

export interface ProcessedImageResult {
  blob: Blob;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
}

/**
 * 종횡비를 유지하면서 긴 변을 maxDim 이하로 축소하는 순수 계산 함수
 */
export function computeScaledDimensions(
  width: number,
  height: number,
  maxDim: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: maxDim, height: maxDim };
  }
  const longest = Math.max(width, height);
  if (longest <= maxDim) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const scale = maxDim / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function loadImageElement(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지 파일을 읽을 수 없습니다.'));
    };
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

/**
 * 브라우저 Canvas 기반 자동 리사이징 & WebP(미지원 시 JPEG 폴백) 압축
 * - label: 500px / ~35~55KB 목표
 * - tasting: 1024px / ~80~150KB 목표
 */
export async function compressImageFile(
  file: Blob,
  preset: PhotoPreset,
): Promise<ProcessedImageResult> {
  const { maxDim, quality } = PRESET_CONFIG[preset];

  if (typeof document === 'undefined') {
    return {
      blob: file,
      mimeType: file.type || 'image/webp',
      extension: 'webp',
      width: maxDim,
      height: maxDim,
    };
  }

  let source: CanvasImageSource;
  let naturalWidth: number;
  let naturalHeight: number;
  let bitmapToClose: ImageBitmap | null = null;

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      bitmapToClose = bitmap;
      source = bitmap;
      naturalWidth = bitmap.width;
      naturalHeight = bitmap.height;
    } catch {
      const img = await loadImageElement(file);
      source = img;
      naturalWidth = img.naturalWidth || img.width;
      naturalHeight = img.naturalHeight || img.height;
    }
  } else {
    const img = await loadImageElement(file);
    source = img;
    naturalWidth = img.naturalWidth || img.width;
    naturalHeight = img.naturalHeight || img.height;
  }

  try {
    const scaled = computeScaledDimensions(naturalWidth, naturalHeight, maxDim);
    const canvas = document.createElement('canvas');
    canvas.width = scaled.width;
    canvas.height = scaled.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('브라우저 캔버스 컨텍스트를 초기화할 수 없습니다.');
    }
    ctx.drawImage(source, 0, 0, scaled.width, scaled.height);

    let blob = await canvasToBlob(canvas, 'image/webp', quality);
    let mimeType = 'image/webp';
    let extension = 'webp';

    if (!blob || blob.type !== 'image/webp') {
      blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      mimeType = 'image/jpeg';
      extension = 'jpg';
    }

    if (!blob) {
      throw new Error('이미지 압축 변환에 실패했습니다.');
    }

    return {
      blob,
      mimeType,
      extension,
      width: scaled.width,
      height: scaled.height,
    };
  } finally {
    bitmapToClose?.close();
  }
}

/**
 * data:image/...;base64,... 문자열을 바이너리 Blob으로 안전 변환 (브라우저/테스트 공용)
 */
export function dataUrlToBlob(dataUrl: string): { blob: Blob; mimeType: string; extension: string } {
  const match = dataUrl.trim().match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!match) {
    throw new Error('유효한 Base64 이미지 Data URL 형식이 아닙니다.');
  }
  const mimeType = match[1];
  const base64 = match[2].replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const extension = mimeType.includes('webp')
    ? 'webp'
    : mimeType.includes('png')
      ? 'png'
      : 'jpg';
  return {
    blob: new Blob([bytes], { type: mimeType }),
    mimeType,
    extension,
  };
}
