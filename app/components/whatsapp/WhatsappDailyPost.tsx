"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { ProductDoc } from "@/lib/types/firestore";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";

type ProductRow = {
  id: string;
  name: string;
  salePrice: number;
  imageUrl?: string;
};

const SELLING_LINE = "Limited stock | Order now";
const DUMMY_IMAGE_PATH = "/wholesale_logo.png";

function toPrice(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "0";
}

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function pickDailyProducts(all: ProductRow[], count: number): ProductRow[] {
  return shuffle(all).slice(0, Math.min(count, all.length));
}

function legacyCopyText(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function WhatsappDailyPost() {
  const [allProducts, setAllProducts] = useState<ProductRow[]>([]);
  const [selected, setSelected] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const snap = await getDocs(collection(getDb(), COLLECTIONS.products));
        const rows: ProductRow[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data() as ProductDoc;
          rows.push({
            id: docSnap.id,
            name: typeof data.name === "string" ? data.name : "Product",
            salePrice: typeof data.sale_price === "number" ? data.sale_price : 0,
            imageUrl: typeof data.image_url === "string" ? data.image_url : undefined,
          });
        });
        rows.sort((a, b) => a.name.localeCompare(b.name));
        if (!active) return;
        setAllProducts(rows);
        setSelected(pickDailyProducts(rows, 5));
      } catch (e) {
        if (!active) return;
        setError(getFirestoreUserMessage(e));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const whatsappLines = useMemo(() => {
    const items = selected.map((p) => `${cleanName(p.name)} - Rs. ${toPrice(p.salePrice)}`);
    return [...items, "", SELLING_LINE];
  }, [selected]);

  const whatsappText = useMemo(() => whatsappLines.join("\n"), [whatsappLines]);

  const lineForProduct = (p: ProductRow) => `${cleanName(p.name)} - Rs. ${toPrice(p.salePrice)}`;

  async function copyText() {
    setFeedback(null);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(whatsappText);
        setFeedback("WhatsApp text copied.");
        return;
      }
      const ok = legacyCopyText(whatsappText);
      setFeedback(ok ? "WhatsApp text copied." : "Could not copy text. Please copy manually.");
    } catch {
      const ok = legacyCopyText(whatsappText);
      setFeedback(ok ? "WhatsApp text copied." : "Could not copy text. Please copy manually.");
    }
  }

  async function copyLineText(p: ProductRow) {
    setFeedback(null);
    const text = lineForProduct(p);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setFeedback("Item text copied.");
        return;
      }
      const ok = legacyCopyText(text);
      setFeedback(ok ? "Item text copied." : "Could not copy item text.");
    } catch {
      const ok = legacyCopyText(text);
      setFeedback(ok ? "Item text copied." : "Could not copy item text.");
    }
  }

  async function copyProductImage(imageUrl?: string) {
    setFeedback(null);
    try {
      const src = imageUrl && imageUrl.trim().length > 0 ? imageUrl : DUMMY_IMAGE_PATH;
      const res = await fetch(src);
      if (!res.ok) throw new Error("Image fetch failed");
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type || "image/png"]: blob,
        }),
      ]);
      setFeedback("Image copied.");
    } catch {
      setFeedback("Could not copy image. Check image URL/CORS or browser permissions.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Daily WhatsApp Post</h1>
        <p className="text-sm text-muted-foreground">
          Picked randomly from your current products. Ready to copy and send.
        </p>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading products...</p> : null}
      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
      {feedback ? <InlineAlert variant="success">{feedback}</InlineAlert> : null}

      {!loading && !error && selected.length === 0 ? (
        <InlineAlert variant="info">No products available yet.</InlineAlert>
      ) : null}

      {!loading && !error && selected.length > 0 ? (
        <>
          <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => setSelected(pickDailyProducts(allProducts, 5))}>
                Pick another 5
              </Button>
              <Button type="button" variant="outline" onClick={() => void copyText()}>
                Copy WhatsApp text
              </Button>
            </div>
            <pre className="whitespace-pre-wrap rounded-md bg-surface-muted p-3 text-sm text-foreground">
              {whatsappText}
            </pre>
            <p className="text-xs text-muted-foreground">
              If copy is blocked, long-press or select the text above and copy manually.
            </p>
          </div>

          <div className="space-y-3">
            {selected.map((p) => (
              <div
                key={p.id}
                className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3">
                  <img
                    src={p.imageUrl && p.imageUrl.trim().length > 0 ? p.imageUrl : DUMMY_IMAGE_PATH}
                    alt={cleanName(p.name)}
                    className="h-14 w-14 rounded-md border border-border bg-surface-muted object-contain p-1"
                    loading="lazy"
                  />
                  <p className="text-sm font-medium text-foreground">
                    {lineForProduct(p)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => void copyLineText(p)}>
                    Copy text
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void copyProductImage(p.imageUrl)}>
                    Copy image
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
