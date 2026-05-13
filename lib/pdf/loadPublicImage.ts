export type LoadPublicPngOptions = {
  /** Downscale wide logos before embedding (reduces PDF size massively). */
  maxWidthPx?: number;
};

/**
 * Loads a PNG from the public folder into a data URL for jsPDF addImage.
 * Client-only (uses Image and canvas).
 */
export function loadPublicPngAsDataUrl(src: string, options?: LoadPublicPngOptions): Promise<string> {
  const maxW = options?.maxWidthPx;
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
        resolve(canvas.toDataURL("image/png"));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}
