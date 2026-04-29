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

  const slug = new URLSearchParams(location.search).get('v');

  if (slug) {
    fetchResumen(slug);
  } else {
    initUi();
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Fetch + error handling
  // ───────────────────────────────────────────────────────────────────────────
  async function fetchResumen(slug) {
    const url = `${API_BASE}/portal/${encodeURIComponent(slug)}/resumen`;
    let resp;
    try {
      resp = await fetch(url, { credentials: 'include' });
    } catch (_err) {
      return showError('No se pudo conectar con el servidor.');
    }

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
    } catch (_err) {
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
    if (resumen && resumen.state) {
      document.body.dataset.state = resumen.state;
    }
    if (resumen && resumen.venue && resumen.venue.name) {
      const tag = document.querySelector('.venue-tag');
      if (tag) tag.textContent = resumen.venue.name;
    }
    const labHeader = document.querySelector('.lab-header');
    if (labHeader) labHeader.style.display = 'none';
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
