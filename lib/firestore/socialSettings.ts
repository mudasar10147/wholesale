import { doc, getDoc, type Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { DEFAULT_SOCIAL_MEDIA_SETTINGS } from "@/lib/social/captions";
import {
  SOCIAL_MEDIA_SETTINGS_DOC_ID,
  type SocialMediaSettingsDoc,
} from "@/lib/types/firestore";

export type SocialMediaSettings = Omit<SocialMediaSettingsDoc, "updated_at">;

/**
 * How captions are worded. Read-only from the app — there is no screen for it, because the
 * two knobs it has are set once and never touched. An admin edits `settings/social_media`
 * from the Firestore console; until they do, the defaults apply.
 */
export async function loadSocialMediaSettings(db: Firestore): Promise<SocialMediaSettings> {
  const snap = await getDoc(doc(db, COLLECTIONS.settings, SOCIAL_MEDIA_SETTINGS_DOC_ID));
  if (!snap.exists()) {
    return DEFAULT_SOCIAL_MEDIA_SETTINGS;
  }
  const data = snap.data() as Partial<SocialMediaSettingsDoc>;
  return {
    footer_line:
      typeof data.footer_line === "string"
        ? data.footer_line
        : DEFAULT_SOCIAL_MEDIA_SETTINGS.footer_line,
    currency_prefix:
      typeof data.currency_prefix === "string"
        ? data.currency_prefix
        : DEFAULT_SOCIAL_MEDIA_SETTINGS.currency_prefix,
  };
}
