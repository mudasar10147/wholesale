import {
  collection,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { MAX_REVIEW_NOTE_LENGTH, WEEK_PLAN_REVIEW_STATUSES } from "@/lib/social/approvals";
import type { SocialWeekPlanDoc } from "@/lib/types/firestore";

export type SocialWeekPlanRow = SocialWeekPlanDoc & { id: string };

function planRef(db: Firestore, weekKey: string) {
  return doc(db, COLLECTIONS.socialWeekPlans, weekKey);
}

/** Null when the week has never been submitted — callers read that as a draft. */
export async function fetchSocialWeekPlan(
  db: Firestore,
  weekKey: string,
): Promise<SocialWeekPlanRow | null> {
  const snap = await getDoc(planRef(db, weekKey));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as SocialWeekPlanDoc) };
}

/**
 * Send the week to the admin. Written with setDoc rather than a merge so a resubmission
 * after "changes requested" drops the previous review — the admin reviews it fresh, and
 * the rules reject a non-admin who tries to carry `reviewed_by` over.
 */
export async function submitSocialWeekPlan(
  db: Firestore,
  weekKey: string,
  uid: string,
): Promise<void> {
  await setDoc(planRef(db, weekKey), {
    week_key: weekKey,
    status: "submitted",
    submitted_by: uid,
    submitted_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
}

/** Pull a week back before the admin has acted on it. */
export async function withdrawSocialWeekPlan(db: Firestore, weekKey: string): Promise<void> {
  await setDoc(planRef(db, weekKey), {
    week_key: weekKey,
    status: "draft",
    updated_at: serverTimestamp(),
  });
}

export async function approveSocialWeekPlan(
  db: Firestore,
  weekKey: string,
  adminUid: string,
): Promise<void> {
  await updateDoc(planRef(db, weekKey), {
    status: "approved",
    reviewed_by: adminUid,
    reviewed_at: serverTimestamp(),
    // A stale "please fix the Friday post" must not outlive the approval.
    review_note: deleteField(),
    updated_at: serverTimestamp(),
  });
}

export async function requestSocialWeekPlanChanges(
  db: Firestore,
  weekKey: string,
  adminUid: string,
  note: string,
): Promise<void> {
  const trimmed = note.trim();
  if (!trimmed) {
    throw new Error("Say what needs changing, so the plan can be fixed.");
  }
  if (trimmed.length > MAX_REVIEW_NOTE_LENGTH) {
    throw new Error(`Keep the note under ${MAX_REVIEW_NOTE_LENGTH} characters.`);
  }
  await updateDoc(planRef(db, weekKey), {
    status: "changes_requested",
    reviewed_by: adminUid,
    reviewed_at: serverTimestamp(),
    review_note: trimmed,
    updated_at: serverTimestamp(),
  });
}

/** Unlock an already-approved week so the plan can be edited again. Admin only. */
export async function reopenSocialWeekPlan(
  db: Firestore,
  weekKey: string,
  adminUid: string,
): Promise<void> {
  await updateDoc(planRef(db, weekKey), {
    status: "draft",
    reviewed_by: adminUid,
    reviewed_at: serverTimestamp(),
    review_note: deleteField(),
    updated_at: serverTimestamp(),
  });
}

/**
 * The manager reopening an approved week to change something. Written whole, like a
 * submission, so the admin's sign-off is erased rather than carried along — the week is no
 * longer the one they approved, and the rules reject a non-admin write that keeps
 * `reviewed_by`. It cannot be posted again until they approve it afresh.
 */
export async function reviseSocialWeekPlan(db: Firestore, weekKey: string): Promise<void> {
  await setDoc(planRef(db, weekKey), {
    week_key: weekKey,
    status: "revising",
    updated_at: serverTimestamp(),
  });
}

/**
 * Every week on the admin's radar: waiting for approval, or approved-then-changed. Filters
 * one field, so it needs no composite index — hence no `orderBy`; callers sort by week key
 * themselves, which is chronological anyway.
 */
export function watchSocialWeekPlansForReview(
  db: Firestore,
  onChange: (plans: SocialWeekPlanRow[]) => void,
  onError: (error: unknown) => void,
): Unsubscribe {
  const q = query(
    collection(db, COLLECTIONS.socialWeekPlans),
    where("status", "in", [...WEEK_PLAN_REVIEW_STATUSES]),
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as SocialWeekPlanDoc),
      }));
      rows.sort((a, b) => a.week_key.localeCompare(b.week_key));
      onChange(rows);
    },
    onError,
  );
}
