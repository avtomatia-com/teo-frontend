# Reseñas Tab — API Contract

**Endpoint:** `GET /portal/{venue_slug}/resenas`
**Auth:** magic-link cookie (same scheme as `/resumen` — see RESUMEN_CONTRACT.md §1).
**Status:** locked 2026-04-30 — backend implemented, ready for frontend wiring.

The Reseñas tab is **read-only**. Owners approve/edit drafts in WhatsApp, never in the portal (spec v23 §31.5: "Approve-in-portal is not supported"). Every actionable card on this tab deep-links into a wa.me message.

---

## 1. Top-level response shape

```ts
type ResenasResponse = {
  state: "s0" | "s1" | "s2" | "s3" | "s4" | "paid" | "paid_clear" | "free";
  venue: VenueIdentity;          // same shape as /resumen

  // Top-of-tab GOOGLE collapsible — own venue rating, distribution,
  // destacan/quejas. Always present.
  google_summary: GoogleSummary;

  // S0 only — single-card "Así respondería Teo" preview: the most urgent
  // unanswered drafted review (lowest stars first, then most recent), to
  // mirror the Resumen action CTA. null on S1+/paid/free. Empty array
  // means S0 but no drafts exist yet.
  showcase: ResenaCard[] | null;

  // Mode B (context_aware) "Necesitan tu contexto" surface — reviews the
  // owner must clarify before Teo can draft. null when nothing needs
  // surfacing (frontend hides the section entirely). Returned for S1 and
  // for S2+ in context_aware mode; null in manual_approve mode (the full
  // queue lives in `pending`).
  needs_context: ResenaCard[] | null;

  // S1-only "APROBAR MODO SEMI-AUTOMÁTICO" CTA section. Shown when a
  // venue is post-OAuth but pre-mode-approval and there's at least one
  // auto-publish-eligible draft. null in any other state, including
  // when the owner has already activated semi-auto.
  auto_publish_section: AutoPublishSection | null;

  // Mode A (manual_approve) view — full unanswered queue with Haiku
  // drafts and per-row "Aprobar" CTAs. null in context_aware mode (where
  // `needs_context` is the action surface) and on S0/S1/FREE.
  pending: ResenaCard[] | null;

  // Recently answered reviews. null on S0 and FREE.
  answered: ResenaCard[] | null;

  // Drives the RESPONDIDAS collapsible preview line. Always present.
  answered_summary: AnsweredSummary;

  // Two-line "Modo · …" chip describing the venue's review_response_mode.
  // Renders from S1+ now (was S2+) — owners need to see/change mode at
  // any state where review handling is live. null on S0 and FREE.
  mode_chip: ModeChip | null;

  meta: {
    generated_at: string;        // ISO 8601 UTC
    review_count: number;        // total reviews loaded for this venue
  };
};

type GoogleSummary = {
  google_rating:       number;          // 0..5, one decimal
  star_row:            string;          // 5 chars, ★+☆
  google_review_count: number;          // venues.google_review_count
  new_this_month:      number;          // count of reviews ≤ 30 days old
  star_distribution:   Array<{ stars: 1|2|3|4|5; pct: number }>;
  destacan:            string | null;   // venues.review_summary_destacan
  quejas:              string | null;   // venues.review_summary_quejas
};

type AnsweredSummary = {
  count:      number;          // reviews where owner_responded = true
  last_date:  string | null;   // ISO 8601 — most recent answered review_date
  days_since: number | null;   // days from last_date to now
};
```

---

## 2. Reseña card

```ts
type ResenaCard = {
  id:                string;              // reviews.id (UUID)
  reviewer_name:     string;              // "Anónimo" if missing
  reviewer_language: string | null;       // ISO code, may be null
  star_rating:       1 | 2 | 3 | 4 | 5;   // rounded
  star_row:          string;              // 5 chars, ★ + ☆ — render as-is
  review_text:       string;              // may be empty for star-only reviews
  review_date:       string | null;       // ISO 8601 UTC

  // Haiku draft. Always present in pending/showcase, may be null in
  // answered if the original response wasn't drafted by Teo.
  draft_text:        string | null;

  // Discriminator for layout variants:
  // - "high"          → S0 showcase positive card
  // - "low"           → S0 showcase recovery card
  // - "pending"       → manual_approve queue, "Revisar →" CTA visible
  // - "needs_context" → Mode B context-needed card, "Revisar →" CTA visible
  // - "answered"      → paid history, no CTA
  kind: "high" | "low" | "pending" | "needs_context" | "answered";

  // Deep-link for the per-row CTA — set when kind is "pending" or
  // "needs_context". Frontend should hide the CTA for other kinds. Base
  // is configurable: wa.me/<num> in prod, t.me/<bot> in test envs (env
  // var OWNER_CHAT_DEEP_LINK_BASE on the backend).
  cta_href: string | null;
};
```

---

## 3. Auto-publish section (S1)

```ts
type AutoPublishSection = {
  count:     number;   // # of unanswered reviews eligible for auto-publish
  title:     string;   // "MODO SEMI-AUTOMÁTICO"
  body:      string;   // explanatory paragraph about semi-auto behaviour
  cta_label: string;   // "APROBAR MODO SEMI-AUTOMÁTICO"
  cta_href:  string;   // deep-link that pre-loads the chat trigger phrase
};
```

Tapping the CTA routes the owner into chat with Teo, who re-explains the
semi-auto behaviour and asks for explicit confirmation (or "modo manual").
On confirmation the backend flips `reviews_feature_state='in_progress'`
and `review_response_mode='context_aware'` (or `manual_approve`), then
sends a fresh portal magic link. State transitions S1 → S2.

---

## 4. Mode chip

```ts
type ModeChip = {
  title:    string;   // "Modo · Semi-automático"
  tagline:  string;   // explanatory line under the title
  cta_href: string;   // deep-link to "cambiar el modo"
};
```

Mode keys map to:
- `manual_approve` → "Modo · Manual"           (renamed from `smart_auto`)
- `context_aware`  → "Modo · Semi-automático"  (default)
- `full_auto`      → "Modo · Autopilot"        (currently inactive — kept in enum, never set by user flows)

The legacy `manual` enum value was dropped; any prior `manual` rows were
migrated to `manual_approve`.

---

## 5. State → block visibility

| state           | showcase  | needs_context     | auto_publish | pending             | answered | mode_chip |
|-----------------|-----------|-------------------|--------------|---------------------|----------|-----------|
| s0              | ✓ (1)     | null              | null         | null                | null     | null      |
| s1              | null      | ✓ (or null)       | ✓ (or null)  | null                | ✓        | ✓         |
| s2/s3/s4 (Mode B) | null    | ✓ (or null)       | null         | null                | ✓        | ✓         |
| s2/s3/s4 (Mode A) | null    | null              | null         | ✓                   | ✓        | ✓         |
| paid (Mode B)   | null      | ✓ (or null)       | null         | null                | ✓        | ✓         |
| paid (Mode A)   | null      | null              | null         | ✓                   | ✓        | ✓         |
| paid_clear      | null      | null              | null         | null                | ✓        | ✓         |
| free            | null      | null              | null         | null                | null     | null      |

Notes:
- `needs_context` is `null` (not `[]`) when no rows would render — the frontend hides the section entirely instead of showing an empty header.
- `auto_publish_section` is `null` once the owner has approved semi-auto (`reviews_feature_state='in_progress'`).
- `pending` and `answered` are capped at 25 cards. The frontend should not paginate further — owner approval is a chat flow.

---

## 6. Notes

- Reviews are pulled via Outscraper (Google Maps Reviews v3), capped at 30 per refresh, and summarised into the `reviews` table at onboarding. Haiku drafts are generated only for the **owner's own venue** — competitors don't get drafts.
- `draft_model` (column on `reviews`) is `"claude-haiku-4-5-20251001"` for everything Haiku-generated. Not exposed in this response.
- `kind` is a UI hint, not a data classification — the same review could appear as `pending` today and `answered` tomorrow.
