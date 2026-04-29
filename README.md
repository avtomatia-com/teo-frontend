# Teo Frontend — Owner Portal

Static owner portal for [Teo](https://teo.chat), an AI-powered WhatsApp assistant for Spanish bar and restaurant owners.

- **Live URL:** [app.teo.chat](https://app.teo.chat)
- **Backend API:** [api.teo.chat](https://api.teo.chat)
- **Stack:** plain HTML / CSS / JS, served as a static site (no build step).

## Layout

```
teo-frontend/
├── index.html              ← portal markup (8 fixture states, demo state-switcher at the top)
├── portal.css              ← all styles
├── portal.js               ← state-switcher + collapsibles + calendar UI logic
├── RESUMEN_CONTRACT.md     ← API contract for GET /portal/{venue_slug}/resumen
└── README.md
```

The portal currently renders **fixture data** for every progressive state (s0 → free). Wiring `fetch()` to the live `/portal/{slug}/resumen` endpoint is the next slice.

## Deployment

Deployed via Coolify (Hetzner VPS) as a static site. Pushes to `main` trigger an auto-rebuild.
