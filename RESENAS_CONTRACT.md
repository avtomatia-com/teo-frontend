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

  // Paid-or-trial view — full unanswered queue with Haiku drafts ready
  // for owner approval. null on S0 and FREE.
  pending: ResenaCard[] | null;

  // Recently answered reviews. null on S0 and FREE.
  answered: ResenaCard[] | null;

  // Drives the RESPONDIDAS collapsible preview line. Always present.
  answered_summary: AnsweredSummary;

  // Two-line "Modo · …" chip describing the venue's review_response_mode.
  // null on S0 / S1 / FREE (per spec §31.5 the chip only renders S2+).
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
  // - "high"     → S0 showcase positive card
  // - "low"      → S0 showcase recovery card
  // - "pending"  → paid queue, "Revisar →" CTA visible
  // - "answered" → paid history, no CTA
  kind: "high" | "low" | "pending" | "answered";

  // wa.me deep-link for "Revisar →" — only set when kind === "pending".
  // Frontend should hide the CTA for other kinds.
  cta_href: string | null;
};
```

---

## 3. Mode chip

```ts
type ModeChip = {
  title:    string;   // "Modo · Mixto"
  tagline:  string;   // explanatory line under the title
  cta_href: string;   // wa.me deep-link to "cambiar el modo"
};
```

Mode keys map to:
- `smart_auto`    → "Modo · Aprobar todas"
- `context_aware` → "Modo · Mixto"            (default)
- `full_auto`     → "Modo · Autopilot"
- `manual`        → "Modo · Manual"

---

## 4. State → block visibility

| state           | showcase  | pending      | answered    | mode_chip |
|-----------------|-----------|--------------|-------------|-----------|
| s0              | ✓ (1-2)   | null         | null        | null      |
| s1              | null      | ✓            | ✓           | null      |
| s2 / s3 / s4    | null      | ✓            | ✓           | ✓         |
| paid / paid_clear | null    | ✓            | ✓           | ✓         |
| free            | null      | null         | null        | null      |

`pending` and `answered` are capped at 25 cards each. The frontend should not paginate further — owner approval is a WhatsApp flow.

---

## 5. Notes

- Reviews are pulled via Outscraper (Google Maps Reviews v3), capped at 30 per refresh, and summarised into the `reviews` table at onboarding. Haiku drafts are generated only for the **owner's own venue** — competitors don't get drafts.
- `draft_model` (column on `reviews`) is `"claude-haiku-4-5-20251001"` for everything Haiku-generated. Not exposed in this response.
- `kind` is a UI hint, not a data classification — the same review could appear as `pending` today and `answered` tomorrow.
