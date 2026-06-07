import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  DEFAULT_GLOBAL_TARGET_MARGIN_PERCENT,
  PRICING_SETTINGS_DOC_ID,
  type CategoryMarginTemplate,
  type PricingMode,
  type PricingSettingsDoc,
} from "@/lib/types/firestore";

export type PricingSettingsData = {
  globalDefaultTargetMarginPercent: number;
  categoryTemplates: Record<string, CategoryMarginTemplate>;
};

function defaultSettings(): PricingSettingsData {
  return {
    globalDefaultTargetMarginPercent: DEFAULT_GLOBAL_TARGET_MARGIN_PERCENT,
    categoryTemplates: {},
  };
}

function parseSettingsDoc(raw: PricingSettingsDoc | undefined): PricingSettingsData {
  if (!raw) return defaultSettings();
  const global =
    typeof raw.global_default_target_margin_percent === "number" &&
    Number.isFinite(raw.global_default_target_margin_percent)
      ? raw.global_default_target_margin_percent
      : DEFAULT_GLOBAL_TARGET_MARGIN_PERCENT;
  const templates =
    raw.category_templates && typeof raw.category_templates === "object"
      ? { ...raw.category_templates }
      : {};
  return {
    globalDefaultTargetMarginPercent: global,
    categoryTemplates: templates,
  };
}

export async function loadPricingSettings(db: Firestore): Promise<PricingSettingsData> {
  const snap = await getDoc(doc(db, COLLECTIONS.settings, PRICING_SETTINGS_DOC_ID));
  if (!snap.exists()) return defaultSettings();
  return parseSettingsDoc(snap.data() as PricingSettingsDoc);
}

async function savePricingSettings(
  db: Firestore,
  data: PricingSettingsData,
): Promise<void> {
  const payload: Omit<PricingSettingsDoc, "updated_at"> & { updated_at: unknown } = {
    global_default_target_margin_percent: data.globalDefaultTargetMarginPercent,
    category_templates: data.categoryTemplates,
    updated_at: serverTimestamp(),
  };
  await setDoc(doc(db, COLLECTIONS.settings, PRICING_SETTINGS_DOC_ID), payload, {
    merge: true,
  });
}

export async function saveGlobalDefaultMargin(
  db: Firestore,
  marginPercent: number,
): Promise<void> {
  if (
    typeof marginPercent !== "number" ||
    !Number.isFinite(marginPercent) ||
    marginPercent < 0 ||
    marginPercent >= 100
  ) {
    throw new Error("Target margin must be between 0 and 100 (exclusive).");
  }
  const current = await loadPricingSettings(db);
  await savePricingSettings(db, {
    ...current,
    globalDefaultTargetMarginPercent: marginPercent,
  });
}

export async function upsertCategoryTemplate(
  db: Firestore,
  category: string,
  template: CategoryMarginTemplate,
): Promise<void> {
  const cat = category.trim();
  if (!cat) throw new Error("Category is required.");
  validateTemplate(template);
  const current = await loadPricingSettings(db);
  await savePricingSettings(db, {
    ...current,
    categoryTemplates: { ...current.categoryTemplates, [cat]: template },
  });
}

export async function removeCategoryTemplate(
  db: Firestore,
  category: string,
): Promise<void> {
  const cat = category.trim();
  const current = await loadPricingSettings(db);
  const next = { ...current.categoryTemplates };
  delete next[cat];
  await savePricingSettings(db, { ...current, categoryTemplates: next });
}

function validateTemplate(template: CategoryMarginTemplate): void {
  const m = template.target_margin_percent;
  if (typeof m !== "number" || !Number.isFinite(m) || m < 0 || m >= 100) {
    throw new Error("Target margin must be between 0 and 100 (exclusive).");
  }
  if (template.pricing_mode !== "manual" && template.pricing_mode !== "automatic") {
    throw new Error("Pricing mode must be manual or automatic.");
  }
}

export function getCategoryTemplate(
  settings: PricingSettingsData,
  category: string | undefined,
): CategoryMarginTemplate | null {
  const cat = category?.trim();
  if (!cat) return null;
  return settings.categoryTemplates[cat] ?? null;
}

export type { PricingMode };
