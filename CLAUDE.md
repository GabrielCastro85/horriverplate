# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev               # Development with auto-reload (nodemon)
npm start                 # Production: node server.js
npm run prisma:migrate    # Create and apply Prisma migrations
npm run prisma:generate   # Regenerate Prisma Client after schema changes
npm run prisma:seed       # Seed DB (admin account + achievements)
npm run overall:recalc    # Batch recalculate all player overall ratings
npm run achievements:recalc  # Batch recompute all player achievements
```

No test framework is configured — testing is manual.

## Architecture

**Stack:** Node.js 20, Express.js, PostgreSQL (Prisma ORM), EJS templates, Tailwind CSS.

**Request flow:** HTTP request → `server.js` → route handler in `routes/` → service/util in `services/` or `utils/` → Prisma → PostgreSQL → EJS view rendered.

### Key directories

| Path | Purpose |
|------|---------|
| `routes/` | Express route handlers (13 files + `routes/admin/` sub-routes) |
| `views/` | EJS templates with `layout.ejs` / `admin_layout.ejs` as wrappers |
| `services/` | Complex business logic — finance automation, reporting, analytics |
| `controllers/adminFinance.controller.js` | Finance CRUD (bulk operations) |
| `helpers/` | Stateless formatting/validation for finance, voting, status |
| `utils/` | Core: `db.js` (Prisma singleton), `auth.js` (JWT), `overall.js` (ratings), `achievements.js`, `ranking.js`, `page_cache.js` |
| `constants/finance.js` | Finance enums and UI metadata maps |
| `prisma/` | `schema.prisma` (20 models), migrations, seed scripts |
| `scripts/` | CLI utilities: bulk imports, rating recalc, admin bootstrapping |
| `public/` | Static assets; `public/uploads/` is runtime (gitignored) |

### Authentication

JWT tokens stored in cookies (2-hour expiry). The `requireAdmin` middleware in `routes/admin/shared.js` gates all admin routes. CSRF protection (csurf) is active on all non-GET, non-voting forms.

### Finance module

The largest subsystem. Entry point is `routes/admin_finance.js` → `controllers/adminFinance.controller.js` → `services/finance*.js`. It handles: monthly fee generation, status tracking (`MonthlyFeeStatus`: PENDING/PAID/PARTIAL/EXEMPT), charge escalation automation, PDF exports (Puppeteer), Excel imports (XLSX), audit logs (`FinanceEventLog`), and analytics.

### Rating system

Player "overall" ratings are computed in `utils/overall.js` using a weighted formula across position-specific stats. `utils/match_ratings.js` computes per-match ratings. Recalculation is triggered via the npm script or directly from admin panel.

### Skin system

The app switches between "default" and "game-day" themes. Game-day activates automatically on Tuesdays but can be overridden via cookie. Theme logic lives in `server.js`.

### Caching

`utils/page_cache.js` provides in-memory caching (60s TTL for home page). Image thumbnails are cached as WebP via Sharp with 30-day HTTP headers. Cache-bust static assets with `ASSET_VERSION` env var.

## Environment variables

Copy `.env.example` → `.env`. Key vars:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string (SSL required in prod) |
| `JWT_SECRET` | Token signing key |
| `SITE_URL` | Public URL for meta/OG tags |
| `PUPPETEER_EXECUTABLE_PATH` / `CHROME_PATH` | Path to Chrome binary for PDF generation |
| `ASSET_VERSION` | Cache-busting suffix for CSS/JS |
| `NODE_ENV` | `development` or `production` (controls backup scheduling) |

## Database

After editing `prisma/schema.prisma`, always run `npm run prisma:migrate` to create the migration and `npm run prisma:generate` to sync the client. On Render, the post-deploy hook runs `npx prisma migrate deploy` automatically.

Prisma binary targets: `native` (dev) + `debian-openssl-3.0.x` (production). Both are declared in `schema.prisma` — do not remove either.

## Deployment

See `DEPLOYMENT.md` for full Render deployment steps. The post-install hook (`postinstall` in `package.json`) runs `prisma generate` and installs Puppeteer's Chrome automatically.
