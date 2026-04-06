"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

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
          setMessage(e instanceof Error ? e.message : "Unknown error");
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mt-8 max-w-lg text-left text-sm text-zinc-600 dark:text-zinc-400">
      <p className="font-medium text-zinc-800 dark:text-zinc-200">
        Firestore (Phase 1)
      </p>
      {status === "loading" ? (
        <p>Testing connection…</p>
      ) : status === "ok" ? (
        <p className="text-green-700 dark:text-green-400">{message}</p>
      ) : (
        <p className="text-red-700 dark:text-red-400">{message}</p>
      )}
    </div>
  );
}
