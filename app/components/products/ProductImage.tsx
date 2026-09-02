"use client";

import Image from "next/image";
import { useState } from "react";
import {
  PRODUCT_IMAGE_PLACEHOLDER,
  resolveProductImage,
} from "@/lib/upload/productImageDisplay";
import { cn } from "@/lib/utils";

type ProductImageProps = {
  /** `products/{uid}/product-image-{ts}.webp` — preferred, and optimisable. */
  imagePath?: string | undefined;
  /** Legacy direct URL, used only when no path is stored. */
  imageUrl?: string | undefined;
  alt: string;
  /** Rendered box in CSS pixels. The optimiser serves this width at 1x and 2x. */
  width: number;
  height: number;
  className?: string | undefined;
  /** Set on the LCP image (the product profile hero); leave off for lists. */
  preload?: boolean | undefined;
};

/**
 * The one way product photos are rendered.
 *
 * Everything routes through `next/image` against our same-origin proxy, so a 4000px
 * master copy is delivered as a WebP at the size actually shown — a couple of KB for a
 * list thumbnail instead of megabytes. A failed load falls back to the brand placeholder
 * rather than a broken-image icon, and the box holds its space while loading so rows do
 * not jump.
 */
export function ProductImage({
  imagePath,
  imageUrl,
  alt,
  width,
  height,
  className,
  preload = false,
}: ProductImageProps) {
  // Keyed by src so a product whose photo changes retries instead of staying broken.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const resolved = resolveProductImage(imagePath, imageUrl);
  const showPlaceholder = !resolved.hasImage || failedSrc === resolved.src;
  const src = showPlaceholder ? PRODUCT_IMAGE_PLACEHOLDER : resolved.src;

  // One class, not three overlapping ones: Tailwind cannot resolve competing opacity
  // utilities by argument order, only by stylesheet order.
  const opacityClass = !loaded ? "opacity-0" : showPlaceholder ? "opacity-40" : "opacity-100";

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      // The placeholder is a small local asset and legacy URLs are third-party; neither
      // benefits from a trip through the optimiser.
      unoptimized={showPlaceholder || resolved.unoptimized}
      {...(preload ? { preload: true } : { loading: "lazy" as const })}
      onError={() => setFailedSrc(resolved.src)}
      onLoad={() => setLoaded(true)}
      className={cn(
        "bg-surface-muted object-contain transition-opacity duration-200",
        opacityClass,
        className,
      )}
    />
  );
}
