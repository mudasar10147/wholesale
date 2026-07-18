"use client";

import { useEffect, useRef, useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { fetchSocialNote, saveSocialNote } from "@/lib/firestore/socialNotes";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/Card";

/** Notepad for one week. Saves on blur — there is no Save button to forget. */
export function WeeklyNotepad({ weekKey, uid }: { weekKey: string; uid: string }) {
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const lastSavedRef = useRef("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      setSavedAt(null);
      try {
        const value = await fetchSocialNote(getDb(), weekKey);
        if (!active) return;
        setBody(value);
        lastSavedRef.current = value;
      } catch (err) {
        if (!active) return;
        setError(getFirestoreUserMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [weekKey]);

  async function save() {
    if (body === lastSavedRef.current) return;
    setSaving(true);
    setError(null);
    try {
      await saveSocialNote(getDb(), weekKey, body, uid);
      lastSavedRef.current = body;
      setSavedAt(new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }));
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notepad</CardTitle>
        <CardDescription>
          Scratch notes for this week. Saved automatically when you click away.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={() => void save()}
          disabled={loading}
          rows={8}
          placeholder={loading ? "Loading…" : "Ideas, reminders, what worked last week…"}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
        <p className="text-xs text-muted-foreground" role="status">
          {saving ? "Saving…" : savedAt ? `Saved at ${savedAt}` : " "}
        </p>
      </CardContent>
    </Card>
  );
}
