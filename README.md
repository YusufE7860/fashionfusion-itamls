# Fashion Fusion — IT Asset Management & Logistics System (ITAMLS)

A purpose-built ERP-style platform for the Fashion Fusion IT department: every asset, every store, every movement — visible and audit-ready in one place.

```
apps/
  api/      NestJS + Prisma + PostgreSQL — the single source of truth
  web/      React 18 + Vite + TypeScript + Tailwind — admin & ops console
  mobile/   React Native + Expo — technician companion app
packages/
  shared/   Shared enums, permissions, DTOs
tools/      PowerShell discovery agent + Kaseya VSA deployment guide
docker-compose.yml   PostgreSQL + MinIO + Redis (dev stack)
```

---

## Modules in this build

| # | Module | API | Web | Mobile |
|---|---|---|---|---|
| 1 | Inventory (assets, history, condition) | ✓ | ✓ | ✓ scan + view |
| 2 | Multi-location stock control | ✓ | ✓ | — |
| 3 | GRV (Goods Received Voucher) | ✓ | ✓ | — |
| 4 | IBT (Internal Branch Transfer) | ✓ | ✓ | — |
| 5 | Dispatching — PDF note, box numbers, e-signature | ✓ | ✓ | ✓ receive + sign |
| 6 | Asset tracking with full movement history | ✓ | ✓ | ✓ |
| 7 | Store Deployment Wizard (auto equipment + costing) | ✓ | ✓ | — |
| 8 | Procurement (PR → IT → Finance → PO) | ✓ | ✓ | — |
| 9 | Invoice Repository (MinIO upload + search) | ✓ | ✓ | — |
| 10 | Repairs & RMA | ✓ | ✓ | ✓ log fault |
| 11 | Warranty management (30/60/90 dashboard) | ✓ | ✓ | view |
| 12 | Asset Auditing (mobile scan, variance, complete) | ✓ | ✓ | ✓ scan + variance |
| 13 | Barcode / QR codes + printable labels | ✓ | ✓ | ✓ camera scan |
| 14 | Reporting + PDF / Excel exports | ✓ | ✓ | — |
| 15 | Helpdesk integration (Freshservice / Jira SM) | ✓ | ✓ | — |
| 16 | User roles + RBAC | ✓ | ✓ | ✓ |
| 17 | Mobile app (offline-capable, scan-first) | — | — | ✓ |
| + | Store Standards Compliance (template-driven) | ✓ | ✓ | — |
| + | Auto-discovery via Kaseya VSA (PowerShell agent) | ✓ | ✓ | — |
| + | Depreciation engine (monthly straight-line) | ✓ | — | — |
| + | Alerts engine (warranty / stock / compliance / repair) | ✓ | ✓ | view |
| + | API key management for external scripts | ✓ | ✓ | — |

---

## Quick start

### Prerequisites

- Node.js **20+**
- pnpm **9+** (`npm i -g pnpm`)
- Docker Desktop
- Expo Go on your phone (for the mobile app)

### One-time setup

```powershell
# Clone / open the folder, then:
pnpm install

# Copy env files
copy .env.example .env
copy apps\api\.env.example apps\api\.env

# Bring up the dev stack: Postgres 16, MinIO, Redis
pnpm stack:up

# Generate the Prisma client + apply migrations
pnpm --filter @itamls/api exec prisma migrate dev --name init

# Seed roles, permissions, categories, SKUs, stores, demo users, sample assets
pnpm --filter @itamls/api exec prisma db seed
```

### Run

In **two terminals**:

```powershell
# Terminal A — API @ http://localhost:4000/api/v1
pnpm api:dev

# Terminal B — Web @ http://localhost:5173
pnpm web:dev
```

Open <http://localhost:5173> and sign in.

| Email | Role | Password |
| --- | --- | --- |
| admin@fashionfusion.local | Administrator | password |
| itmanager@fashionfusion.local | IT Manager | password |
| tech@fashionfusion.local | Technician | password |
| store001@fashionfusion.local | Store Manager (Gateway) | password |
| finance@fashionfusion.local | Finance | password |
| auditor@fashionfusion.local | Auditor | password |

---

## Mobile app

```powershell
pnpm --filter @itamls/mobile start
```

1. Save the logo image as `apps/mobile/assets/fusion-logo.png` (transparent PNG ideal).
2. In `apps/mobile/app.json`, set `extra.apiBaseUrl` to your **laptop's LAN IP**, e.g. `http://192.168.1.42:4000/api/v1`. Phones can't resolve `localhost`.
3. Allow inbound port 4000 in Windows Firewall for the laptop's LAN.
4. Scan the QR code shown in Metro with **Expo Go** on your phone.

See [`apps/mobile/README.md`](apps/mobile/README.md) for the full flow.

---

## Auto-discovery via Kaseya VSA

The `tools/` folder contains a PowerShell agent that reports each Windows endpoint (HQ PCs, store POS PCs, back-office machines) into the asset register.

1. In the web app, go to **API Keys → Generate** (label e.g. *Kaseya VSA discovery*) — copy the key shown once.
2. Push `tools/Invoke-ITAMLSDiscovery.ps1` to your endpoints via Kaseya as a Managed File.
3. Create a daily Run Procedure that invokes it with `-ApiBase`, `-ApiKey`, and `-LocationCode`.

Full walkthrough in [`tools/README.md`](tools/README.md).

---

## Architecture quick reference

- **API** — NestJS 10 modular monolith with `@nestjs/schedule` for cron, Prisma for data, MinIO (S3 API) for files, JWT auth with permission-based RBAC guards.
- **Web** — React 18 + Vite + TypeScript + Tailwind, TanStack Query for server state, Zustand for session.
- **Mobile** — Expo (managed) + expo-router + expo-camera + react-native-signature-canvas; AsyncStorage for token persistence.
- **Design system** — dark theme using `ink` (slate scale) + `brand` (FUSION orange) palettes. Tailwind config in `apps/web/tailwind.config.js` is the source of truth; mobile mirrors it in `apps/mobile/src/theme.ts`.
- **Storage** — Postgres for transactional data, MinIO for invoices / signatures / labels, Redis available for future BullMQ workers.
- **Scheduled jobs** — monthly depreciation (1st @ 02:00), nightly alerts scan (03:00), 30-min helpdesk sync.

## Run the operational jobs manually

From the API while signed in as an Administrator:

```http
POST /api/v1/alerts/run            // populate the alerts table now
POST /api/v1/depreciation/run      // recompute current value across all assets
POST /api/v1/helpdesk/sync         // pull tickets and link to assets
```

The web app exposes the alerts run from the Alerts page; depreciation and helpdesk-sync are admin-only and best triggered from a tool like Postman or curl with a bearer token.

---

## Price lookup for SKUs

Each SKU's catalogue price feeds the value of every asset of that SKU (including ones the Kaseya discovery agent creates). The web app's **Admin → SKUs & Pricing** page has a 🔍 button next to each price field with two modes:

| Mode | Set in `apps/api/.env` | What you get |
| --- | --- | --- |
| `SEARCH_LINKS` (default, free) | `PRICE_LOOKUP_PROVIDER=SEARCH_LINKS` | One-click links to Google Shopping, Takealot, PriceCheck, Incredible Connection for the manufacturer + model. Paste the price you see and Save. |
| `SERPAPI` (paid, automatic) | `PRICE_LOOKUP_PROVIDER=SERPAPI` and `SERPAPI_KEY=...` | Live Google Shopping quotes from multiple retailers, click any one to use that price, or use the auto-suggested median. Results are cached for 30 days. |

To switch to fully automatic: sign up at <https://serpapi.com/> (free tier covers ~100 lookups/month), copy the key into `apps/api/.env`, restart the API.

## Resetting the dev database

```powershell
pnpm stack:down
Remove-Item -Recurse -Force .\volumes
pnpm stack:up
pnpm --filter @itamls/api exec prisma migrate dev --name init
pnpm --filter @itamls/api exec prisma db seed
```

---

## Going to production

A few extras worth thinking through before go-live:

- **Auth**: swap local password for AD/LDAP using Passport-LDAP; keep one local break-glass admin.
- **HTTPS**: front everything with nginx; TLS certs via Let's Encrypt or your internal CA.
- **Backups**: nightly Postgres base backup + WAL streaming, MinIO bucket replication.
- **Observability**: OpenTelemetry → Loki + Grafana + Prometheus.
- **CI/CD**: build & push API + web images to a private registry; deploy with `docker compose up -d` on the target host.
- **Sizing for phase 1**: 4 vCPU / 16 GB RAM per host comfortably serves the expected load.

The design package PDF in this folder (`FashionFusion_ITAM_Design_Package.pdf`) has the full architecture, ERD, RBAC matrix and roadmap.
