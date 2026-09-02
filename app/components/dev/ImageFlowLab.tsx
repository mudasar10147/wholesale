"use client";

/**
 * TEMPORARY DIAGNOSTIC PAGE — safe to delete.
 *
 * Remove these two files and nothing else references them:
 *   app/components/dev/ImageFlowLab.tsx
 *   app/(dashboard)/dev/image-lab/page.tsx
 *
 * Walks one image through every stage of the real pipeline and reports exactly what
 * happened at each: what the browser produced, what the server stored, what a page
 * actually downloads, and what goes on the clipboard for WhatsApp. It calls the same
 * production functions the app uses, so the numbers are the real ones, not a simulation.
 */

import { useCallback, useRef, useState } from "react";
import {
  describeCanvasEncoderSupport,
  maybeCompressProductImage,
} from "@/lib/upload/compressImageForUpload";
import { deleteProductImageByPath, uploadProductImage } from "@/lib/upload/productImages";
import {
  SHARE_IMAGE_WIDTH,
  optimizedProductImageUrl,
  publicProductImageApiUrl,
} from "@/lib/upload/productImageDisplay";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";

/** Widths the app actually renders — see ProductImage call sites. */
const RENDERED_WIDTHS = [32, 48, 96, 640] as const;

/** Rows in a typical stock-take worksheet, used for the page-weight estimate. */
const LIST_ROWS = 20;

type Line = string;

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function pct(from: number, to: number): string {
  if (from <= 0) return "n/a";
  const change = (1 - to / from) * 100;
  return `${change >= 0 ? "-" : "+"}${Math.abs(change).toFixed(1)}%`;
}

function times(from: number, to: number): string {
  if (to <= 0) return "n/a";
  return `${Math.round(from / to).toLocaleString()}x smaller`;
}

async function dimensionsOf(blob: Blob): Promise<string> {
  try {
    const bmp = await createImageBitmap(blob);
    const d = `${bmp.width} x ${bmp.height}`;
    bmp.close();
    return d;
  } catch {
    return "could not decode";
  }
}

/**
 * Re-encode the picked image at the stored ceiling in a specific format. Used only to
 * show what each encoder would actually cost on this image — the production path picks
 * one format, this reports both so a silent JPEG fallback is visible rather than implied.
 */
async function encodeAt(file: File, mime: string, long: number, quality: number): Promise<{ type: string; size: number }> {
  const bmp = await createImageBitmap(file);
  try {
    const scale = Math.min(1, long / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return { type: "(no 2d context)", size: 0 };
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob((b) => r(b), mime, quality));
    return { type: blob?.type || "(null)", size: blob?.size ?? 0 };
  } finally {
    bmp.close();
  }
}

type Probe = {
  ok: boolean;
  status: number;
  size: number;
  contentType: string;
  cacheControl: string;
  ms: number;
  blob: Blob | null;
};

/** `no-store` so each probe measures a real fetch rather than the browser's memory cache. */
async function probe(url: string, accept?: string): Promise<Probe> {
  const started = performance.now();
  try {
    const res = await fetch(url, {
      cache: "no-store",
      ...(accept ? { headers: { Accept: accept } } : {}),
    });
    const blob = res.ok ? await res.blob() : null;
    return {
      ok: res.ok,
      status: res.status,
      size: blob?.size ?? 0,
      contentType: res.headers.get("content-type") ?? "(none)",
      cacheControl: res.headers.get("cache-control") ?? "(none)",
      ms: Math.round(performance.now() - started),
      blob,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      size: 0,
      contentType: err instanceof Error ? err.message : "fetch failed",
      cacheControl: "(none)",
      ms: Math.round(performance.now() - started),
      blob: null,
    };
  }
}

export function ImageFlowLab() {
  const [report, setReport] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async (file: File) => {
    setRunning(true);
    setError(null);
    setCopied(false);
    setUploadedPath(null);

    const runStarted = performance.now();
    const out: Line[] = [];
    const gaps: Line[] = [];
    const add = (line: Line = "") => out.push(line);
    const kv = (k: string, v: string) => out.push(`  ${k.padEnd(18)}${v}`);

    try {
      add("=== IMAGE FLOW REPORT ===");
      kv("generated", new Date().toISOString());
      kv("user agent", navigator.userAgent);
      add();

      // ---------------------------------------------------------------- stage 0
      add("[0] ORIGINAL FILE (what you picked)");
      kv("name", file.name);
      kv("type", file.type || "(browser reported none)");
      kv("size", `${bytes(file.size)}  (${file.size.toLocaleString()} bytes)`);
      kv("dimensions", await dimensionsOf(file));
      add();

      // ---------------------------------------------------------------- stage 1
      add("[1] BROWSER STEP  (lib/upload/compressImageForUpload.ts)");
      const t1 = performance.now();
      const prepared = await maybeCompressProductImage(file);
      const compressMs = Math.round(performance.now() - t1);
      const skipped = prepared === file;
      kv("action", skipped ? "left unchanged (already within bounds)" : "re-encoded");
      kv("output type", prepared.type);
      kv("output size", `${bytes(prepared.size)}  (${pct(file.size, prepared.size)})`);
      kv("dimensions", await dimensionsOf(prepared));
      kv("took", `${compressMs} ms`);
      if (prepared.size > 3 * 1024 * 1024) {
        gaps.push(`Browser output is ${bytes(prepared.size)} — above the ~4.5 MB hosting limit.`);
      }
      add();

      // ------------------------------------------------------------- stage 1b
      add("[1b] BROWSER ENCODER SUPPORT  (why step 1 chose that format)");
      const support = await describeCanvasEncoderSupport();
      kv("webp probe", `${support.webpType}  (${support.webpBytes} bytes)`);
      kv("jpeg probe", support.jpegType);
      kv("chosen", support.chosen);
      const asWebp = await encodeAt(file, "image/webp", 2000, 0.85);
      const asJpeg = await encodeAt(file, "image/jpeg", 2000, 0.85);
      kv("this image webp", `${asWebp.type}  ${bytes(asWebp.size)}`);
      kv("this image jpeg", `${asJpeg.type}  ${bytes(asJpeg.size)}`);
      if (support.chosen !== "image/webp") {
        gaps.push(
          `Browser cannot encode WebP (probe returned ${support.webpType}), so it sent JPEG. ` +
            `That forces the server to re-encode and makes the upload larger.`,
        );
      }
      add();

      // ---------------------------------------------------------------- stage 2
      add("[2] UPLOAD  ->  POST /api/products/image/upload");
      const t2 = performance.now();
      const uploaded = await uploadProductImage(file);
      const uploadMs = Math.round(performance.now() - t2);
      setUploadedPath(uploaded.path);
      // This is NOT a link-speed measurement, and an earlier version of this page wrongly
      // labelled it as one. The wall clock covers the browser re-compress, the request to
      // the app, sharp decoding and re-encoding, and the app's own upload to GCS. Against
      // a local dev server the GCS leg dominates and has nothing to do with the browser's
      // connection — three runs at 866 / 596 / 334 KB all took ~8.5 s, which is what
      // proved payload size was not the bottleneck there.
      const serverMs = Math.max(1, uploadMs - compressMs);
      const throughput = (prepared.size * 8) / (serverMs / 1000) / 1_000_000;
      kv("sent", bytes(prepared.size));
      kv("took", `${uploadMs} ms total  (${compressMs} ms re-compress + ${serverMs} ms request)`);
      kv("throughput", `~${throughput.toFixed(2)} Mbps end-to-end (browser -> app -> GCS)`);
      kv("note", "not your link speed — includes server processing and the app's write to GCS");
      kv("stored path", uploaded.path);
      kv("stored mime", uploaded.mimeType);
      kv("stored size", bytes(uploaded.size));
      const storedAsIs = uploaded.size === prepared.size;
      kv("server action", storedAsIs
        ? "STORED AS-IS  ->  ONE lossy step total"
        : "RE-ENCODED    ->  TWO lossy steps total");
      if (!storedAsIs) {
        gaps.push(
          `Server re-encoded (sent ${bytes(prepared.size)}, stored ${bytes(uploaded.size)}). ` +
            `The browser output did not match the stored bounds, so the photo was compressed twice.`,
        );
      }
      if (uploaded.mimeType !== "image/webp") {
        gaps.push(`Stored as ${uploaded.mimeType}, expected image/webp.`);
      }
      add();

      // ---------------------------------------------------------------- stage 3
      add("[3] STORED MASTER  ->  GET /api/products/image/public");
      const masterUrl = publicProductImageApiUrl(uploaded.path);
      const master = await probe(masterUrl);
      kv("status", String(master.status));
      kv("bytes", `${bytes(master.size)}  (${master.size.toLocaleString()})`);
      kv("type", master.contentType);
      kv("dimensions", master.blob ? await dimensionsOf(master.blob) : "n/a");
      kv("cache-control", master.cacheControl);
      const masterWarm = await probe(masterUrl);
      kv("took", `${master.ms} ms cold, ${masterWarm.ms} ms on a repeat fetch`);
      if (!master.cacheControl.includes("immutable")) {
        gaps.push(`Master cache-control is "${master.cacheControl}" — not immutable, so it re-downloads.`);
      }
      add();

      // ---------------------------------------------------------------- stage 4
      add("[4] WHAT A PAGE ACTUALLY DOWNLOADS  (next/image derivatives)");
      let thumb48 = 0;
      out.push("  (cold = first ever request for that size; warm = served from the cache)");
      for (const w of RENDERED_WIDTHS) {
        const url = optimizedProductImageUrl(uploaded.path, w);
        const p = await probe(url, "image/webp,image/*");
        const warm = await probe(url, "image/webp,image/*");
        if (w === 48) thumb48 = p.size;
        out.push(
          `  w=${String(w).padEnd(5)} ${bytes(p.size).padStart(9)}  ${p.contentType.padEnd(12)} ` +
            `${String(p.ms).padStart(5)} ms cold / ${String(warm.ms).padStart(4)} ms warm  ` +
            `${p.ok ? "" : `HTTP ${p.status}`}`,
        );
        if (!p.ok) gaps.push(`Derivative w=${w} failed with HTTP ${p.status} — pages would show a broken image.`);
        else if (!p.contentType.includes("webp")) gaps.push(`Derivative w=${w} came back as ${p.contentType}, not WebP.`);
      }
      add();

      // ---------------------------------------------------------------- stage 5
      add("[5] WHATSAPP COPY PATH  (what lands on the clipboard)");
      const shareUrl = optimizedProductImageUrl(uploaded.path, SHARE_IMAGE_WIDTH);
      const share = await probe(shareUrl, "image/webp,image/*");
      kv("width asked", String(SHARE_IMAGE_WIDTH));
      kv("status", String(share.status));
      kv("bytes", `${bytes(share.size)}  (${pct(master.size, share.size)} vs the master)`);
      kv("type", share.contentType);
      kv("dimensions", share.blob ? await dimensionsOf(share.blob) : "n/a");
      kv("took", `${share.ms} ms`);
      if (share.ok && master.size > 0 && share.size > master.size) {
        gaps.push(`Share copy (${bytes(share.size)}) is larger than the master (${bytes(master.size)}).`);
      }
      if (!share.ok) gaps.push(`Share derivative failed with HTTP ${share.status} — Copy image falls back to the full master.`);
      add();

      // ---------------------------------------------------------------- stage 6
      add("[6] SUMMARY");
      kv("original", bytes(file.size));
      kv("-> stored", `${bytes(uploaded.size)}   (${pct(file.size, uploaded.size)})`);
      kv("-> 48px thumb", `${bytes(thumb48)}   (${times(file.size, thumb48)})`);
      kv("-> whatsapp", `${bytes(share.size)}   (${pct(file.size, share.size)})`);
      kv(`${LIST_ROWS}-row list`, `~${bytes(thumb48 * LIST_ROWS)} of images`);
      kv("was (before)", `~${bytes(file.size * LIST_ROWS)} if pages loaded originals`);
      add();

      kv("whole run took", `${((performance.now() - runStarted) / 1000).toFixed(1)} s`);
      add();

      add("[!] GAPS DETECTED");
      if (gaps.length === 0) add("  none — every stage behaved as designed");
      else gaps.forEach((g, i) => add(`  ${i + 1}. ${g}`));
      add();
      add("=== END REPORT ===");

      setReport(out.join("\n"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      out.push("", `!! RUN FAILED: ${message}`, "", "=== END REPORT (incomplete) ===");
      setReport(out.join("\n"));
    } finally {
      setRunning(false);
    }
  }, []);

  const cleanUp = useCallback(async () => {
    if (!uploadedPath) return;
    try {
      await deleteProductImageByPath(uploadedPath);
      setUploadedPath(null);
      setReport((r) => `${r}\n\n(test image deleted from the bucket)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the test image.");
    }
  }, [uploadedPath]);

  return (
    <div className="space-y-4">
      <InlineAlert variant="warning">
        Temporary diagnostic page. It performs a <strong>real upload</strong> to the bucket — use
        “Delete test image” when you are done so it does not linger as an orphan.
      </InlineAlert>

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          disabled={running}
          className="text-sm"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void run(f);
          }}
        />
        {running ? <span className="text-sm text-muted-foreground">Running the full flow…</span> : null}
      </div>

      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

      {report ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(report).then(
                  () => setCopied(true),
                  () => setError("Clipboard blocked — select the text below and copy manually."),
                );
              }}
            >
              {copied ? "Copied ✓" : "Copy report"}
            </Button>
            {uploadedPath ? (
              <Button type="button" size="sm" variant="destructive" onClick={() => void cleanUp()}>
                Delete test image
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setReport("");
                setError(null);
                setUploadedPath(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
            >
              Reset
            </Button>
          </div>
          <textarea
            readOnly
            value={report}
            rows={38}
            spellCheck={false}
            className="w-full rounded-lg border border-border bg-surface-muted p-3 font-mono text-xs leading-relaxed text-foreground"
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      ) : null}
    </div>
  );
}
