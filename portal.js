// ─────────────────────────────────────────────────────────────────────────────
// Teo owner portal — boot
//
// URL convention:
//   app.teo.chat/?v=<venue_slug>   → real-data mode (fetches the API)
//   app.teo.chat/                  → demo mode (fixture data + state switcher)
//
// Demo mode keeps the lab header so designers can flip between the 8
// progressive states (s0..free). Real-data mode hides the lab header,
// fetches GET /portal/{slug}/resumen, and applies the response.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  const API_BASE =
    location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'http://localhost:8000'
      : 'https://api.teo.chat';

  const params = new URLSearchParams(location.search);
  const slug = params.get('v');
  const token = params.get('t');

  if (slug) {
    // Strip the magic-link token from the URL bar so it doesn't leak via
    // referrers, screenshots, or pasted links. The browser keeps the
    // HttpOnly cookie that the API just set on the first authenticated
    // load (§31.13).
    if (token) {
      params.delete('t');
      const qs = params.toString();
      const newUrl = location.pathname + (qs ? '?' + qs : '') + location.hash;
      history.replaceState(null, '', newUrl);
    }
    fetchResumen(slug, token)
      .then(() => fetchResenas(slug, token))
      .then(() => schedulePostLoadPolls(slug));
  } else {
    // No magic-link slug → demo mode. Reveal the lab header so designers
    // can flip between fixture states. Real owners arriving without a
    // valid slug get the bare fixture without the toggle UI.
    const lab = document.querySelector('.lab-header');
    if (lab && (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || params.has('demo'))) {
      lab.classList.add('demo-mode');
    }
    initUi();
  }

  // Background portal-prep (competitor enrichment) keeps writing to the DB
  // for ~30s after the magic link ships. Without polling, owners who land
  // on the portal in those first seconds see empty competitor cells until
  // they manually refresh. Run 4 silent re-fetches at 15s/30s/45s/60s
  // post-load, then stop — by then the background work is done. Renderers
  // are idempotent (clear .review-row and rebuild from API), so re-calling
  // them just diffs new data in.
  // `pollsAlive` flips to false when ANY poll comes back 401 — owner has
  // rotated the magic link from chat (the new token invalidated this one).
  // Without the flag, every subsequent poll retries with the dead token
  // and the user eventually sees a misleading "Tu enlace ha caducado"
  // even though they already have a working new link in their chat.
  let pollsAlive = true;

  function schedulePostLoadPolls(slug) {
    [15000, 30000, 45000, 60000].forEach((delay) => {
      setTimeout(() => {
        if (!pollsAlive) return;
        // Silent: errors during polling don't show an error UI; the user
        // already has the first render. Cookie auth — no token in URL,
        // so token rotation in chat doesn't break already-loaded pages.
        Promise.allSettled([
          silentRefetchResumen(slug),
          silentRefetchResenas(slug),
        ]);
      }, delay);
    });
  }

  async function silentRefetchResumen(slug) {
    const url = `${API_BASE}/portal/${encodeURIComponent(slug)}/resumen`;
    try {
      const resp = await fetch(url, { credentials: 'include' });
      if (resp.status === 401) { pollsAlive = false; return; }
      if (!resp.ok) return;
      const data = await resp.json();
      applyResumen(data);
    } catch (_err) { /* swallow */ }
  }

  async function silentRefetchResenas(slug) {
    const url = `${API_BASE}/portal/${encodeURIComponent(slug)}/resenas`;
    try {
      const resp = await fetch(url, { credentials: 'include' });
      if (resp.status === 401) { pollsAlive = false; return; }
      if (!resp.ok) return;
      const data = await resp.json();
      renderResenas(data);
    } catch (_err) { /* swallow */ }
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Fetch + error handling
  // ───────────────────────────────────────────────────────────────────────────
  async function fetchResumen(slug, token) {
    let url = `${API_BASE}/portal/${encodeURIComponent(slug)}/resumen`;
    if (token) url += `?t=${encodeURIComponent(token)}`;
    console.log('[teo] fetchResumen:', url);
    let resp;
    try {
      resp = await fetch(url, { credentials: 'include' });
    } catch (err) {
      console.error('[teo] fetchResumen network error:', err);
      return showError('No se pudo conectar con el servidor.');
    }

    console.log('[teo] fetchResumen response:', resp.status);
    if (resp.status === 404) return showError('Local no encontrado.');
    if (resp.status === 401)
      return showError(
        'Tu enlace ha caducado. Escribe "portal" a Teo en WhatsApp para recibir uno nuevo.'
      );
    if (resp.status === 409)
      return showError('Tu informe todavía se está preparando. Vuelve en unos minutos.');
    if (!resp.ok) return showError('Algo no fue bien. Intenta de nuevo en un momento.');

    let resumen;
    try {
      resumen = await resp.json();
    } catch (err) {
      console.error('[teo] fetchResumen JSON parse error:', err);
      return showError('Respuesta inválida del servidor.');
    }

    applyResumen(resumen);
    initUi();
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  applyResumen — minimal v1
  //
  //  Sets `body[data-state]` (drives all the per-state CSS toggles already in
  //  the markup) and writes the venue name into the topbar. Hides the demo
  //  state switcher. Subsequent slices will populate delta widget, zone1,
  //  competitors, action_cta, etc. — for now those keep their fixture content.
  // ───────────────────────────────────────────────────────────────────────────
  function applyResumen(resumen) {
    if (!resumen) {
      console.warn('[teo] applyResumen: empty resumen, skipping');
      return;
    }

    console.log(
      '[teo] applyResumen: state=%s venue=%s zone1=%s',
      resumen.state, resumen.venue && resumen.venue.name, !!resumen.zone1,
    );

    if (resumen.state) document.body.dataset.state = resumen.state;

    const labHeader = document.querySelector('.lab-header');
    if (labHeader) {
      labHeader.style.display = 'none';
      labHeader.classList.remove('demo-mode');
    }

    // Wipe the loudest fixture text BEFORE rendering, so a partial-render
    // bug in any downstream renderer leaves visibly-empty cells instead of
    // misleading mockup data ("TABERNA DEL ÁNGEL" etc.). Any successful
    // renderer immediately fills its slot back in.
    const _wipe = (sel) => {
      const el = document.querySelector(sel);
      if (el) el.textContent = '';
    };
    _wipe('.venue-tag');
    _wipe('.z1-venue');
    _wipe('.z1-meta');
    _wipe('.z1-rating');
    _wipe('.z1-reviews');
    _wipe('.z1-ranking-val');

    // Wrap each renderer in try/catch so one failing block doesn't leave
    // the rest of the page on fixture data. Bug Daniel hit on iter 4: a
    // silent throw mid-applyResumen left the demo "TABERNA DEL ÁNGEL"
    // venue name visible.
    const _safe = (label, fn) => {
      try { fn(); }
      catch (err) { console.error('[teo] applyResumen.' + label + ':', err); }
    };

    if (resumen.venue) _safe('venue',         () => renderVenue(resumen.venue));
    if (resumen.zone1) _safe('zone1',         () => renderZone1(resumen.zone1, resumen.venue));
    if (resumen.competitors) _safe('competitors', () => renderCompetitors(resumen.competitors));
    if (resumen.action_cta)  _safe('action_cta',  () => renderActionCta(resumen.action_cta));
    if (resumen.settings)    _safe('settings',    () => renderSettings(resumen.settings));
    _safe('weekly_delta', () => renderWeeklyDelta(resumen.weekly_delta));
  }

  // ── Settings page · Comunicaciones ────────────────────────────────────────
  // MVP: only the weekly-report-delivery row. Backend ships
  // resumen.settings.comunicaciones.weekly_report; render it into the
  // .comm-report-row anchor. The CTA href routes the owner into chat
  // with the trigger phrase pre-loaded so conversation._maybe_handle_
  // report_schedule fires the 2-turn flow.
  function renderSettings(settings) {
    const row = document.querySelector('.comm-report-row');
    if (!row) return;
    const wr = settings && settings.comunicaciones && settings.comunicaciones.weekly_report;
    if (!wr) return;
    const valEl = row.querySelector('.comm-report-value');
    if (valEl && wr.value) valEl.textContent = wr.value;
    if (wr.cta_href) row.setAttribute('href', wr.cta_href);
    const preview = document.querySelector('.comm-report-preview');
    if (preview && wr.value) preview.textContent = wr.value;
  }

  // ── Weekly Delta widget (§31.11) ──────────────────────────────────────────
  // The mockup ships two widget instances: `.delta-widget.paid` (TEO HIZO ‖
  // RESULTADOS columns + comparative line) and `.delta-widget.free` (headline
  // + trend table + insight). CSS toggles which is visible based on
  // body[data-state]; we populate the matching one from the API payload.
  // paid_clear reuses the .paid widget shell — only the bottom line changes.
  function renderWeeklyDelta(delta) {
    // No delta → hide both widget shells. Without this, S2/S3 CSS leaves
    // the fixture markup visible and the owner sees stale demo data on a
    // venue that hasn't accumulated a single weekly snapshot yet.
    const paidEl = document.querySelector('.delta-widget.paid');
    const freeEl = document.querySelector('.delta-widget.free');
    if (!delta) {
      if (paidEl) paidEl.style.display = 'none';
      if (freeEl) freeEl.style.display = 'none';
      return;
    }
    const variant = delta.variant;
    if (variant === 'paid' || variant === 'paid_clear') {
      if (paidEl) paidEl.style.display = '';
      if (freeEl) freeEl.style.display = 'none';
      renderPaidDelta(delta);
    } else if (variant === 'free') {
      if (freeEl) freeEl.style.display = '';
      if (paidEl) paidEl.style.display = 'none';
      renderFreeDelta(delta);
    }
  }

  function renderPaidDelta(delta) {
    const root = document.querySelector('.delta-widget.paid');
    if (!root) return;

    setText('.delta-date', formatDeltaDate(delta), root);

    // TEO HIZO column — replace the 3 fixture rows with the API's bullet list.
    // When the API returns no rows (zero-count weeks are filtered server-side
    // to avoid churn-inducing "Respondió 0 reseñas" theater), collapse the
    // entire column including its label so RESULTADOS doesn't sit next to a
    // hollow heading.
    const teoSection = root.querySelector('.delta-cols .delta-section:first-child');
    const teoList = teoSection?.querySelector('.delta-list');
    if (teoList) {
      teoList.innerHTML = '';
      (delta.teo_hizo || []).forEach((row) => {
        const div = document.createElement('div');
        div.className = 'delta-row';
        div.textContent = row.text || '';
        teoList.appendChild(div);
      });
    }
    if (teoSection) {
      const hasRows = Array.isArray(delta.teo_hizo) && delta.teo_hizo.length > 0;
      teoSection.style.display = hasRows ? '' : 'none';
      const divider = root.querySelector('.delta-divider');
      if (divider) divider.style.display = hasRows ? '' : 'none';
    }

    // RESULTADOS column — span per resultado, signed colour class.
    const headline = root.querySelector('.delta-headline');
    if (headline) {
      headline.innerHTML = '';
      (delta.resultados || []).forEach((row) => {
        const span = document.createElement('span');
        span.className = row.sign || 'neutral';
        span.textContent = row.text || '';
        headline.appendChild(span);
      });
    }

    // Bottom line: `paid` shows the comparative; `paid_clear` replaces it
    // with the all-clear ribbon.
    const comp = root.querySelector('.delta-comp');
    if (comp) {
      if (delta.variant === 'paid_clear') {
        comp.textContent = delta.all_clear_line || '✓ Todo al día';
      } else {
        comp.textContent = delta.comparative || '';
        comp.style.display = delta.comparative ? '' : 'none';
      }
    }
  }

  function renderFreeDelta(delta) {
    const root = document.querySelector('.delta-widget.free');
    if (!root) return;

    setText('.delta-date', formatDeltaDate(delta), root);

    // FOMO headline (e.g. "Bar La Paloma sigue ganando terreno")
    const headline = root.querySelector('.delta-section .delta-headline');
    if (headline) {
      headline.innerHTML = '';
      headline.textContent = delta.headline || '';
    }

    // 4-row trend table replaces the fixture's 2 narrative rows.
    const list = root.querySelector('.delta-list');
    if (list) {
      list.innerHTML = '';
      (delta.trend_rows || []).forEach((row) => {
        const div = document.createElement('div');
        div.className = 'delta-row';
        div.textContent =
          `${row.week_label}    Tú ${formatRating(row.own_rating)}    ` +
          `${delta.competitor_name || 'Competidor'} ${formatRating(row.competitor_rating)}`;
        list.appendChild(div);
      });
    }

    // Claude insight line at the bottom.
    setText('.delta-insight-text', delta.insight || '', root);
  }

  function formatDeltaDate(delta) {
    const wk = delta.iso_week ? `Sem. ${delta.iso_week}` : '';
    const m = delta.month_label || '';
    return [wk, m].filter(Boolean).join(' · ');
  }

  function renderVenue(venue) {
    const tag = document.querySelector('.venue-tag');
    if (tag && venue.name) tag.textContent = venue.name;
  }

  function renderZone1(zone1, venue) {
    setText('.z1-venue', venue && venue.name ? venue.name : '');

    // "Malasaña · Cena · €€" — drop price_tier if null
    const metaParts = [zone1.neighbourhood, zone1.occasion_label];
    if (zone1.price_tier) metaParts.push(zone1.price_tier);
    setText('.z1-meta', metaParts.filter(Boolean).join(' · '));

    setText('.z1-rating', formatRating(zone1.google_rating));
    setText('.z1-stars', zone1.star_row || '');
    setText(
      '.z1-reviews',
      `${formatInt(zone1.google_review_count)} reseñas · Google`
    );

    if (zone1.ranking) {
      setText(
        '.z1-ranking-val',
        `${zone1.ranking.own_rank}º de ${zone1.ranking.bucket_size} locales`
      );
    }

    renderForeignChip(zone1.foreign_patrons);

    renderCallout('.z1-callout.up', zone1.callouts && zone1.callouts.up);
    renderCallout('.z1-callout.down', zone1.callouts && zone1.callouts.down);

    // Hide the wrapper if both callouts are absent
    const wrapper = document.querySelector('.z1-callouts');
    if (wrapper) {
      const anyVisible = wrapper.querySelector(
        '.z1-callout:not([data-empty="true"])'
      );
      wrapper.style.display = anyVisible ? '' : 'none';
    }
  }

  // Map ISO 639-1 → tiny human label for the chip. Anything not listed
  // surfaces with its uppercase code (rare; 90%+ of non-Spanish reviews
  // will be EN/FR/IT/DE/PT/ZH/JA/RU based on Madrid-area data).
  const LANG_LABEL = {
    en: 'EN', fr: 'FR', it: 'IT', de: 'DE', pt: 'PT',
    zh: 'ZH', 'zh-cn': 'ZH', 'zh-tw': 'ZH', ja: 'JA',
    ko: 'KO', ru: 'RU', ar: 'AR', nl: 'NL', pl: 'PL',
    ca: 'CA', tr: 'TR', uk: 'UK',
  };

  function renderForeignChip(data) {
    const chip = document.querySelector('.z1-foreign-chip');
    if (!chip) return;
    if (!data || !data.foreign_pct) {
      chip.hidden = true;
      chip.textContent = '';
      return;
    }
    const breakdown = (data.top_languages || [])
      .map((l) => `${LANG_LABEL[l.lang] || l.lang.toUpperCase()} ${l.pct}%`)
      .join(' · ');
    chip.textContent = breakdown
      ? `${data.foreign_pct}% extranjeros · ${breakdown}`
      : `${data.foreign_pct}% extranjeros`;
    chip.hidden = false;
  }

  function renderCallout(selector, data) {
    const el = document.querySelector(selector);
    if (!el) return;
    if (!data) {
      el.dataset.empty = 'true';
      el.style.display = 'none';
      return;
    }
    el.dataset.empty = 'false';
    el.style.display = '';
    setText('.z1-callout-label', data.label, el);
    setText('.z1-callout-val', data.metric, el);
  }

  // ── Action CTA ────────────────────────────────────────────────────────────
  // The mockup has one `.cta-<variant>` element per state, all in the DOM at
  // the same time; CSS uses body[data-state] to show only the matching one.
  // We populate just the matching block from the API.
  function renderActionCta(cta) {
    switch (cta.variant) {
      case 's0_showcase':
        renderS0Showcase(cta);
        break;
      case 's0':
      case 's1':
      case 's2':
      case 's3':
      case 's4':
      case 'free':
        renderSimpleCta('.cta-' + cta.variant, cta);
        break;
      case 'paid_clear':
        setText('.cta-paid-clear .cta-title', cta.title);
        break;
      case 'paid_pending':
        renderPaidPending(cta.tasks || []);
        break;
    }
  }

  function renderS0Showcase(cta) {
    const root = document.querySelector('.cta-s0');
    if (!root) return;

    setText('.cta-intro', cta.intro, root);
    setText('.cta-footer', cta.footer, root);

    const btn = root.querySelector('.cta-btn');
    if (btn) {
      btn.textContent = cta.cta_label || 'Continúa en WhatsApp →';
      if (cta.cta_href) btn.setAttribute('href', cta.cta_href);
    }

    const reviewEl = root.querySelector('.cta-review');
    if (!reviewEl) return;
    const r = cta.review || {};
    const isLow = (r.star_rating || 0) <= 3;
    reviewEl.classList.toggle('low', isLow);

    setText('.review-author', r.reviewer_name || 'Anónimo', reviewEl);
    setText(
      '.review-meta',
      [r.review_date ? formatRelativeDate(r.review_date) : '', 'Google']
        .filter(Boolean)
        .join(' · '),
      reviewEl
    );

    const stars = reviewEl.querySelector('.review-stars');
    if (stars) {
      stars.textContent = r.star_row || '';
      stars.classList.toggle('low', isLow);
    }

    setText('.review-text', r.review_text || '', reviewEl);
    setText('.teo-draft-label', '▸ ' + (cta.draft_label || 'Teo respondería así:'), reviewEl);
    setText('.teo-draft-text', r.draft_text || '', reviewEl);
  }

  function renderSimpleCta(scopeSelector, cta) {
    const root = document.querySelector(scopeSelector);
    if (!root) return;
    setText('.cta-title', cta.title, root);
    setText('.cta-body', cta.body, root);
    const btn = root.querySelector('.cta-btn');
    if (btn) {
      btn.textContent = cta.cta_label;
      if (cta.cta_href) btn.setAttribute('href', cta.cta_href);
    }
  }

  function renderPaidPending(tasks) {
    const stack = document.querySelector('.cta-paid-pending .cta-stack');
    if (!stack) return;
    stack.innerHTML = '';
    tasks.forEach((task) => {
      const item = document.createElement('div');
      item.className = 'cta-item';
      const titleEl = document.createElement('div');
      titleEl.className = 'cta-title';
      titleEl.textContent = task.title;
      const bodyEl = document.createElement('div');
      bodyEl.className = 'cta-body';
      bodyEl.textContent = task.body;
      const btn = document.createElement('a');
      btn.className = 'cta-btn block';
      btn.setAttribute('href', task.cta_href || '#');
      btn.textContent = task.cta_label;
      item.append(titleEl, bodyEl, btn);
      stack.appendChild(item);
    });
  }

  // ── Competitors (Zone 2) ──────────────────────────────────────────────────
  const SVG_IG_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="12" cy="12" r="4"/>' +
    '<circle cx="17.5" cy="6.5" r="0.8" fill="currentColor"/></svg>';
  const SVG_FB_ICON =
    '<svg viewBox="0 0 24 24" fill="currentColor">' +
    '<path d="M13 22v-8h3l.5-4H13V7.5c0-1.2.4-2 2.1-2H17V2.1C16.6 2 15.6 2 14.5 2c-2.7 0-4.5 1.6-4.5 4.6V10H7v4h3v8z"/>' +
    '</svg>';
  const SVG_IG_LARGE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="12" cy="12" r="4"/></svg>';
  const SVG_STAR =
    '<svg viewBox="0 0 24 24" fill="currentColor">' +
    '<path d="M12 2l3 7h7l-5.5 4.5L18 22l-6-4.5L6 22l1.5-8.5L2 9h7z"/></svg>';

  function renderCompetitors(competitors) {
    if (!competitors) return;

    // DIRECT bucket — `.bucket` (not collapsible)
    const directBucket = document.querySelector('.bucket:not(.collapsible)');
    if (directBucket && competitors.direct) {
      setText('.bucket-title', competitors.direct.title, directBucket);
      setText('.bucket-sub', competitors.direct.subtitle, directBucket);
      directBucket.querySelectorAll('.comp-row').forEach((r) => r.remove());
      (competitors.direct.rows || []).forEach((row) => {
        directBucket.insertAdjacentHTML('beforeend', buildCompRowHtml(row));
      });
    }

    // OTHER bucket — collapsible
    const otherBucket = document.querySelector('.collapsible.bucket-collapsible');
    if (otherBucket && competitors.other) {
      setText('.bucket-title', competitors.other.title, otherBucket);
      setText('.bucket-sub', competitors.other.subtitle, otherBucket);

      const previewEl = otherBucket.querySelector('.collapsible-preview');
      if (previewEl) {
        previewEl.innerHTML =
          escapeHtml(competitors.other.preview_names || '') +
          ' <span class="preview-arrow">abrir ↓</span>';
      }

      const body = otherBucket.querySelector('.collapsible-body');
      if (body) {
        body.innerHTML = '';
        (competitors.other.rows || []).forEach((row) => {
          body.insertAdjacentHTML('beforeend', buildCompRowHtml(row));
        });
      }
    }
  }

  function buildCompRowHtml(row) {
    const isSelf = !!row.is_self;
    const rankHtml =
      row.rank != null
        ? `<span class="comp-rank">#${escapeHtml(String(row.rank))}</span>`
        : '';
    const selfTagHtml = isSelf ? '<span class="comp-self-tag">tú</span>' : '';

    let chipsHtml = '';
    if (!isSelf) {
      const distHtml =
        row.distance_m != null
          ? `<span class="comp-chip dist">${escapeHtml(formatDistance(row.distance_m))}</span>`
          : '';
      const priceHtml = row.price_tier
        ? `<span class="comp-chip price">${escapeHtml(row.price_tier)}</span>`
        : '';
      let socialIconsHtml = '';
      if (row.social) {
        const ig = row.social.instagram_linked ? SVG_IG_ICON : '';
        const fb = row.social.facebook_linked ? SVG_FB_ICON : '';
        if (ig || fb) {
          socialIconsHtml =
            '<span class="social-icons" aria-label="Redes sociales">' +
            ig + fb +
            '</span>';
        }
      }
      if (distHtml || priceHtml || socialIconsHtml) {
        chipsHtml =
          '<span class="comp-chips">' + distHtml + priceHtml + socialIconsHtml + '</span>';
      }
    }

    const ratingClass =
      row.rating_vs_self === 'higher'
        ? ' higher'
        : row.rating_vs_self === 'lower'
        ? ' lower'
        : '';
    const ratingHtml = `<span class="comp-rating${ratingClass}">${escapeHtml(formatRating(row.google_rating))}</span>`;

    let trendHtml = '';
    if (row.trend) {
      const dir = row.trend.direction;
      const arrow = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→';
      const cls = dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'flat';
      trendHtml = `<span class="comp-trend ${cls}">${arrow} ${escapeHtml(formatTrendDelta(row.trend.delta))}</span>`;
    }

    const hasDetail = !!row.detail;
    const expandBtnHtml = hasDetail ? '<button class="comp-expand-btn">▾</button>' : '';
    const onclickAttr = hasDetail
      ? ' onclick="this.classList.toggle(\'open\')"'
      : '';
    const rowClass = isSelf ? 'comp-row is-self' : 'comp-row';
    const detailHtml = hasDetail ? buildCompDetailHtml(row.detail) : '';

    return (
      `<div class="${rowClass}"${onclickAttr}>` +
        '<div class="comp-main">' +
          '<div class="comp-left">' +
            rankHtml +
            `<span class="comp-name">${escapeHtml(row.name || '')}${selfTagHtml}</span>` +
            chipsHtml +
          '</div>' +
          '<div class="comp-right">' +
            ratingHtml +
            trendHtml +
            expandBtnHtml +
          '</div>' +
        '</div>' +
        detailHtml +
      '</div>'
    );
  }

  function buildCompDetailHtml(detail) {
    const g = detail.google || {};

    const summaryParts = [];
    if (g.destacan)
      summaryParts.push(`<strong>Destacan:</strong> ${escapeHtml(g.destacan)}.`);
    if (g.quejas)
      summaryParts.push(`<strong>Quejas:</strong> ${escapeHtml(g.quejas)}.`);
    const summaryHtml = summaryParts.length
      ? `<div class="g-summary">${summaryParts.join(' ')}</div>`
      : '<div class="g-summary g-summary-empty">Resumen en preparación.</div>';

    let distHtml = '';
    if (g.star_distribution && g.star_distribution.length > 0) {
      const map = {};
      g.star_distribution.forEach((d) => {
        map[d.stars] = d.pct;
      });
      const rows = [5, 4, 3, 2, 1]
        .map((s) => {
          const pct = Number(map[s] || 0);
          return (
            '<div class="g-dist-row">' +
              `<span class="g-dist-stars">${s}</span>` +
              `<div class="g-dist-bar"><div class="fill" style="width:${pct}%"></div></div>` +
            '</div>'
          );
        })
        .join('');
      distHtml = `<div class="g-dist">${rows}</div>`;
    }

    const googleInner = `<div class="google-detail">${summaryHtml}${distHtml}</div>`;
    const reviewCountStr =
      g.review_count != null ? formatInt(g.review_count) + ' reseñas' : '';
    const googleBlock =
      '<div class="detail-block">' +
        `<div class="detail-title">${SVG_STAR}GOOGLE${reviewCountStr ? ' · ' + reviewCountStr : ''}</div>` +
        googleInner +
      '</div>';

    const sd = detail.social || {};
    let socialItems = '';
    if (sd.instagram) {
      socialItems +=
        '<div class="social-detail-item">' +
          SVG_IG_LARGE +
          ` IG · <strong>${escapeHtml(formatCompactNumber(sd.instagram.followers))}</strong> seguidores · ` +
          `<strong>${formatInt(sd.instagram.posts)}</strong> posts` +
        '</div>';
    }
    if (sd.facebook) {
      socialItems +=
        '<div class="social-detail-item">' +
          SVG_FB_ICON +
          ` FB · <strong>${escapeHtml(formatCompactNumber(sd.facebook.followers))}</strong> · ` +
          `<strong>${formatInt(sd.facebook.posts)}</strong> posts` +
        '</div>';
    }
    if (!socialItems) {
      socialItems =
        '<div class="social-detail-item" style="color: var(--mid); font-style: italic;">Sin perfiles sociales</div>';
    }
    const socialBlock =
      '<div class="detail-block">' +
        '<div class="detail-title">REDES</div>' +
        `<div class="social-detail">${socialItems}</div>` +
      '</div>';

    return `<div class="comp-detail">${googleBlock}${socialBlock}</div>`;
  }

  // ── Reseñas tab (Reseñas page) ────────────────────────────────────────────
  // See RESENAS_CONTRACT.md. Fired after the Resumen call; failure is
  // swallowed because the rest of the portal still works without reviews.
  async function fetchResenas(slug, token) {
    let url = `${API_BASE}/portal/${encodeURIComponent(slug)}/resenas`;
    if (token) url += `?t=${encodeURIComponent(token)}`;
    let resp;
    try {
      resp = await fetch(url, { credentials: 'include' });
    } catch (_err) {
      return;
    }
    if (!resp.ok) return;
    let body;
    try {
      body = await resp.json();
    } catch (_err) {
      return;
    }
    renderResenas(body);
  }

  function renderResenas(data) {
    if (!data) return;

    if (data.google_summary) renderGoogleSummary(data.google_summary);
    if (data.answered_summary) renderAnsweredSummary(data.answered_summary);

    const showcase = document.querySelector('.rev-showcase');
    if (showcase) {
      const cards = data.showcase || [];
      // Keep the ASCII label + the closing CTA item, replace the review rows.
      showcase.querySelectorAll('.review-row').forEach((r) => r.remove());
      const ctaAnchor = showcase.querySelector('.cta-item');
      cards.forEach((card) => {
        const html = buildReviewRowHtml(card, { showcase: true });
        if (ctaAnchor) ctaAnchor.insertAdjacentHTML('beforebegin', html);
        else showcase.insertAdjacentHTML('beforeend', html);
      });
    }

    // ── Necesitan tu contexto (Mode B) ────────────────────────────────────
    // Backend returns null when there's nothing to surface — keep hidden.
    const needsCtx = document.querySelector('.rev-needs-context');
    if (needsCtx) {
      needsCtx.querySelectorAll('.review-row').forEach((r) => r.remove());
      const items = data.needs_context || [];
      if (items.length === 0) {
        needsCtx.style.display = 'none';
      } else {
        needsCtx.style.display = '';
        items.forEach((card) => {
          needsCtx.insertAdjacentHTML(
            'beforeend',
            buildReviewRowHtml(card, { withAction: true })
          );
        });
      }
    }

    // ── Aprobar modo semi-automático (S1 only) ───────────────────────────
    // Owner needs to see what Teo will publish before approving — we render
    // the auto-publish-eligible drafts as read-only review-row cards above
    // the explanation copy + button.
    const autoPublish = document.querySelector('.rev-auto-publish');
    if (autoPublish) {
      const sec = data.auto_publish_section;
      const list = autoPublish.querySelector('.rev-auto-list');
      if (list) list.querySelectorAll('.review-row').forEach((r) => r.remove());
      if (!sec) {
        autoPublish.style.display = 'none';
      } else {
        autoPublish.style.display = '';
        setText('.rev-auto-title', sec.title || 'MODO SEMI-AUTOMÁTICO', autoPublish);
        setText('.rev-auto-body', sec.body || '', autoPublish);
        if (list) {
          (sec.reviews || []).forEach((card) => {
            list.insertAdjacentHTML(
              'beforeend',
              buildReviewRowHtml(card, { withAction: false })
            );
          });
        }
        const cta = autoPublish.querySelector('.rev-auto-cta');
        if (cta) {
          if (sec.cta_label) cta.textContent = sec.cta_label;
          if (sec.cta_href) cta.setAttribute('href', sec.cta_href);
        }
      }
    }

    // ── Sin responder (Mode A — manual approve) ──────────────────────────
    // Backend returns null in context_aware mode; only manual_approve gets
    // the per-row pending list with Aprobar CTAs.
    const unanswered = document.querySelector('.rev-unanswered');
    if (unanswered) {
      unanswered.querySelectorAll('.review-row').forEach((r) => r.remove());
      const pending = data.pending || [];
      if (pending.length === 0) {
        unanswered.style.display = 'none';
      } else {
        unanswered.style.display = '';
        pending.forEach((card) => {
          unanswered.insertAdjacentHTML(
            'beforeend',
            buildReviewRowHtml(card, { withAction: true })
          );
        });
      }
    }

    const answered = document.querySelector('.rev-answered');
    if (answered) {
      answered.querySelectorAll('.review-row').forEach((r) => r.remove());
      (data.answered || []).forEach((card) => {
        answered.insertAdjacentHTML(
          'beforeend',
          buildReviewRowHtml(card, { answered: true })
        );
      });
    }

    if (data.mode_chip) {
      setText('.mode-chip-value', stripModePrefix(data.mode_chip.title));
      setText('.mode-chip-tagline', data.mode_chip.tagline);
      const editLink = document.querySelector('.mode-chip-edit');
      if (editLink && data.mode_chip.cta_href) {
        editLink.setAttribute('href', data.mode_chip.cta_href);
      }
    }
  }

  function renderGoogleSummary(g) {
    // Find the GOOGLE collapsible — first .collapsible inside .page-reviews
    // whose ascii-label says GOOGLE.
    const collapsible = findCollapsibleByLabel('GOOGLE');
    if (!collapsible) return;

    // Preview line: "4.2★ · 187 reseñas · 18 nuevas este mes"
    const preview = collapsible.querySelector('.collapsible-preview');
    if (preview) {
      const parts = [];
      if (g.google_rating != null) parts.push(formatRating(g.google_rating) + '★');
      if (g.google_review_count != null)
        parts.push(formatInt(g.google_review_count) + ' reseñas');
      if (g.new_this_month) parts.push(g.new_this_month + ' nuevas este mes');
      preview.innerHTML =
        escapeHtml(parts.join(' · ')) +
        ' <span class="preview-arrow">abrir ↓</span>';
    }

    setText('.g-big-rating', formatRating(g.google_rating), collapsible);
    setText('.g-big-stars', g.star_row || '', collapsible);
    setText('.g-big-count', formatInt(g.google_review_count) + ' reseñas', collapsible);

    // Star distribution bars
    const distMap = {};
    (g.star_distribution || []).forEach((d) => {
      distMap[d.stars] = d.pct;
    });
    [5, 4, 3, 2, 1].forEach((stars, idx) => {
      const row = collapsible.querySelectorAll('.g-summary-dist .g-dist-row')[idx];
      if (!row) return;
      const fill = row.querySelector('.fill');
      if (fill) fill.style.width = (distMap[stars] || 0) + '%';
    });

    // Highlights — destacan / quejas. Hide rows we don't have content for.
    const rows = collapsible.querySelectorAll('.g-summary-highlights .g-highlight-row');
    rows.forEach((row) => {
      const label = (row.querySelector('.g-highlight-label')?.textContent || '').toLowerCase();
      const textEl = row.querySelector('.g-highlight-text');
      if (!textEl) return;
      if (label === 'destacan') {
        if (g.destacan) textEl.textContent = g.destacan;
        row.style.display = g.destacan ? '' : 'none';
      } else if (label === 'quejas') {
        if (g.quejas) textEl.textContent = g.quejas;
        row.style.display = g.quejas ? '' : 'none';
      } else {
        // "Patrón" row — we don't generate this yet, hide it.
        row.style.display = 'none';
      }
    });
  }

  function renderAnsweredSummary(s) {
    const collapsible = findCollapsibleByLabel('RESPONDIDAS');
    if (!collapsible) return;
    const preview = collapsible.querySelector('.collapsible-preview');
    if (!preview) return;

    if (!s.count) {
      preview.innerHTML =
        'Sin respuestas todavía <span class="preview-arrow">abrir ↓</span>';
      return;
    }
    const parts = [s.count + ' contestada' + (s.count === 1 ? '' : 's')];
    if (s.days_since != null) {
      const ago =
        s.days_since === 0
          ? 'hoy'
          : s.days_since === 1
          ? 'hace 1 día'
          : 'hace ' + s.days_since + ' días';
      parts.push('última ' + ago);
    }
    preview.innerHTML =
      escapeHtml(parts.join(' · ')) +
      ' <span class="preview-arrow">abrir ↓</span>';
  }

  function findCollapsibleByLabel(label) {
    const page = document.querySelector('.page-reviews');
    if (!page) return null;
    const collapsibles = page.querySelectorAll(':scope > .collapsible');
    for (const c of collapsibles) {
      const lbl = c.querySelector('.ascii-label');
      if (lbl && lbl.textContent.trim().toUpperCase() === label) return c;
    }
    return null;
  }

  function buildReviewRowHtml(card, opts) {
    opts = opts || {};
    const stars = card.star_row || '';
    const lowClass =
      (card.star_rating || 0) <= 3 ? ' low' : '';
    const dateText = card.review_date ? formatRelativeDate(card.review_date) : '';
    const metaText = [dateText, 'Google'].filter(Boolean).join(' · ');

    const draftBlock = card.draft_text
      ? '<div class="teo-draft">' +
          '<div class="teo-draft-label">▸ Teo respondería</div>' +
          `<div class="teo-draft-text">${escapeHtml(card.draft_text)}</div>` +
        '</div>'
      : '';

    let actionsBlock = '';
    if (opts.answered && card.draft_text) {
      actionsBlock =
        '<div class="teo-response">' +
          '<div class="teo-response-label">▸ Teo respondió</div>' +
          escapeHtml(card.draft_text) +
        '</div>';
    } else if (opts.withAction && card.cta_href) {
      actionsBlock =
        '<div class="review-actions">' +
          `<a href="${escapeHtml(card.cta_href)}" class="cta-btn">Revisar →</a>` +
        '</div>';
    }

    // Answered block uses `.teo-response` instead of `.teo-draft`
    const innerDraft = opts.answered ? '' : draftBlock;

    return (
      '<div class="review-row">' +
        '<div class="review-head">' +
          '<div class="review-left">' +
            `<div class="review-author">${escapeHtml(card.reviewer_name || 'Anónimo')}</div>` +
            `<div class="review-meta">${escapeHtml(metaText)}</div>` +
          '</div>' +
          `<div class="review-stars${lowClass}">${escapeHtml(stars)}</div>` +
        '</div>' +
        (card.review_text
          ? `<div class="review-text">${escapeHtml(card.review_text)}</div>`
          : '') +
        innerDraft +
        actionsBlock +
      '</div>'
    );
  }

  function stripModePrefix(title) {
    // "Modo · Mixto" → "Mixto"
    if (!title) return '';
    const idx = title.indexOf('·');
    return idx >= 0 ? title.slice(idx + 1).trim() : title;
  }

  function formatRelativeDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return 'Hoy';
    if (days === 1) return 'Hace 1 día';
    if (days < 7) return `Hace ${days} días`;
    if (days < 14) return 'Hace 1 semana';
    if (days < 30) return `Hace ${Math.floor(days / 7)} semanas`;
    if (days < 60) return 'Hace 1 mes';
    return `Hace ${Math.floor(days / 30)} meses`;
  }

  function formatDistance(m) {
    if (m == null) return '';
    if (m >= 1000) return (m / 1000).toFixed(1).replace('.0', '') + 'km';
    return Math.round(m) + 'm';
  }

  function formatCompactNumber(n) {
    if (n == null) return '0';
    if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'k';
    return String(n);
  }

  function formatTrendDelta(delta) {
    if (delta == null) return '0';
    const num = Number(delta);
    if (num === 0) return '0';
    if (num > 0) return '+' + num.toFixed(1);
    return num.toFixed(1);
  }

  // ── tiny helpers ───────────────────────────────────────────────────────────
  function setText(selector, value, root) {
    const el = (root || document).querySelector(selector);
    if (el) el.textContent = value == null ? '' : String(value);
  }
  function formatRating(n) {
    if (n == null) return '—';
    return Number(n).toFixed(1);
  }
  function formatInt(n) {
    if (n == null) return '0';
    return Number(n).toLocaleString('es-ES');
  }

  function showError(msg) {
    const labHeader = document.querySelector('.lab-header');
    if (labHeader) labHeader.style.display = 'none';

    const phone = document.querySelector('.phone');
    if (!phone) return;
    phone.innerHTML =
      '<div class="portal-error">' +
      '<div class="portal-error-brand">teo.chat</div>' +
      '<div class="portal-error-msg">' +
      escapeHtml(msg) +
      '</div>' +
      '</div>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Mockup UI logic — state switcher, collapsibles, calendar
  //  (unchanged behaviour from the pre-split mockup, just wrapped in initUi)
  // ───────────────────────────────────────────────────────────────────────────
  function initUi() {
    const btns = document.querySelectorAll('.state-btn');
    const body = document.body;

    function resetCollapsibles() {
      const currentState = body.getAttribute('data-state');
      document.querySelectorAll('.collapsible').forEach((c) => {
        const defaultExpand = c.getAttribute('data-default-expand-states') || '';
        const shouldExpand = defaultExpand
          .split(/\s+/)
          .filter(Boolean)
          .includes(currentState);
        c.setAttribute('data-expanded', shouldExpand ? 'true' : 'false');
      });
    }
    resetCollapsibles();

    btns.forEach((btn) => {
      btn.addEventListener('click', () => {
        btns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        body.setAttribute('data-state', btn.dataset.target);
        resetCollapsibles();
        const sb = document.querySelector('.scroll-body');
        if (sb) sb.scrollTop = 0;
      });
    });

    // Bottom nav — switch pages
    document.querySelectorAll('.nav-btn[data-page-link]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.pageLink;
        body.setAttribute('data-page', target);
        resetCollapsibles();
        const sb = document.querySelector('.scroll-body');
        if (sb) sb.scrollTop = 0;
      });
    });

    // Collapsible toggle — delegated handler
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('.collapsible-trigger');
      if (!trigger) return;
      if (e.target.closest('.collapsible-body')) return;
      const collapsible = trigger.closest('.collapsible');
      if (!collapsible) return;
      const isOpen = collapsible.getAttribute('data-expanded') === 'true';
      collapsible.setAttribute('data-expanded', isOpen ? 'false' : 'true');
    });

    // In-portal tab navigation — intercept anchor clicks where href is a
    // hash matching a known page name. Backend uses these as a sentinel to
    // route CTAs into another tab (e.g. S2 Resumen → "VER EL POST
    // PROPUESTO →" jumps to the Calendario tab).
    const PAGE_HASHES = new Set(['#resumen', '#reviews', '#calendar', '#chatbot', '#faq', '#settings']);
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || !PAGE_HASHES.has(href)) return;
      e.preventDefault();
      const target = href.slice(1);
      body.setAttribute('data-page', target);
      resetCollapsibles();
      const sb = document.querySelector('.scroll-body');
      if (sb) sb.scrollTop = 0;
    });

    injectCreateButtons();
  }

  // Inline onclick handlers in the HTML call openExpand / closeExpand —
  // they have to live on `window`.
  window.openExpand = function (ctx, data) {
    const panel = document.getElementById('expand-' + ctx);
    if (!panel) return;

    const statusEl = document.getElementById('expand-' + ctx + '-status');
    const imgEl = document.getElementById('expand-' + ctx + '-img');
    const labelEl = document.getElementById('expand-' + ctx + '-label');
    const dateEl = document.getElementById('expand-' + ctx + '-date');
    const captionEl = document.getElementById('expand-' + ctx + '-caption');

    if (statusEl) {
      statusEl.textContent = data.status;
      statusEl.className = 'post-expand-status ' + (data.statusClass || '');
    }
    if (imgEl) imgEl.className = 'post-expand-img' + (data.alt ? ' alt' : '');
    if (labelEl) labelEl.textContent = data.label;
    if (dateEl) dateEl.textContent = data.date;
    if (captionEl) {
      captionEl.textContent = data.caption;
      captionEl.setAttribute('contenteditable', data.suggested ? 'true' : 'false');
    }

    const actions = panel.querySelector('.post-expand-actions');
    if (actions) {
      if (data.statusClass === 'published') {
        actions.style.display = 'none';
      } else {
        actions.style.display = 'flex';
        const primaryBtn = actions.querySelector('.cta-btn:not(.secondary)');
        if (primaryBtn) {
          primaryBtn.textContent =
            data.statusClass === 'scheduled' ? 'Editar texto' : 'Aprobar →';
        }
      }
    }

    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  window.closeExpand = function (ctx) {
    const panel = document.getElementById('expand-' + ctx);
    if (panel) panel.style.display = 'none';
  };

  function injectCreateButtons() {
    document
      .querySelectorAll('.cal-s3 .cal-grid, .cal-s4 .cal-grid, .cal-paid .cal-grid')
      .forEach((grid) => {
        const today = 21; // Mockup "today" is April 21
        grid.querySelectorAll('.cal-day').forEach((day) => {
          if (day.classList.contains('outside')) return;
          if (day.querySelector('.cal-post')) return;
          if (day.querySelector('.cal-day-create')) return;
          const numEl = day.querySelector('.cal-day-num');
          if (!numEl) return;
          const dayNum = parseInt(numEl.textContent, 10);
          if (dayNum < today) {
            day.classList.add('past');
            return;
          }
          const btn = document.createElement('button');
          btn.className = 'cal-day-create';
          btn.textContent = '+';
          btn.setAttribute('aria-label', 'Crear post para el día ' + dayNum);
          btn.onclick = (e) => {
            e.stopPropagation();
          };
          day.appendChild(btn);
        });
      });
  }
})();
