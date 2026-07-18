import { doc, getDoc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { SocialNoteDoc } from "@/lib/types/firestore";

const MAX_NOTE_LENGTH = 20000;

/** The notepad for one week. Doc id is the week key, so there is nothing to query. */
export async function fetchSocialNote(db: Firestore, weekKey: string): Promise<string> {
  const snap = await getDoc(doc(db, COLLECTIONS.socialNotes, weekKey));
  if (!snap.exists()) {
    return "";
  }
  const data = snap.data() as SocialNoteDoc;
  return typeof data.body === "string" ? data.body : "";
}

export async function saveSocialNote(
  db: Firestore,
  weekKey: string,
  body: string,
  updatedBy: string,
): Promise<void> {
  if (body.length > MAX_NOTE_LENGTH) {
    throw new Error("Note is too long.");
  }
  await setDoc(doc(db, COLLECTIONS.socialNotes, weekKey), {
    week_key: weekKey,
    body,
    updated_by: updatedBy,
    updated_at: serverTimestamp(),
  });
}
