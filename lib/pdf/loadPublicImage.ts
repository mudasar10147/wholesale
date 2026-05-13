export type LoadPublicPngOptions = {
  /** Downscale wide logos before embedding (reduces PDF size massively). */
  maxWidthPx?: number;
  /** Luma grayscale — improves contrast on thermal B&W printers. */
  grayscale?: boolean;
};

/**
 * Loads a PNG from the public folder into a data URL for jsPDF addImage.
 * Client-only (uses Image and canvas).
 */
function applyGrayscaleToCanvas(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] ?? 255;
    if (a < 8) continue;
    const r = d[i] ?? 0;
    const g = d[i + 1] ?? 0;
    const b = d[i + 2] ?? 0;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const v = Math.max(0, Math.min(255, Math.round(y)));
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  }
  ctx.putImageData(imgData, 0, 0);
}

export function loadPublicPngAsDataUrl(src: string, options?: LoadPublicPngOptions): Promise<string> {
  const maxW = options?.maxWidthPx;
  const grayscale = options?.grayscale === true;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (maxW && w > maxW) {
          h = Math.max(1, Math.round((h * maxW) / w));
          w = maxW;
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not get canvas context."));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        if (grayscale) {
          applyGrayscaleToCanvas(ctx, w, h);
        }
        resolve(canvas.toDataURL("image/png"));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}
