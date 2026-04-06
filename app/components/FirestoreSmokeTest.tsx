"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { cn } from "@/lib/utils";

type Status = "loading" | "ok" | "error";

export function FirestoreSmokeTest() {
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const db = getDb();
        const ref = await addDoc(collection(db, "phase1_smoke"), {
          createdAt: serverTimestamp(),
          source: "nextjs",
        });
        if (!cancelled) {
          setStatus("ok");
          setMessage(`Document written: ${ref.id}`);
        }
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setMessage(getFirestoreUserMessage(e));
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Firestore
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium",
            status === "loading" && "bg-surface-hover text-muted-foreground",
            status === "ok" && "bg-success-muted text-success",
            status === "error" && "bg-destructive-muted text-destructive",
          )}
        >
          {status === "loading" ? "Checking" : status === "ok" ? "Connected" : "Error"}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        {status === "loading" ? (
          "Testing connection…"
        ) : status === "ok" ? (
          <span className="font-mono text-[13px] text-foreground">{message}</span>
        ) : (
          <span className="text-destructive">{message}</span>
        )}
      </p>
    </div>
  );
}
