# Resumen Tab — API Contract

**Endpoint:** `GET /portal/{venue_slug}/resumen`
**Auth:** magic-link cookie (HttpOnly, scoped to `app.teo.chat`, see spec §31.13)
**Status:** locked — ready for step 2 (endpoint implementation).
**Scope:** Resumen tab only. Reseñas / Calendario / Chatbot / FAQ / Settings will get their own contracts in later steps.

`venue_slug` (not `venue_id`) is the public identifier; internal UUIDs are never exposed in URLs (§31.13).

---

## 1. Top-level response shape

```ts
type ResumenResponse = {
  // Render-mode driver — the front-end reads this and writes it to body[data-state]
  // (see §31.5 progressive-rendering table). All eight values are valid.
  state: "s0" | "s1" | "s2" | "s3" | "s4" | "paid" | "paid_clear" | "free";

  // Static venue identity — top-bar wordmark + venue tag
  venue: VenueIdentity;

  // Section 1 of Resumen scroll — Weekly Delta Widget. Null on S0 (no history yet).
  weekly_delta: WeeklyDeltaPaid | WeeklyDeltaPaidClear | WeeklyDeltaFree | null;

  // Section 2 — Zone 1 "TU POSICIÓN" card. Always present.
  zone1: Zone1;

  // Section 3 — Zone 2 "COMPETIDORES". Always present, both buckets returned;
  // front-end decides Otros' default-collapsed state.
  competitors: {
    direct:  CompetitorBucket;       // always rendered
    other:   CompetitorBucket;       // collapsed by default per §31.5
  };

  // Section 4 — single action CTA, variant per state. See §31.5.
  action_cta: ActionCta;

  // Section 5 — "PENDIENTE DE ACTIVAR" (declined-feature reactivation, paid only).
  // Null on FREE FOMO and on S0–S4 (no declined features pre-conversion).
  pendiente_activar: PendingFeature[] | null;

  // NOTE: the Foreign Patron Visibility Widget specified in §31.5 is OUT OF MVP SCOPE.
  // No field on this response, no derived table built. Revisit post-MVP.

  // Diagnostic / progressive-state metadata. Not rendered, but useful for
  // PostHog `portal_opened` event properties and for future analytics.
  meta: ResumenMeta;
};
```

---

## 2. Venue identity

```ts
type VenueIdentity = {
  venue_slug:        string;   // venues.venue_slug (UNIQUE)
  name:              string;   // venues.name — used in topbar `.venue-tag`
  subscription_tier: "gratis" | "tapa" | "racion" | "menu";
  payment_state:     "pending" | "active" | "past_due" | "cancelled";
  // ISO date — used downstream for "días desde el alta" framing if needed.
  // For MVP the front-end probably doesn't render this directly.
  onboarding_completed_at: string | null;
};
```

| Field | Source |
|---|---|
| `venue_slug` | `venues.venue_slug` |
| `name` | `venues.name` |
| `subscription_tier` | `venues.subscription_tier` |
| `payment_state` | `venues.payment_state` |
| `onboarding_completed_at` | `venues.onboarding_completed_at` |

---

## 3. Weekly Delta Widget — three variants (§31.11)

Three mutually-exclusive shapes; the `variant` discriminator selects which the renderer uses. **Null on S0** (no week of history exists yet — placeholder copy was deleted in v23, see §31.5).

```ts
// Variant A — paid value-receipt (any paid state with concrete things Teo did this week).
type WeeklyDeltaPaid = {
  variant:        "paid";
  iso_week:       number;            // 1..53 — drives "Sem. 15"
  month_label:    string;            // localised short month, e.g. "Abr"
  // Left column "TEO HIZO" — exactly 3 bullet rows in the mockup.
  teo_hizo:       { text: string }[];
  // Right column "RESULTADOS" — 1..N short metric lines, each rendered VT323 17px.
  resultados:     { text: string; sign: "pos" | "neg" | "neutral" }[];
  // Single full-width comparative line below the two columns.
  comparative:    string | null;     // e.g. "Bar La Paloma respondió 12 · tú 8 con Teo"
};

// Variant B — paid all-clear. Same structure, compressed.
type WeeklyDeltaPaidClear = {
  variant:        "paid_clear";
  iso_week:       number;
  month_label:    string;
  teo_hizo:       { text: string }[];
  resultados:     { text: string; sign: "pos" | "neg" | "neutral" }[];
  // Bottom line replaces `comparative` — see §31.11.
  all_clear_line: string;            // e.g. "✓ Todo al día · No te necesito esta semana"
  // Collapsible "Teo va a responder →" preview — 0..3 next-up drafts.
  queued_drafts_preview: { reviewer_name: string; star_rating: number; preview: string }[];
};

// Variant C — FREE FOMO. Red halftone, named-competitor anchor (§31.11).
type WeeklyDeltaFree = {
  variant:          "free";
  iso_week:         number;
  month_label:      string;
  // Big VT323 anchor headline, named competitor.
  headline:         string;          // e.g. "Bar La Paloma sigue ganando terreno"
  // 4-row trend table — last 4 weeks, venue vs anchor competitor.
  trend_rows:       {
    week_label:     string;          // "Semana 1"
    own_rating:     number;
    competitor_rating: number;
  }[];
  competitor_name:  string;          // anchor competitor for headline + trend
  // One Claude-generated insight line.
  insight:          string;
};
```

| Field | Source (MVP / when WF4 lands) |
|---|---|
| `variant` | derived from `state` + `subscription_tier` + pending-task count |
| `iso_week`, `month_label` | server clock (Europe/Madrid) at request time |
| `teo_hizo[]` | aggregations from `reviews.posted_at`, `scheduled_posts.published_at`, `whatsapp_interactions.count` over the last 7 days |
| `resultados[]` | diff of current vs previous-Monday snapshot of `venues.google_rating` and `venues.google_review_count` |
| `comparative` | top-1 competitor (`venue_competitors.bucket='direct'` joined with `venues`) — name + same metric |
| `headline` (FREE) | hand-templated against the anchor competitor name |
| `trend_rows` (FREE) | 4-week history from `portal_weekly_delta` derived table once WF4 starts writing it; placeholder until then |
| `insight` (FREE) | Claude Sonnet generation, written by WF4 |

**Progressive availability (§31.5 / §31.11):**
- **S0** — `weekly_delta = null`. No widget rendered.
- **S1** before first Monday post-onboarding — `weekly_delta = null` for now (the v21 "Tu primer resumen aparecerá el próximo lunes" placeholder was deleted in v23).
- **S2+ paid / paid_clear / free** — populated once WF4 has run at least once.

> **MVP shortcut:** until WF4 ships, the endpoint can return `weekly_delta = null` for every state. The Resumen tab continues to render correctly without the widget.

---

## 4. Zone 1 — Tu posición (§31.5)

```ts
type Zone1 = {
  // Left block — venue meta
  occasion_label:    string;         // e.g. "Cena", "Desayuno", "Bar de copas"
                                     //   — copy form derived from occasion_type (§31.3)
  price_tier:        "€" | "€€" | "€€€" | "€€€€" | null;
  neighbourhood:     string;         // e.g. "Malasaña"

  // Right block — rating readout
  google_rating:     number;         // 1 decimal, e.g. 4.2
  star_row:          string;         // pre-rendered "★★★★☆" (server picks based on rating)
  google_review_count: number;

  // Below-card ranking line + callouts
  ranking: {
    own_rank:        number;         // 1-indexed
    bucket_size:     number;         // total venues in the ranking (own + direct competitors)
  };
  callouts: {
    up:   { label: string; metric: string } | null;  // "Mejor en" + "volumen de reseñas (+42%)"
    down: { label: string; metric: string } | null;  // "Por debajo en" + "rating (−0.2) vs Bar La Paloma"
  };
};
```

| Field | Source |
|---|---|
| `occasion_label` | derived from `venues.occasion_type` (§31.3) — fixed Spanish labels (`breakfast` → "Desayuno", `dinner_restaurant` → "Cena", etc.) |
| `price_tier` | `venues.price_tier` mapped to € symbols; `null` if `price_tier IS NULL` |
| `neighbourhood` | `venues.city` for MVP; later refined via reverse-geocoding for finer-grained barrios |
| `google_rating` | `venues.google_rating` |
| `star_row` | computed server-side from rating — keep the rendering deterministic and free of float quirks |
| `google_review_count` | `venues.google_review_count` |
| `ranking.own_rank` | own venue's rank when sorted by `google_rating` DESC within the `direct` bucket ∪ `{self}` |
| `ranking.bucket_size` | size of the same set |
| `callouts.up` / `callouts.down` | computed from the same join: identify the top "best in" axis and the top "worst in" axis vs the bucket |

---

## 5. Zone 2 — Competidores (§31.2 / §31.5)

```ts
type CompetitorBucket = {
  // Bucket header text (always rendered — Directa always visible, Otros collapsed by default).
  title:     string;                 // "COMPETENCIA DIRECTA" | "OTROS COMPETIDORES"
  subtitle:  string;                 // "Mismo tipo de local, misma franja horaria" / "Distinto formato, misma franja horaria · 3 locales"
  // Up to 5 rows for `direct` (incl. own venue's self-row at its rank slot — see §31.5).
  // Up to 6 rows for `other` (no self-row — §31.2).
  rows:      CompetitorRow[];
  // Name list shown in the collapsed-state preview line ("La Musa · Ojalá · Lamiak").
  // Server returns the joined string so the front-end doesn't re-implement copy rules.
  preview_names: string;
};

type CompetitorRow = {
  // Discriminator — the venue's own row uses `is_self: true`. Trend stays
  // null for self (no head-to-head delta against itself), but `detail` is
  // populated so the owner can expand their own analysis like any other row.
  is_self:        boolean;
  rank:           number;            // 1-indexed within the bucket; ranking includes self in `direct`
  name:           string;
  // Header-level chips
  distance_m:     number;            // → rendered "320m"
  price_tier:     "€" | "€€" | "€€€" | "€€€€" | null;
  social: {
    instagram_linked: boolean;
    facebook_linked:  boolean;
  };
  // Right-side metrics
  google_rating:  number;
  // Colour driver: `higher` = competitor higher than venue (red), `lower` = green, `neutral` = self/own row.
  rating_vs_self: "higher" | "lower" | "neutral";
  // Weekly trend — null on S0 (no history yet); arrow + signed delta otherwise.
  trend: {
    direction: "up" | "down" | "flat";
    delta:     number;               // e.g. +0.1, 0, -0.2
  } | null;

  // Tap-to-expand detail panel. Populated for both competitors AND the
  // venue's own self-row (so the owner can see their own destacan/quejas
  // and star distribution alongside competitors').
  detail: CompetitorDetail | null;
};

type CompetitorDetail = {
  google: {
    review_count:    number;
    // Claude-summarised "Destacan" / "Quejas" line. Both null until WF12 lands.
    destacan:        string | null;
    quejas:          string | null;
    // Star distribution — 5 entries, percentages rounded and summing to ~100.
    // Populated in MVP via per-competitor review ingestion (decision §11).
    star_distribution: { stars: 1 | 2 | 3 | 4 | 5; pct: number }[];
  };
  social: {
    instagram: { followers: number; posts: number } | null;
    facebook:  { followers: number; posts: number } | null;
  };
};
```

| Field | Source |
|---|---|
| Bucket membership (`direct` / `other`) | `venue_competitors.bucket` (v23 two-bucket model — §31.2) |
| `rows[].name` | competitor venue's `venues.name` |
| `rank` | derived per-bucket sort by `google_rating` DESC |
| `distance_m` | computed at request time via `services/competitors.haversine_m` over both venues' lat/lng |
| `price_tier` | competitor's `venues.price_tier` (mapped to € symbols) |
| `google_rating`, `rating_vs_self` | competitor's `venues.google_rating` compared with own |
| `social.instagram_linked` / `facebook_linked` | post-MVP — competitor social handles aren't scraped yet. Return `false` for now. |
| `trend.delta`, `trend.direction` | weekly snapshot diff from `portal_weekly_delta` once WF4/WF12 land. Return `null` for MVP. |
| `detail.google.review_count` | competitor's `venues.google_review_count` |
| `detail.google.destacan`, `quejas` | Claude-generated by WF12 — `null` for MVP |
| `detail.google.star_distribution` | aggregated from `reviews` rows per competitor — populated in MVP (per-competitor review ingestion is in scope, see §11 decision) |
| `detail.social.{instagram,facebook}` | post-MVP — `null` for MVP |
| Self-row (in `direct`) | constructed from the own `venues` row; sorted into the `direct` ranking by `google_rating` so its `rank` reflects the venue's actual position. `is_self=true`, `trend=null`, `detail` populated like a competitor (own destacan/quejas/star_distribution). |

**MVP simplification:** the front-end must handle nullable `detail.google.destacan/quejas`, `detail.social.*`, and `trend` — those depend on Claude / social scrape / weekly snapshots that won't ship in step 1. `star_distribution` and `review_count` are always populated.

---

## 6. Action CTA (post-Zone-2) (§31.5)

A single CTA block whose copy depends on `state`. Discriminated union — front-end branches on `variant`:

```ts
type ActionCta =
  | {
      // S0 with at least one drafted unanswered review — show, don't tell:
      // surface the most urgent review + Teo's draft + a WhatsApp CTA so the
      // owner has a concrete reason to give us Google access. Falls back to
      // the plain `s0` variant when nothing has been drafted yet.
      variant: "s0_showcase";
      intro: string;        // e.g. "Tienes 8 reseñas sin responder · esta es la más urgente:"
      review: {
        id: string;
        reviewer_name: string;
        star_rating: number;
        star_row: string;
        review_text: string;
        review_date: string;  // ISO
        draft_text: string;
      };
      draft_label: string;  // "Teo respondería así:"
      footer: string;       // "Si quieres cambiar algo o que Teo publique esta respuesta:"
      cta_label: string;    // "Continúa en WhatsApp →"
      cta_href: string;     // wa.me deep-link tagged with the review id
    }
  | { variant: "s0"; title: string; body: string; cta_label: string; cta_href: string }
  | { variant: "s1"; title: string; body: string; cta_label: string; cta_href: string }
  | { variant: "s2"; title: string; body: string; cta_label: string; cta_href: string }
  | { variant: "s3"; title: string; body: string; cta_label: string; cta_href: string }
  | { variant: "s4"; title: string; body: string; cta_label: string; cta_href: string; style: "secondary" }
  | {
      variant: "paid_pending";
      // 1..3 pending-task cards under "PENDIENTE ESTA SEMANA" heading (§31.5).
      tasks: { title: string; body: string; cta_label: string; cta_href: string }[];
    }
  | {
      variant: "paid_clear";
      // Single compact horizontal "✓ +12 reseñas respondidas este mes · todo al día"
      title: string;
    }
  | {
      variant: "free";
      // Block-width green CTA. Body copy is 1 sentence + 1 sentence with a competitor name.
      title:     string;     // e.g. "Activa Teo · €49/mes"
      body:      string;
      cta_label: string;     // e.g. "Activar Teo →"
      cta_href:  string;     // wa.me URL
    };
```

**Sources:**
- `state` discriminator → branches via `venues.onboarding_next_step`, `subscription_tier`, `payment_state`, and pending-task counts (joined from `approvals` + `scheduled_posts` where `status='suggested'` etc.).
- For `paid_pending.tasks[]`: dispatch by `approvals.status='pending'` (review approvals) and `scheduled_posts.status='suggested'` (calendar) — capped at 3.
- All `cta_href` values are pre-built `wa.me` deep-links generated server-side (single source of truth for the wording of pre-loaded WhatsApp messages).

> **Why server-rendered copy?** Putting Spanish CTA strings + WhatsApp deep-links in the response (rather than computing them in `portal.js`) keeps the front-end mechanical and lets us A/B-test copy or change wording without redeploying the static site.

---

## 7. Pendiente de activar (§31.5)

```ts
type PendingFeature = {
  feature_key:  string;              // stable key, e.g. "menu_broadcast", "review_request"
  title:        string;              // section title in card, e.g. "Menú del día broadcast"
  body:         string;              // one-sentence "what" copy
  cta_label:    string;              // e.g. "Activar broadcast →"
  cta_href:     string;              // pre-built wa.me deep-link
};
```

**Visibility gate:**
- `subscription_tier in {'tapa','racion','menu'}` AND `payment_state IN ('active','past_due')` → list any feature whose `*_feature_state` column is in a "declined" state (e.g. `chatbot_feature_state='declined'`).
- For all other states (S0..S4, FREE FOMO) → return `pendiente_activar: null` and the section is hidden entirely (FOMO must not show secondary actions; pre-conversion has no declined features yet).

| Field | Source |
|---|---|
| `feature_key` | the venue column key (e.g. `menu_broadcast_feature_state` → `"menu_broadcast"`) |
| `title`, `body`, `cta_label` | static per-feature copy table (lives in backend constants — single source of truth) |
| `cta_href` | server-built wa.me URL with pre-loaded "Quiero activar X" message body |

---

## 8. Meta — diagnostics

```ts
type ResumenMeta = {
  // ISO timestamp the response was assembled. The owner doesn't see it,
  // but it's useful in logs and as a `If-Modified-Since` hint.
  generated_at: string;

  // Contributing inputs to the `state` discriminator. Keeps the front-end
  // mechanical (it only reads `state`) but lets us debug a wrong render
  // by inspecting the response.
  state_inputs: {
    onboarding_next_step:    string | null;
    current_session_step:    string | null;
    subscription_tier:       string;
    payment_state:           string;
    pending_review_count:    number;
    suggested_post_count:    number;
  };
};
```

---

## 9. Per-state field availability matrix

A quick summary of which sections render for each `state` value. Empty cells = the corresponding response field is `null` (or, for `competitors`, omitted entries — `other` may be empty).

| state          | weekly_delta | zone1 | competitors | action_cta variant | pendiente_activar |
|----------------|--------------|-------|-------------|--------------------|-------------------|
| `s0`           | null         | ✓     | ✓ (no trend) | `"s0"`            | null              |
| `s1`           | null†        | ✓     | ✓ (no trend) | `"s1"`            | null              |
| `s2`           | populated    | ✓     | ✓            | `"s2"`            | null              |
| `s3`           | populated    | ✓     | ✓            | `"s3"`            | null              |
| `s4`           | populated    | ✓     | ✓            | `"s4"` (secondary)| null              |
| `paid`         | populated    | ✓     | ✓            | `"paid_pending"`  | populated if any  |
| `paid_clear`   | populated    | ✓     | ✓            | `"paid_clear"`    | populated if any  |
| `free`         | populated    | ✓     | ✓            | `"free"`          | null (FOMO ban)   |

† `s1` before the first WF4 Monday — still `null`. v21's "Tu primer resumen aparecerá el próximo lunes" placeholder was deleted in v23.

---

## 10. Error / edge cases

| Situation | Response |
|---|---|
| `venue_slug` unknown | `404` |
| Magic-link cookie missing or expired | `401`, with a body suggesting the owner type "portal" or "enlace" in WhatsApp (matches §31.13 re-auth flow) |
| `venues.onboarding_state != 'completed'` | `409` "El portal todavía no está disponible — tu informe se está preparando." Front-end should redirect to a "preparing" placeholder. |
| `venues.google_rating IS NULL` | Render Zone 1 with `"—"` placeholder for the rating block (treat as data quality issue; should not 500). |
| `venue_competitors` empty for the venue | `competitors.direct.rows = [self_row only]`, `other.rows = []`, with `preview_names = ""`. Front-end already handles empty buckets gracefully. |

---

## 11. Resolved decisions (2026-04-29)

The five open questions from the first draft were closed by Daniel:

1. **Trend snapshots** — confirmed: every competitor row's `trend` field is `null` on S0/S1 until WF4 runs its first Monday. Front-end must render rows without a trend chip cleanly (the mockup's trend chip is `display:none` when the data is missing).
2. **Star distribution — IN MVP.** Per-competitor review ingestion ships in MVP. The endpoint aggregates `reviews` rows per competitor venue to fill `detail.google.star_distribution`. Rationale: ingest cost is acceptable; no value in deferring.
3. **Foreign Patron Visibility Widget — DROPPED from MVP.** No field on this response, no `portal_foreign_patron_widget` derived table, no front-end section. The mockup's `VISIBILIDAD INTERNACIONAL` collapsible should be removed when we split the mockup in step 3. Revisit post-MVP.
4. **`scores` — NOT surfaced in Resumen MVP.** The `venues.scores` JSONB (review_backlog / instagram_ghost / visibility_gap / competitor_blind) is most useful for the acquisition informe; for the post-onboarding portal it may eventually drive action-CTA variants but is left out for now. Not in `meta`, not anywhere else in the response.
5. **Path shape — `/portal/{venue_slug}/resumen`.** No `/api` prefix. Clean, matches the public portal URL convention (§31.13).

---

## 12. Implementation sketch (for step 2, not this session)

When we build the endpoint:

- File: `teo-backend/routers/portal_api.py` (new) — `GET /portal/{venue_slug}/resumen` handler.
- Reads:
  - `venues` (own row) — single select by `venue_slug`.
  - `venue_competitors` joined with `venues` (target side) — fetch `direct` + `other` buckets in one query.
  - `reviews` per competitor venue — aggregate counts by `star_rating` for `star_distribution`.
  - For paid states: `approvals` (count + first 3 pending review approvals) and `scheduled_posts` (suggested-post count).
- Pure data shape — no Claude, no Maps, no Stripe calls in this handler.
- Auth middleware (from `services/magic_link.py`, §31.15) verifies the cookie before the handler runs.
- Caching: per Daniel — none for MVP. Page load reads live `venues` + `venue_competitors` + `reviews`. Re-fetch freshness becomes a separate scheduled workflow (WF12 nightly per §24).
- Prerequisite for step 2: per-competitor review ingestion path. Either piggyback on existing review-scrape code in `services/reviews.py` (extend it to run for competitor venues at WF0 step-4 confirm time) or stand up a small backfill job. To be sized when we start step 2.
