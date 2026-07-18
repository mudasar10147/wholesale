"use client";

import { resolveProductImageSrc } from "@/lib/upload/productImageDisplay";
import { cleanName } from "@/lib/social/captions";
import {
  POST_KIND_LABELS,
  POST_STATUS_LABELS,
  POST_TYPE_SPECS,
  type SocialPostType,
} from "@/lib/social/postTypes";
import type { SocialProductRow } from "@/lib/social/types";
import type { SocialPostKind, SocialPostStatus } from "@/lib/types/firestore";
import { cn } from "@/lib/utils";

export function ProductThumb({
  product,
  size = "md",
}: {
  product: Pick<SocialProductRow, "name" | "imageUrl" | "imagePath">;
  size?: "sm" | "md";
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- proxied/external product image; avoid next/image hostname restrictions
    <img
      src={resolveProductImageSrc(product.imagePath, product.imageUrl)}
      alt={cleanName(product.name)}
      className={cn(
        "shrink-0 rounded-md border border-border bg-surface-muted object-contain p-0.5",
        size === "sm" ? "h-8 w-8" : "h-12 w-12",
      )}
      loading="lazy"
    />
  );
}

const statusClasses: Record<SocialPostStatus, string> = {
  draft: "bg-surface-muted text-muted-foreground",
  ready: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  posted: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  skipped: "bg-surface-muted text-muted-foreground line-through",
};

export function StatusPill({ status }: { status: SocialPostStatus }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
        statusClasses[status],
      )}
    >
      {POST_STATUS_LABELS[status]}
    </span>
  );
}

/** Where the products came from — sits next to the PostTypeBadge, which says what the post is. */
export function KindBadge({ kind }: { kind: SocialPostKind }) {
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
      {POST_KIND_LABELS[kind]}
    </span>
  );
}

export function PostTypeBadge({ type }: { type: SocialPostType }) {
  const spec = POST_TYPE_SPECS[type];
  return (
    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[0.6875rem] font-medium text-foreground">
      <span aria-hidden>{spec.icon}</span> {spec.label}
    </span>
  );
}

/** Products with no stock must not be advertised — we cannot ship them. */
export function OutOfStockBadge() {
  return (
    <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[0.6875rem] font-medium text-red-600 dark:text-red-400">
      Out of stock
    </span>
  );
}

export function RecentlyPostedBadge() {
  return (
    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[0.6875rem] font-medium text-amber-600 dark:text-amber-500">
      Posted recently
    </span>
  );
}
