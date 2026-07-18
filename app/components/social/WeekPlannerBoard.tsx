"use client";

import { useMemo } from "react";
import type { SocialPostRow } from "@/lib/firestore/socialPosts";
import { postTypeOf, specOf } from "@/lib/social/postTypes";
import type { SocialProductRow } from "@/lib/social/types";
import { toDateKey, weekDates } from "@/lib/social/weekKeys";
import {
  KindBadge,
  PostTypeBadge,
  ProductThumb,
  StatusPill,
} from "@/app/components/social/SocialPrimitives";
import { cn } from "@/lib/utils";

const MAX_THUMBS = 4;

type WeekPlannerBoardProps = {
  weekKey: string;
  posts: SocialPostRow[];
  productsById: Map<string, SocialProductRow>;
  /** False once the week is with the admin — the plan is frozen, posts open read-only. */
  editable: boolean;
  onOpenPost: (post: SocialPostRow) => void;
  onAddPost: (dateKey: string) => void;
};

/**
 * The composing surface: the week laid out as seven days, so gaps and pile-ups are obvious
 * at a glance. Copying and ticking posts as sent is not here — that is the day-to-day job,
 * and it lives on the Social Media page.
 */
export function WeekPlannerBoard({
  weekKey,
  posts,
  productsById,
  editable,
  onOpenPost,
  onAddPost,
}: WeekPlannerBoardProps) {
  const todayKey = toDateKey(new Date());

  const postsByDate = useMemo(() => {
    const map = new Map<string, SocialPostRow[]>();
    for (const post of posts) {
      const list = map.get(post.scheduled_date) ?? [];
      list.push(post);
      map.set(post.scheduled_date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));
    }
    return map;
  }, [posts]);

  return (
    <div className="grid gap-3 lg:grid-cols-7">
      {weekDates(weekKey).map((date) => {
        const dateKey = toDateKey(date);
        const dayPosts = postsByDate.get(dateKey) ?? [];
        const isToday = dateKey === todayKey;

        return (
          <section
            key={dateKey}
            className={cn(
              "flex flex-col gap-2 rounded-lg border bg-surface p-2",
              isToday ? "border-primary" : "border-border",
            )}
            aria-label={date.toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "short",
            })}
          >
            <header className="flex items-baseline justify-between gap-2 px-1">
              <h3 className="text-sm font-semibold text-foreground">
                {date.toLocaleDateString(undefined, { weekday: "short" })}
              </h3>
              <span
                className={cn(
                  "text-xs",
                  isToday ? "font-medium text-primary" : "text-muted-foreground",
                )}
              >
                {date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
              </span>
            </header>

            {dayPosts.map((post) => {
              const products = post.product_ids
                .map((id) => productsById.get(id))
                .filter((p): p is SocialProductRow => Boolean(p));
              const firstLine =
                post.caption.split("\n").find((line) => line.trim().length > 0) ?? "";
              const type = postTypeOf(post);
              const spec = specOf(type);

              return (
                <button
                  key={post.id}
                  type="button"
                  onClick={() => onOpenPost(post)}
                  className="w-full space-y-2 rounded-md border border-border bg-surface-muted/50 p-2 text-left transition-colors duration-[var(--duration-fast)] hover:border-primary hover:bg-surface-hover"
                  aria-label={`${editable ? "Edit" : "Open"} the ${post.scheduled_time} ${spec.label.toLowerCase()}`}
                >
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-foreground">
                      {post.scheduled_time}
                    </span>
                    <StatusPill status={post.status} />
                  </span>
                  <span className="flex flex-wrap items-center gap-1">
                    <PostTypeBadge type={type} />
                    {spec.sections.products && post.product_ids.length > 0 ? (
                      <KindBadge kind={post.kind} />
                    ) : null}
                  </span>

                  {spec.sections.products ? (
                    products.length > 0 ? (
                      <span className="flex flex-wrap items-center gap-1">
                        {products.slice(0, MAX_THUMBS).map((product) => (
                          <ProductThumb key={product.id} product={product} size="sm" />
                        ))}
                        {products.length > MAX_THUMBS ? (
                          <span className="text-xs text-muted-foreground">
                            +{products.length - MAX_THUMBS}
                          </span>
                        ) : null}
                      </span>
                    ) : type === "product" ? (
                      <span className="block text-xs text-muted-foreground">No products yet</span>
                    ) : null
                  ) : null}

                  {firstLine ? (
                    <span className="block truncate text-xs text-muted-foreground">{firstLine}</span>
                  ) : null}

                  {post.media_links.length > 0 ? (
                    <span className="block text-xs text-muted-foreground">
                      🔗 {post.media_links.length} link{post.media_links.length === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </button>
              );
            })}

            {editable ? (
              <button
                type="button"
                onClick={() => onAddPost(dateKey)}
                className="rounded-md border border-dashed border-border px-2 py-2 text-xs text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover hover:text-foreground"
              >
                + Add post
              </button>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
