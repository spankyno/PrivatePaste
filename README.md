# PrivatePaste

A modern, private, edge-deployed Pastebin alternative built on Cloudflare Workers.

## Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers (edge) |
| Framework | Hono 4 |
| Database | Cloudflare D1 (SQLite) + Drizzle ORM |
| Cache / Rate limit | Cloudflare Workers KV |
| Auth | better-auth (email+password, sessions in D1) |
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS (dark mode) |
| Editor | CodeMirror 6 (@uiw/react-codemirror) |
| IDs | nanoid (8-char URL-safe) |
| Cleanup | Workers Cron Triggers |

## Features

- ✅ Create paste → short URL (`/p/abc123xy`)
- ✅ Syntax highlighting (16+ languages via CodeMirror)
- ✅ Raw view (`/raw/:id`)
- ✅ Configurable expiry (1h / 3d / 30d / 90d / 300d / Never)
- ✅ Dark mode (system preference + manual toggle)
- ✅ Email + password auth (better-auth)
- ✅ Private pastes (owner only)
- ✅ Password-protected pastes
- ✅ Folder / project organisation
- ✅ Full-text search (SQLite FTS5)
- ✅ Auto-cleanup cron (hourly)
- ✅ Tier-based rate limiting (anonymous / registered / pro)

## Tier Limits

| | Anonymous | Registered | Pro |
|---|---|---|---|
| Active pastes | 10 | 100 | ~10,000 |
| Max size | 512 KB | 2 MB | 10 MB |
| Max expiry | 3 days | 90 days | Never |
| Pastes/day | 5 | 20 | 500 |
| API rate (15 min) | 5 | 30 | 100 |
| Requests/day | 200 | 5,000 | 50,000 |
| Cleanup | Aggressive | Normal | Archive |

## Setup

### Prerequisites

- Node.js 20+
- Wrangler CLI (`npm i -g wrangler`)
- Cloudflare account (free)

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USER/privatepaste
cd privatepaste
npm install
```

### 2. Create Cloudflare resources

```bash
# Login to Cloudflare
wrangler login

# Create D1 database
wrangler d1 create privatepaste-db
# → Copy the database_id into wrangler.toml

# Create KV namespace
wrangler kv:namespace create RATE_LIMIT_KV
# → Copy the id into wrangler.toml
```

### 3. Run migrations

```bash
# Local development
npm run db:migrate:local

# Production
npm run db:migrate
```

### 4. Configure secrets

```bash
# Copy the example and fill in values
cp .dev.vars.example .dev.vars

# For production, use wrangler secrets:
wrangler secret put AUTH_SECRET
```

### 5. Update wrangler.toml

Replace these placeholders in `wrangler.toml`:
- `YOUR_D1_DATABASE_ID` → from step 2
- `YOUR_KV_NAMESPACE_ID` → from step 2
- `https://your-domain.workers.dev` → your actual Worker URL

### 6. Run locally

```bash
npm run dev
# Frontend: http://localhost:5173
# Worker:   http://localhost:8787
```

### 7. Deploy

```bash
npm run deploy
```

## Project Structure

```
privatepaste/
├── worker/                    # Cloudflare Worker (Hono)
│   └── src/
│       ├── index.ts           # Entry point + routes
│       ├── cron.ts            # Scheduled cleanup
│       ├── db/
│       │   ├── schema.ts      # Drizzle schema (single source of truth)
│       │   └── index.ts       # DB client factory
│       ├── lib/
│       │   ├── tiers.ts       # Tier limits (shared with frontend)
│       │   └── types.ts       # Env bindings
│       ├── middleware/
│       │   ├── auth.ts        # Session validation
│       │   └── rateLimit.ts   # KV-backed rate limiter
│       └── routes/
│           ├── auth.ts        # better-auth handler
│           ├── pastes.ts      # CRUD + password unlock
│           └── folders.ts     # Folder management
├── frontend/                  # React SPA
│   └── src/
│       ├── App.tsx            # Router
│       ├── main.tsx           # Entry point
│       ├── index.css          # Tailwind + CSS variables
│       ├── lib/
│       │   ├── api.ts         # Typed API client
│       │   └── languages.ts   # CodeMirror language list
│       ├── hooks/
│       │   ├── useAuth.tsx    # Auth context
│       │   └── useDarkMode.ts # Dark mode toggle
│       ├── components/
│       │   └── layout/
│       │       └── Navbar.tsx
│       └── pages/
│           ├── CreatePaste.tsx
│           ├── ViewPaste.tsx
│           ├── Auth.tsx
│           └── Dashboard.tsx
├── migrations/
│   └── 0001_initial_schema.sql
├── wrangler.toml
├── drizzle.config.ts
└── package.json
```

## Upgrade a user to Pro

```bash
wrangler d1 execute privatepaste-db \
  --command "UPDATE users SET role='pro' WHERE email='user@example.com'"
```

## Add GitHub OAuth (optional)

1. Create a GitHub OAuth App at github.com/settings/applications
2. Set callback URL to `https://your-domain.workers.dev/api/auth/callback/github`
3. Add secrets:
   ```bash
   wrangler secret put GITHUB_CLIENT_ID
   wrangler secret put GITHUB_CLIENT_SECRET
   ```
4. Uncomment the `socialProviders.github` block in `worker/src/routes/auth.ts`

## License

MIT
