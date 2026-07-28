/**
 * Firestore rules tests for the `social` role.
 *
 * Run: npm run test:rules   (boots the Firestore emulator, so it needs Java)
 *
 * The whole point of the social media planner's design is that the social manager can
 * plan WhatsApp content WITHOUT being able to read the business's financials. Firestore
 * rules are all-or-nothing per document, and `sales` / `stock_lots` / `invoice_items`
 * carry customer ids, unit costs, COGS and supplier ids in the same doc as the line data.
 * So the social role is denied all of them, and product suggestions are computed
 * server-side and returned pre-sanitized.
 *
 * These tests exist to make sure that boundary does not quietly regress.
 */

import { after, before, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

let testEnv;

const WEEK_KEY = "2026-W29";

function socialDb() {
  return testEnv.authenticatedContext("social-user", { role: "social" }).firestore();
}
function adminDb() {
  return testEnv.authenticatedContext("admin-user", { admin: true }).firestore();
}
function clerkDb() {
  return testEnv.authenticatedContext("clerk-user", { role: "clerk" }).firestore();
}

function validPost(overrides = {}) {
  return {
    week_key: WEEK_KEY,
    scheduled_date: "2026-07-17",
    scheduled_time: "17:00",
    kind: "best_sellers",
    status: "draft",
    caption: "Products of the week",
    product_ids: ["p1"],
    media_links: [],
    created_by: "social-user",
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "wholesale-rules-test",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });

  // Seed the sensitive collections with the admin bypass so the denial tests below are
  // reading real documents rather than passing because nothing exists.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "sales", "s1"), {
      product_id: "p1",
      quantity: 5,
      customer_id: "c1",
      unit_cost: 40,
      cogs_amount: 200,
      total_amount: 500,
      date: new Date(),
    });
    await setDoc(doc(db, "stock_lots", "l1"), {
      product_id: "p1",
      unit_cost: 40,
      qty_remaining: 10,
      trader_id: "t1",
      purchase_source: "Acme Supplies",
      received_at: new Date(),
    });
    await setDoc(doc(db, "customers", "c1"), { name: "Big Buyer" });
    await setDoc(doc(db, "cash_entries", "ce1"), { amount: 1000 });
    await setDoc(doc(db, "invoices", "i1"), { total_amount: 500 });
    await setDoc(doc(db, "invoice_items", "ii1"), { unit_price: 100, customer_id: "c1" });
    await setDoc(doc(db, "traders", "t1"), { name: "Acme Supplies" });
    await setDoc(doc(db, "settings", "cash"), { opening_balance: 5000 });
    await setDoc(doc(db, "products", "p1"), { name: "Widget", sale_price: 100, cost_price: 40 });
  });
});

after(async () => {
  await testEnv?.cleanup();
});

describe("social role is denied every financial and customer collection", () => {
  // Each of these docs mixes line data with cost, margin, customer or supplier identity.
  for (const path of [
    ["sales", "s1"],
    ["stock_lots", "l1"],
    ["customers", "c1"],
    ["cash_entries", "ce1"],
    ["invoices", "i1"],
    ["invoice_items", "ii1"],
    ["traders", "t1"],
  ]) {
    it(`cannot read ${path[0]}`, async () => {
      await assertFails(getDoc(doc(socialDb(), path[0], path[1])));
    });
  }

  it("cannot read settings/cash", async () => {
    await assertFails(getDoc(doc(socialDb(), "settings", "cash")));
  });

  it("cannot write to products", async () => {
    await assertFails(setDoc(doc(socialDb(), "products", "p1"), { name: "Hacked" }));
  });
});

describe("social role can run the planner", () => {
  it("can read products (needed to pick what to share)", async () => {
    await assertSucceeds(getDoc(doc(socialDb(), "products", "p1")));
  });

  it("can create and read a social post", async () => {
    await assertSucceeds(setDoc(doc(socialDb(), "social_posts", "sp1"), validPost()));
    await assertSucceeds(getDoc(doc(socialDb(), "social_posts", "sp1")));
  });

  it("can create an offer", async () => {
    await assertSucceeds(
      setDoc(doc(socialDb(), "social_offers", "so1"), {
        title: "Clearance week",
        discount_type: "percent",
        discount_value: 10,
        product_ids: ["p1"],
        starts_on: "2026-07-13",
        ends_on: "2026-07-19",
        is_active: true,
        created_by: "social-user",
        created_at: new Date(),
        updated_at: new Date(),
      }),
    );
  });

  it("can write the weekly notepad", async () => {
    await assertSucceeds(
      setDoc(doc(socialDb(), "social_notes", WEEK_KEY), {
        week_key: WEEK_KEY,
        body: "Push the slow movers on Monday.",
        updated_by: "social-user",
        updated_at: new Date(),
      }),
    );
  });

  it("can read and write its own settings doc", async () => {
    const settings = {
      footer_line: "Limited stock | Order now",
      currency_prefix: "Rs.",
      updated_at: new Date(),
    };
    await assertSucceeds(setDoc(doc(socialDb(), "settings", "social_media"), settings));
    await assertSucceeds(getDoc(doc(socialDb(), "settings", "social_media")));
  });

  // The recurring-slot planner is gone; its fields must not sneak back into the doc.
  it("rejects the retired recurring-slot settings fields", async () => {
    await assertFails(
      setDoc(doc(socialDb(), "settings", "social_media"), {
        footer_line: "Limited stock | Order now",
        currency_prefix: "Rs.",
        recurring_slots: [{ day: "fri", time: "17:00", kind: "best_sellers", count: 5 }],
        updated_at: new Date(),
      }),
    );
  });
});

describe("social post validation", () => {
  it("rejects an unknown status", async () => {
    await assertFails(
      setDoc(doc(socialDb(), "social_posts", "bad1"), validPost({ status: "published" })),
    );
  });

  it("rejects an unknown kind", async () => {
    await assertFails(
      setDoc(doc(socialDb(), "social_posts", "bad2"), validPost({ kind: "tiktok" })),
    );
  });

  it("accepts every post kind, including hand-picked products", async () => {
    const kinds = [
      "products",
      "random",
      "best_sellers",
      "aging_stock",
      "new_arrivals",
      "offer",
      "custom",
    ];
    for (const kind of kinds) {
      await assertSucceeds(
        setDoc(doc(socialDb(), "social_posts", `kind-${kind}`), validPost({ kind })),
      );
    }
  });

  it("accepts every post format", async () => {
    for (const format of ["text", "image", "image_text", "video", "video_text"]) {
      await assertSucceeds(
        setDoc(doc(socialDb(), "social_posts", `fmt-${format}`), validPost({ format })),
      );
    }
  });

  // Posts written before formats existed carry no `format` — a status toggle on one of
  // those must not start failing.
  it("accepts a post with no format at all", async () => {
    await assertSucceeds(
      setDoc(doc(socialDb(), "social_posts", "fmt-legacy"), validPost()),
    );
  });

  it("rejects an unknown format", async () => {
    await assertFails(
      setDoc(doc(socialDb(), "social_posts", "bad-fmt"), validPost({ format: "carousel" })),
    );
  });

  it("rejects an unexpected extra field", async () => {
    await assertFails(
      setDoc(doc(socialDb(), "social_posts", "bad3"), validPost({ cost_price: 40 })),
    );
  });

  // "17/07/2026" is also 10 characters long, so a size() check would let it through.
  it("rejects a malformed date of the right length", async () => {
    await assertFails(
      setDoc(doc(socialDb(), "social_posts", "bad4"), validPost({ scheduled_date: "17/07/2026" })),
    );
  });

  it("rejects a malformed time of the right length", async () => {
    await assertFails(
      setDoc(doc(socialDb(), "social_posts", "bad5"), validPost({ scheduled_time: "5:30p" })),
    );
  });

  it("rejects an out-of-range hour", async () => {
    await assertFails(
      setDoc(doc(socialDb(), "social_posts", "bad6"), validPost({ scheduled_time: "99:00" })),
    );
  });

  it("rejects a malformed week key", async () => {
    await assertFails(
      setDoc(doc(socialDb(), "social_posts", "bad7"), validPost({ week_key: "2026-29xx" })),
    );
  });

  it("rejects an offer whose end date precedes its start date", async () => {
    await assertFails(
      setDoc(doc(socialDb(), "social_offers", "bad8"), {
        title: "Backwards",
        discount_type: "percent",
        discount_value: 10,
        product_ids: [],
        starts_on: "2026-07-19",
        ends_on: "2026-07-13",
        is_active: true,
        created_by: "social-user",
        created_at: new Date(),
        updated_at: new Date(),
      }),
    );
  });

  /**
   * A sitewide sale is the `applies_to_all` flag, never a longer product_ids array — the
   * 100 cap still holds, and in that mode the list reads as exclusions instead.
   */
  function offerDoc(over = {}) {
    return {
      title: "Azadi Sale",
      discount_type: "percent",
      discount_value: 10,
      product_ids: [],
      starts_on: "2026-08-01",
      ends_on: "2026-08-31",
      is_active: true,
      created_by: "social-user",
      created_at: new Date(),
      updated_at: new Date(),
      ...over,
    };
  }

  it("accepts a sitewide offer", async () => {
    await assertSucceeds(
      setDoc(doc(socialDb(), "social_offers", "site1"), offerDoc({ applies_to_all: true })),
    );
  });

  it("accepts a sitewide offer that opts new arrivals in", async () => {
    await assertSucceeds(
      setDoc(
        doc(socialDb(), "social_offers", "site2"),
        offerDoc({ applies_to_all: true, includes_new_arrivals: true }),
      ),
    );
  });

  it("accepts a sitewide offer carrying an exclusion list", async () => {
    await assertSucceeds(
      setDoc(
        doc(socialDb(), "social_offers", "site3"),
        offerDoc({ applies_to_all: true, product_ids: ["p1", "p2"] }),
      ),
    );
  });

  // The guarantee that let the rules be deployed ahead of the app code.
  it("still accepts an offer carrying neither new flag", async () => {
    await assertSucceeds(setDoc(doc(socialDb(), "social_offers", "site4"), offerDoc()));
  });

  it("rejects a non-boolean applies_to_all", async () => {
    await assertFails(
      setDoc(doc(socialDb(), "social_offers", "bad9"), offerDoc({ applies_to_all: "yes" })),
    );
  });

  it("rejects a non-boolean includes_new_arrivals", async () => {
    await assertFails(
      setDoc(doc(socialDb(), "social_offers", "bad10"), offerDoc({ includes_new_arrivals: 1 })),
    );
  });

  // Proves hasOnlyKeys was not loosened while the two new keys were added.
  it("still rejects an unknown extra key", async () => {
    await assertFails(
      setDoc(doc(socialDb(), "social_offers", "bad11"), offerDoc({ all_products: true })),
    );
  });

  it("still caps product_ids at 100, even for a sitewide offer", async () => {
    await assertFails(
      setDoc(
        doc(socialDb(), "social_offers", "bad12"),
        offerDoc({
          applies_to_all: true,
          product_ids: Array.from({ length: 101 }, (_, i) => `p${i}`),
        }),
      ),
    );
  });

  it("rejects a notepad doc whose week_key does not match its id", async () => {
    await assertFails(
      setDoc(doc(socialDb(), "social_notes", "2026-W30"), {
        week_key: WEEK_KEY,
        body: "mismatched",
        updated_by: "social-user",
        updated_at: new Date(),
      }),
    );
  });
});

describe("the other roles", () => {
  it("clerks cannot touch the planner — it is not theirs", async () => {
    await assertFails(getDoc(doc(clerkDb(), "social_posts", "sp1")));
    await assertFails(setDoc(doc(clerkDb(), "social_posts", "sp2"), validPost()));
  });

  it("admins retain full access to the planner", async () => {
    await assertSucceeds(getDoc(doc(adminDb(), "social_posts", "sp1")));
    await assertSucceeds(
      setDoc(doc(adminDb(), "social_posts", "sp3"), validPost({ created_by: "admin-user" })),
    );
  });

  it("admins still read the collections the social role cannot", async () => {
    await assertSucceeds(getDoc(doc(adminDb(), "sales", "s1")));
    await assertSucceeds(getDoc(doc(adminDb(), "stock_lots", "l1")));
  });
});

/**
 * The weekly approval loop. The social manager builds a week and submits it; an admin
 * approves it before any of it goes out. Each scenario gets its own week, because the
 * emulator is not cleared between tests and one week's status is another's precondition.
 */
describe("weekly approval", () => {
  const SUBMITTED = "2026-W30";
  const APPROVED = "2026-W31";
  const OPEN = "2026-W32";
  const CHANGES = "2026-W33";
  const WITHDRAW = "2026-W34";
  const FRESH = "2026-W35";
  const TO_APPROVE = "2026-W36";

  before(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const plan = (weekKey, status) =>
        setDoc(doc(db, "social_week_plans", weekKey), {
          week_key: weekKey,
          status,
          updated_at: new Date(),
        });
      const post = (id, weekKey) =>
        setDoc(doc(db, "social_posts", id), validPost({ week_key: weekKey }));

      await Promise.all([
        plan(SUBMITTED, "submitted"),
        plan(APPROVED, "approved"),
        plan(CHANGES, "changes_requested"),
        plan(WITHDRAW, "submitted"),
        plan(TO_APPROVE, "submitted"),
        post("sp-submitted", SUBMITTED),
        post("sp-approved", APPROVED),
        post("sp-open", OPEN),
      ]);
    });
  });

  it("the social manager can send a week for approval", async () => {
    await assertSucceeds(
      setDoc(doc(socialDb(), "social_week_plans", FRESH), {
        week_key: FRESH,
        status: "submitted",
        submitted_by: "social-user",
        submitted_at: new Date(),
        updated_at: new Date(),
      }),
    );
  });

  it("the social manager can resubmit a week that was sent back", async () => {
    await assertSucceeds(
      setDoc(doc(socialDb(), "social_week_plans", CHANGES), {
        week_key: CHANGES,
        status: "submitted",
        submitted_by: "social-user",
        submitted_at: new Date(),
        updated_at: new Date(),
      }),
    );
  });

  it("the social manager can withdraw a week the admin has not acted on", async () => {
    await assertSucceeds(
      setDoc(doc(socialDb(), "social_week_plans", WITHDRAW), {
        week_key: WITHDRAW,
        status: "draft",
        updated_at: new Date(),
      }),
    );
  });

  // The whole point of the loop: the manager cannot wave their own week through.
  it("the social manager cannot approve their own week", async () => {
    await assertFails(
      updateDoc(doc(socialDb(), "social_week_plans", SUBMITTED), {
        status: "approved",
        updated_at: new Date(),
      }),
    );
  });

  it("the social manager cannot forge the admin's sign-off", async () => {
    await assertFails(
      setDoc(doc(socialDb(), "social_week_plans", SUBMITTED), {
        week_key: SUBMITTED,
        status: "submitted",
        submitted_by: "social-user",
        submitted_at: new Date(),
        reviewed_by: "admin-user",
        reviewed_at: new Date(),
        updated_at: new Date(),
      }),
    );
  });

  it("the social manager cannot submit a week in somebody else's name", async () => {
    await assertFails(
      setDoc(doc(socialDb(), "social_week_plans", "2026-W37"), {
        week_key: "2026-W37",
        status: "submitted",
        submitted_by: "someone-else",
        submitted_at: new Date(),
        updated_at: new Date(),
      }),
    );
  });

  it("an admin approves the week", async () => {
    await assertSucceeds(
      updateDoc(doc(adminDb(), "social_week_plans", TO_APPROVE), {
        status: "approved",
        reviewed_by: "admin-user",
        reviewed_at: new Date(),
        updated_at: new Date(),
      }),
    );
  });

  it("a week submitted for review is frozen — no adding, editing or deleting posts", async () => {
    await assertFails(
      setDoc(doc(socialDb(), "social_posts", "sp-new-locked"), validPost({ week_key: SUBMITTED })),
    );
    await assertFails(
      updateDoc(doc(socialDb(), "social_posts", "sp-submitted"), {
        caption: "Sneaking a change past the admin",
        updated_at: new Date(),
      }),
    );
    await assertFails(deleteDoc(doc(socialDb(), "social_posts", "sp-submitted")));
  });

  it("an approved week still takes 'I have posted this'", async () => {
    await assertSucceeds(
      updateDoc(doc(socialDb(), "social_posts", "sp-approved"), {
        status: "posted",
        posted_at: new Date(),
        updated_at: new Date(),
      }),
    );
  });

  it("an approved week does not take a content change", async () => {
    await assertFails(
      updateDoc(doc(socialDb(), "social_posts", "sp-approved"), {
        caption: "Different words than the admin approved",
        updated_at: new Date(),
      }),
    );
    await assertFails(
      updateDoc(doc(socialDb(), "social_posts", "sp-approved"), {
        product_ids: ["p1", "p2"],
        updated_at: new Date(),
      }),
    );
  });

  it("a week nobody has submitted is open for editing", async () => {
    await assertSucceeds(
      setDoc(doc(socialDb(), "social_posts", "sp-open-2"), validPost({ week_key: OPEN })),
    );
    await assertSucceeds(
      updateDoc(doc(socialDb(), "social_posts", "sp-open"), {
        caption: "Still a draft, still editable",
        updated_at: new Date(),
      }),
    );
  });

  it("a post cannot be smuggled out of a locked week into an open one", async () => {
    await assertFails(
      updateDoc(doc(socialDb(), "social_posts", "sp-submitted"), {
        week_key: OPEN,
        updated_at: new Date(),
      }),
    );
  });

  it("an admin is never locked out — they are the one who unlocks it", async () => {
    await assertSucceeds(
      updateDoc(doc(adminDb(), "social_posts", "sp-submitted"), {
        caption: "Admin fixing a typo during review",
        updated_at: new Date(),
      }),
    );
    await assertSucceeds(
      updateDoc(doc(adminDb(), "social_week_plans", SUBMITTED), {
        status: "changes_requested",
        reviewed_by: "admin-user",
        reviewed_at: new Date(),
        review_note: "Drop the out-of-stock items from Friday.",
        updated_at: new Date(),
      }),
    );
  });
});

/**
 * Changing an approved week costs it its approval. The manager may reopen it, but the week
 * drops out of `approved`, so nothing more can go out until an admin signs it off again —
 * that is the whole guarantee, and it is enforced here rather than in the UI.
 */
describe("revising an approved week", () => {
  const TO_REVISE = "2026-W40";
  const REVISING = "2026-W41";
  const APPROVED_STILL = "2026-W42";

  before(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const plan = (weekKey, status, extra = {}) =>
        setDoc(doc(db, "social_week_plans", weekKey), {
          week_key: weekKey,
          status,
          updated_at: new Date(),
          ...extra,
        });

      await Promise.all([
        plan(TO_REVISE, "approved", { reviewed_by: "admin-user", reviewed_at: new Date() }),
        plan(REVISING, "revising"),
        plan(APPROVED_STILL, "approved"),
        setDoc(doc(db, "social_posts", "sp-revising"), validPost({ week_key: REVISING })),
        setDoc(doc(db, "social_posts", "sp-approved-still"), validPost({ week_key: APPROVED_STILL })),
      ]);
    });
  });

  it("the social manager can reopen an approved week to change it", async () => {
    // Written whole, so the admin's sign-off is dropped rather than carried along — the
    // week is no longer the one they approved.
    await assertSucceeds(
      setDoc(doc(socialDb(), "social_week_plans", TO_REVISE), {
        week_key: TO_REVISE,
        status: "revising",
        updated_at: new Date(),
      }),
    );
  });

  it("reopening does not let the manager keep the admin's sign-off on the doc", async () => {
    await assertFails(
      setDoc(doc(socialDb(), "social_week_plans", APPROVED_STILL), {
        week_key: APPROVED_STILL,
        status: "revising",
        reviewed_by: "admin-user",
        reviewed_at: new Date(),
        updated_at: new Date(),
      }),
    );
  });

  it("a week being revised is editable again", async () => {
    await assertSucceeds(
      updateDoc(doc(socialDb(), "social_posts", "sp-revising"), {
        caption: "Reworded now that the week is open again",
        updated_at: new Date(),
      }),
    );
    await assertSucceeds(
      setDoc(doc(socialDb(), "social_posts", "sp-revising-new"), validPost({ week_key: REVISING })),
    );
    await assertSucceeds(deleteDoc(doc(socialDb(), "social_posts", "sp-revising-new")));
  });

  it("a revised week must go back through the admin — the manager cannot re-approve it", async () => {
    await assertFails(
      updateDoc(doc(socialDb(), "social_week_plans", REVISING), {
        status: "approved",
        updated_at: new Date(),
      }),
    );
    await assertFails(
      setDoc(doc(socialDb(), "social_week_plans", REVISING), {
        week_key: REVISING,
        status: "approved",
        reviewed_by: "admin-user",
        reviewed_at: new Date(),
        updated_at: new Date(),
      }),
    );
  });

  it("a revised week can be sent back for approval", async () => {
    await assertSucceeds(
      setDoc(doc(socialDb(), "social_week_plans", REVISING), {
        week_key: REVISING,
        status: "submitted",
        submitted_by: "social-user",
        submitted_at: new Date(),
        updated_at: new Date(),
      }),
    );
  });

  // The manager must go through `revising` — they cannot edit an approved week in place.
  it("an approved week is still frozen until it is reopened", async () => {
    await assertFails(
      updateDoc(doc(socialDb(), "social_posts", "sp-approved-still"), {
        caption: "Changed without telling the admin",
        updated_at: new Date(),
      }),
    );
  });

  it("the manager cannot jump an approved week straight to draft, skipping re-approval", async () => {
    await assertFails(
      setDoc(doc(socialDb(), "social_week_plans", APPROVED_STILL), {
        week_key: APPROVED_STILL,
        status: "draft",
        updated_at: new Date(),
      }),
    );
  });
});
