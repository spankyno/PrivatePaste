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

### Paso 8b — Cloudflare Turnstile (anti-bot en el registro)
1. Dashboard de Cloudflare → Turnstile → Add site → widget tipo "Managed" (o "Invisible")
2. Copiar el **Site Key** (público) → añadirlo como `VITE_TURNSTILE_SITE_KEY` en `frontend/.env`
   (o como variable de entorno del build en tu pipeline de CI)
3. Copiar el **Secret Key** → `npx wrangler secret put TURNSTILE_SECRET_KEY`
   (nunca en wrangler.toml, ver comentario en ese archivo)

### Paso 8c — Resend (verificación de email)
1. Crear cuenta en [resend.com](https://resend.com) (tiene plan gratuito)
2. Verificar tu dominio en Resend (Domains → Add Domain, añadir los registros DNS que pida)
   — sin dominio verificado, Resend solo deja enviar a la dirección con la que te registraste
3. Editar `EMAIL_FROM` en `wrangler.toml` con una dirección de ese dominio, p. ej. `PrivatePaste <verify@tudominio.com>`
4. Crear una API Key en Resend → `npx wrangler secret put RESEND_API_KEY`
   (nunca en wrangler.toml)

### Paso 9 — Primer deploy automático
Push a main → GitHub Actions → pestaña Actions para ver el progreso
URL resultante: https://privatepaste.TU_USUARIO.workers.dev

### Paso 10 — Actualizar baseURL
Editar worker/src/routes/auth.ts → cambiar your-domain.workers.dev → tu URL real → commit

## Ascender usuario a Pro
Dashboard → D1 → privatepaste-db → Console:
UPDATE users SET role = 'pro' WHERE email = 'tu@email.com';

## Tests
```bash
npm test              # desde la raíz — ejecuta la suite del worker
npm test -w worker     # equivalente, explícito
npm run test:watch -w worker   # modo watch
```
Usa [Vitest](https://vitest.dev) con [`@cloudflare/vitest-pool-workers`](https://developers.cloudflare.com/workers/testing/vitest-integration/):
los tests corren dentro del runtime real de Workers (workerd), con una base de
datos D1 efímera y aislada por fichero de test (se le aplican las migraciones
reales de `migrations/` antes de cada suite — nunca toca la base de datos real). 

Cobertura actual: `lib/password.ts` (PBKDF2 + compatibilidad con hashes legacy),
`lib/tiers.ts` (roles, límites por tier, caducidad Pro) y los endpoints de
`/api/auth/*` (sign-up, sign-in, change-password, honeypot, Turnstile, rate 
limiting, invalidación de sesiones). Pendiente de cubrir: `routes/pastes.ts`
y `routes/folders.ts`. 

## Documentación de la API
La especificación OpenAPI 3.1 está en [`docs/openapi.yaml`](./docs/openapi.yaml).
Para verla de forma interactiva sin instalar nada, pega el contenido en
[editor.swagger.io](https://editor.swagger.io/), o localmente:
```bash
npx @redocly/cli preview-docs docs/openapi.yaml
```

