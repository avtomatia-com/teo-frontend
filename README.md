# Teo Frontend — Owner Portal

Static owner portal for [Teo](https://teo.chat), an AI-powered WhatsApp assistant for Spanish bar and restaurant owners.

- **Live URL:** [app.teo.chat](https://app.teo.chat)
- **Backend API:** [api.teo.chat](https://api.teo.chat)
- **Stack:** plain HTML / CSS / JS, served as a static site (no build step).

## Layout

```
teo-frontend/
├── index.html                    ← single-file design mockup (will be split into index/css/js)
├── RESUMEN_CONTRACT.md            ← API contract for GET /portal/{venue_slug}/resumen
└── README.md
```

## Deployment

Deployed via Coolify (Hetzner VPS) as a static site. Pushes to `main` trigger an auto-rebuild.
