"use client";

import { useEffect } from "react";
import { POST_TYPES, POST_TYPE_SPECS, type SocialPostType } from "@/lib/social/postTypes";
import { Button } from "@/app/components/ui/Button";

type PostTypePickerModalProps = {
  /** The day the post will land on, shown so the manager knows what they are adding to. */
  dateLabel: string;
  onPick: (type: SocialPostType) => void;
  onDismiss: () => void;
};

/**
 * Step one of creating a post: what kind of thing is this? The answer decides the whole
 * shape of the editor that opens next, so it is asked on its own rather than buried in it.
 */
export function PostTypePickerModal({ dateLabel, onPick, onDismiss }: PostTypePickerModalProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={onDismiss}
    >
      <div
        role="dialog"
        aria-modal
        aria-labelledby="post-type-title"
        className="w-full max-w-2xl rounded-lg border border-border bg-surface p-6 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="post-type-title" className="text-lg font-semibold text-foreground">
              What are you posting?
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{dateLabel}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onDismiss} aria-label="Close">
            ✕
          </Button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {POST_TYPES.map((type) => {
            const spec = POST_TYPE_SPECS[type];
            return (
              <button
                key={type}
                type="button"
                onClick={() => onPick(type)}
                className="flex h-full flex-col items-start gap-1.5 rounded-lg border border-border bg-surface p-4 text-left transition-colors duration-[var(--duration-fast)] hover:border-primary hover:bg-surface-hover focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-xl" aria-hidden>
                  {spec.icon}
                </span>
                <span className="text-sm font-semibold text-foreground">{spec.label}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">{spec.hint}</span>
              </button>
            );
          })}
        </div>

        <p className="mt-5 text-xs text-muted-foreground">
          The type is fixed once the post is created. To change it, delete the post and add it
          again.
        </p>
      </div>
    </div>
  );
}
