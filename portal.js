  const btns = document.querySelectorAll('.state-btn');
  const body = document.body;

  // Reset all collapsibles back to default for the current state.
  // A collapsible can opt into "default-expanded for state X" via
  // data-default-expand-states="s0 s1" (space-separated state names).
  function resetCollapsibles() {
    const currentState = body.getAttribute('data-state');
    document.querySelectorAll('.collapsible').forEach(c => {
      const defaultExpand = c.getAttribute('data-default-expand-states') || '';
      const shouldExpand = defaultExpand.split(/\s+/).filter(Boolean).includes(currentState);
      c.setAttribute('data-expanded', shouldExpand ? 'true' : 'false');
    });
  }
  // Initial load: honor default-expand for the starting state
  resetCollapsibles();

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      body.setAttribute('data-state', btn.dataset.target);
      resetCollapsibles();
      const sb = document.querySelector('.scroll-body');
      if (sb) sb.scrollTop = 0;
    });
  });

  // Bottom nav — switch pages
  document.querySelectorAll('.nav-btn[data-page-link]').forEach(btn => {
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
    // Don't toggle if user clicked an interactive element inside the body of an expanded section
    if (e.target.closest('.collapsible-body')) return;
    const collapsible = trigger.closest('.collapsible');
    if (!collapsible) return;
    const isOpen = collapsible.getAttribute('data-expanded') === 'true';
    collapsible.setAttribute('data-expanded', isOpen ? 'false' : 'true');
  });

  // Calendar — expand/collapse post panel
  function openExpand(ctx, data) {
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
    if (imgEl) {
      imgEl.className = 'post-expand-img' + (data.alt ? ' alt' : '');
    }
    if (labelEl) labelEl.textContent = data.label;
    if (dateEl) dateEl.textContent = data.date;
    if (captionEl) {
      captionEl.textContent = data.caption;
      captionEl.setAttribute('contenteditable', data.suggested ? 'true' : 'false');
    }

    // Update action buttons based on state
    const actions = panel.querySelector('.post-expand-actions');
    if (actions) {
      if (data.statusClass === 'published') {
        actions.style.display = 'none';
      } else {
        actions.style.display = 'flex';
        // Change "Aprobar" label if already approved
        const primaryBtn = actions.querySelector('.cta-btn:not(.secondary)');
        if (primaryBtn) {
          primaryBtn.textContent = data.statusClass === 'scheduled' ? 'Editar texto' : 'Aprobar →';
        }
      }
    }

    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeExpand(ctx) {
    const panel = document.getElementById('expand-' + ctx);
    if (panel) panel.style.display = 'none';
  }

  // Inject "+ post" create buttons into empty future days in S3/S4 and PAID calendars
  function injectCreateButtons() {
    // Only for S3/S4/PAID wrappers (cal-s3, cal-s4, cal-paid classes). S2 is "propose only" — no create.
    document.querySelectorAll('.cal-s3 .cal-grid, .cal-s4 .cal-grid, .cal-paid .cal-grid').forEach(grid => {
      const today = 21; // Mockup "today" is April 21
      grid.querySelectorAll('.cal-day').forEach(day => {
        if (day.classList.contains('outside')) return;
        if (day.querySelector('.cal-post')) return; // already has a post
        if (day.querySelector('.cal-day-create')) return; // already has a create button
        const numEl = day.querySelector('.cal-day-num');
        if (!numEl) return;
        const dayNum = parseInt(numEl.textContent, 10);
        if (dayNum < today) {
          day.classList.add('past'); // past days won't get create button
          return;
        }
        // Inject create button
        const btn = document.createElement('button');
        btn.className = 'cal-day-create';
        btn.textContent = '+';
        btn.setAttribute('aria-label', 'Crear post para el día ' + dayNum);
        btn.onclick = (e) => {
          e.stopPropagation();
          // In production: whatsapp deep-link with pre-filled "quiero crear un post para el día X"
        };
        day.appendChild(btn);
      });
    });
  }
  injectCreateButtons();
