"use client";

import { useMemo } from "react";
import type { SocialPostRow } from "@/lib/firestore/socialPosts";
import { postTypeOf, specOf } from "@/lib/social/postTypes";
import type { SocialProductRow } from "@/lib/social/types";
import { fromDateKey, toDateKey } from "@/lib/social/weekKeys";
import { Button } from "@/app/components/ui/Button";
import {
  KindBadge,
  PostTypeBadge,
  ProductThumb,
  StatusPill,
} from "@/app/components/social/SocialPrimitives";
import { cn } from "@/lib/utils";

const MAX_THUMBS = 6;

type WeekPostListProps = {
  posts: SocialPostRow[];
  productsById: Map<string, SocialProductRow>;
  busyPostId: string | null;
  /** False once the week is with the admin — Edit opens the post read-only. */
  editable: boolean;
  /** True only once the week is approved: the go-ahead to actually send the posts. */
  markable: boolean;
  onOpenPost: (post: SocialPostRow) => void;
  onCopyPost: (post: SocialPostRow) => void;
  onTogglePosted: (post: SocialPostRow) => void;
};

/**
 * The week as a running order, newest day first on the calendar but read top to bottom —
 * this is the "what do I send right now" view. The seven-column board on the plan page is
 * for composing; this is for working through the week.
 */
export function WeekPostList({
  posts,
  productsById,
  busyPostId,
  editable,
  markable,
  onOpenPost,
  onCopyPost,
  onTogglePosted,
}: WeekPostListProps) {
  const todayKey = toDateKey(new Date());

  const days = useMemo(() => {
    const map = new Map<string, SocialPostRow[]>();
    for (const post of posts) {
      const list = map.get(post.scheduled_date) ?? [];
      list.push(post);
      map.set(post.scheduled_date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [posts]);

  return (
    <div className="space-y-6">
      {days.map(([dateKey, dayPosts]) => {
        const date = fromDateKey(dateKey);
        const isToday = dateKey === todayKey;

        return (
          <section key={dateKey} className="space-y-2">
            <h3
              className={cn(
                "flex items-baseline gap-2 text-sm font-semibold",
                isToday ? "text-primary" : "text-foreground",
              )}
            >
              {date?.toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "short",
              }) ?? dateKey}
              {isToday ? <span className="text-xs font-medium">Today</span> : null}
            </h3>

            <ul className="divide-y divide-border rounded-lg border border-border">
              {dayPosts.map((post) => {
                const type = postTypeOf(post);
                const spec = specOf(type);
                const products = post.product_ids
                  .map((id) => productsById.get(id))
                  .filter((p): p is SocialProductRow => Boolean(p));
                const firstLine =
                  post.caption.split("\n").find((line) => line.trim().length > 0) ?? "";
                const busy = busyPostId === post.id;

                return (
                  <li key={post.id} className="flex flex-wrap items-start gap-3 p-3">
                    <span className="w-12 shrink-0 pt-0.5 text-sm font-semibold text-foreground">
                      {post.scheduled_time}
                    </span>

                    <div className="min-w-[12rem] flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <PostTypeBadge type={type} />
                        {spec.sections.products && post.product_ids.length > 0 ? (
                          <KindBadge kind={post.kind} />
                        ) : null}
                        <StatusPill status={post.status} />
                      </div>

                      {products.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1">
                          {products.slice(0, MAX_THUMBS).map((product) => (
                            <ProductThumb key={product.id} product={product} size="sm" />
                          ))}
                          {products.length > MAX_THUMBS ? (
                            <span className="text-xs text-muted-foreground">
                              +{products.length - MAX_THUMBS}
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      {firstLine ? (
                        <p className="line-clamp-2 text-xs text-muted-foreground">{firstLine}</p>
                      ) : null}

                      {post.media_links.length > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          🔗 {post.media_links.length} link
                          {post.media_links.length === 1 ? "" : "s"}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onOpenPost(post)}
                      >
                        {editable ? "Edit" : "View"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onCopyPost(post)}
                      >
                        Copy
                      </Button>
                      <Button
                        type="button"
                        variant={post.status === "posted" ? "outline" : "primary"}
                        size="sm"
                        disabled={busy || !markable}
                        title={markable ? undefined : "The week has to be approved first."}
                        onClick={() => onTogglePosted(post)}
                      >
                        {busy ? "…" : post.status === "posted" ? "Undo" : "Posted"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
