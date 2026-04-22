"use client";

import Image from "next/image";
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
};

const SELLING_LINE = "Limited stock | Order now";
const DUMMY_IMAGE_PATH = "/wholesale_logo.png";

function toPrice(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "0";
}

function shortName(name: string, max = 28): string {
  const clean = name.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
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
    const items = selected.map((p) => `${shortName(p.name)} - Rs. ${toPrice(p.salePrice)}`);
    return [...items, "", SELLING_LINE];
  }, [selected]);

  const whatsappText = useMemo(() => whatsappLines.join("\n"), [whatsappLines]);

  async function copyText() {
    setFeedback(null);
    try {
      await navigator.clipboard.writeText(whatsappText);
      setFeedback("WhatsApp text copied.");
    } catch {
      setFeedback("Could not copy text. Please copy manually.");
    }
  }

  async function copyDummyImage() {
    setFeedback(null);
    try {
      const res = await fetch(DUMMY_IMAGE_PATH);
      if (!res.ok) throw new Error("Image fetch failed");
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type || "image/png"]: blob,
        }),
      ]);
      setFeedback("Image copied.");
    } catch {
      setFeedback("Could not copy image on this browser.");
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
          </div>

          <div className="space-y-3">
            {selected.map((p) => (
              <div
                key={p.id}
                className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3">
                  <Image
                    src={DUMMY_IMAGE_PATH}
                    alt="Product image"
                    width={54}
                    height={54}
                    className="h-14 w-14 rounded-md border border-border bg-surface-muted object-contain p-1"
                  />
                  <p className="text-sm font-medium text-foreground">
                    {shortName(p.name)} - Rs. {toPrice(p.salePrice)}
                  </p>
                </div>
                <Button type="button" variant="outline" onClick={() => void copyDummyImage()}>
                  Copy image
                </Button>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
