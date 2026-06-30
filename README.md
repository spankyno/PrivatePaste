# PrivatePaste

Pastebin moderno y privado desplegado en el edge de Cloudflare.
**Setup 100% desde el navegador** — sin terminal local necesaria.

## Stack

| Capa | Tecnología |
|---|---|
| Runtime | Cloudflare Workers |
| Framework | Hono 4 |
| Base de datos | Cloudflare D1 (SQLite) + Drizzle ORM |
| Rate limiting | Cloudflare Workers KV |
| Auth | better-auth (email+password) |
| Frontend | React 18 + TypeScript + Vite + Tailwind |
| Editor | CodeMirror 6 |
| IDs | nanoid (8 chars) |
| CI/CD | GitHub Actions → Cloudflare Workers |

---

## Setup desde el navegador (sin terminal)

### Paso 1 — Crear cuenta Cloudflare
Ir a https://dash.cloudflare.com/sign-up. Plan Free, no necesitas tarjeta.

### Paso 2 — Crear base de datos D1
1. Dashboard → Workers & Pages → D1 → Create database
2. Nombre: privatepaste-db → Create
3. Pestaña Console → pegar y ejecutar migrations/0001_initial_schema.sql
4. Copiar el Database ID

### Paso 3 — Crear KV Namespace
1. Workers & Pages → KV → Create a namespace
2. Nombre: RATE_LIMIT_KV → Add
3. Copiar el Namespace ID

### Paso 4 — Crear API Token de Cloudflare
1. https://dash.cloudflare.com/profile/api-tokens → Create Token
2. Plantilla: Edit Cloudflare Workers
3. Guardar el token (solo se muestra una vez)

### Paso 5 — Subir el proyecto a GitHub
1. Crear repo en https://github.com/new (nombre: privatepaste, privado)
2. Subir todos los ficheros

### Paso 6 — Editar wrangler.toml en GitHub
Sustituir YOUR_D1_DATABASE_ID y YOUR_KV_NAMESPACE_ID con los IDs reales.

### Paso 7 — Configurar Secrets en GitHub
Settings → Secrets and variables → Actions → New repository secret:
- CLOUDFLARE_API_TOKEN → token del paso 4
- CLOUDFLARE_ACCOUNT_ID → tu Account ID de Cloudflare

### Paso 8 — AUTH_SECRET en Cloudflare (tras primer deploy)
Workers & Pages → privatepaste → Settings → Variables and Secrets
Añadir Secret: AUTH_SECRET = string aleatorio 32+ chars

### Paso 9 — Primer deploy automático
Push a main → GitHub Actions → pestaña Actions para ver el progreso
URL resultante: https://privatepaste.TU_USUARIO.workers.dev

### Paso 10 — Actualizar baseURL
Editar worker/src/routes/auth.ts → cambiar your-domain.workers.dev → tu URL real → commit

## Ascender usuario a Pro
Dashboard → D1 → privatepaste-db → Console:
UPDATE users SET role = 'pro' WHERE email = 'tu@email.com';
