# Haul

Smart errand batcher — add your stops, optimize the route, respect store hours, and get home faster.

Haul is a full-stack app with a React PWA frontend and a Go API backed by PostgreSQL/PostGIS. Route optimization clusters stops geographically, checks store hours, and streams results to the map in real time.

## Features

- **Spatial clustering** — groups errands by geography, not just straight-line distance
- **Store-hours aware routing** — skips closed stops and reorders around open windows
- **Live route streaming** — optimization progress streams to the client over SSE
- **Session history** — save, reload, and delete past errand runs
- **Auth** — email/password signup, JWT sessions, and password reset via SMTP

## Architecture

```
client/          React + Vite PWA (MapLibre map UI)
server/          Go API (chi router, pgx, JWT auth)
  cmd/api/       HTTP server
  cmd/optimizer/ Standalone optimizer worker (K8s jobs)
k8s/             Kubernetes manifests (optional production setup)
docker/          Dockerfiles for API and optimizer
```

The API handles auth, errands, sessions, and route optimization. When a user requests optimization, the server either spawns a Kubernetes Job (if configured) or falls back to running the optimizer in-process.

**Database:** PostgreSQL with PostGIS for geographic queries. Migrations run automatically on API startup.

## Prerequisites

- [Go](https://go.dev/dl/) 1.26+
- [Node.js](https://nodejs.org/) 20+
- PostgreSQL with PostGIS (local Docker, [Neon](https://neon.tech), etc.)
- Google Cloud API keys for Places and Routes (optional but required for full functionality)
- Gmail app password or other SMTP credentials (optional; needed for password-reset emails)

## Local development

### 1. Database

**Option A — Docker Compose (includes PostGIS):**

```bash
docker compose up -d postgres
```

Then point `DATABASE_URL` at the local instance:

```
postgresql://haul:haul@localhost:5432/haul
```

**Option B — Neon or another hosted Postgres**

Use your provider's connection string. PostGIS must be available (`CREATE EXTENSION postgis` runs on first migrate).

### 2. API

Create `server/.env`:

```env
DATABASE_URL=postgresql://haul:haul@localhost:5432/haul
JWT_SECRET=your-long-random-secret
SMTP_USER=you@example.com
SMTP_PASS=your-app-password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
CLIENT_URL=http://localhost:5173
GOOGLE_PLACES_KEY=your-google-places-key
GOOGLE_ROUTES_KEY=your-google-routes-key
```

Run the API:

```bash
cd server
go run ./cmd/api
```

The server listens on `:8080` by default (override with `PORT`). Migrations run on startup. Health check: `GET /health`.

### 3. Frontend

Create `client/.env.local`:

```env
VITE_API_URL=http://localhost:8080
```

Run the client:

```bash
cd client
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### 4. Docker Compose (API + Postgres)

With `server/.env` populated, you can run the API and database together:

```bash
docker compose up --build
```

## Environment variables

### API (`server/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (PostGIS required) |
| `JWT_SECRET` | Yes | Secret used to sign auth tokens |
| `CLIENT_URL` | No | Frontend URL for password-reset links (default: `http://localhost:5173`) |
| `SMTP_USER` | No | SMTP username for transactional email |
| `SMTP_PASS` | No | SMTP password / app password |
| `SMTP_HOST` | No | SMTP host (default: `smtp.gmail.com`) |
| `SMTP_PORT` | No | SMTP port (default: `465`) |
| `SMTP_FROM` | No | From address (default: `SMTP_USER`) |
| `GOOGLE_PLACES_KEY` | No | Google Places API key for geocoding and store hours |
| `GOOGLE_ROUTES_KEY` | No | Google Routes API key for driving directions |
| `ENV` | No | `development` or `production` (default: `development`) |
| `PORT` | No | HTTP port (default: `8080`) |

### Frontend (`client/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | Yes | Base URL of the API (e.g. `http://localhost:8080`) |

## API endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Health check |
| `POST` | `/api/auth/register` | No | Create account |
| `POST` | `/api/auth/login` | No | Login |
| `POST` | `/api/auth/forgot-password` | No | Request password reset email |
| `POST` | `/api/auth/reset-password` | No | Reset password with token |
| `GET` | `/api/auth/me` | Yes | Current user |
| `POST` | `/api/errands` | Yes | Create errands for a session |
| `POST` | `/api/routes/optimize` | Yes | Start route optimization |
| `GET` | `/api/routes/{route_id}/stream` | Yes | SSE stream of optimization events |
| `GET` | `/api/sessions` | Yes | List saved sessions |
| `PATCH` | `/api/sessions/{session_id}` | Yes | Update session |
| `DELETE` | `/api/sessions/{session_id}` | Yes | Delete session |

## Deploying to Render

Haul deploys as two Render services: a **Web Service** for the API and a **Static Site** for the frontend.

### API (Web Service)

| Setting | Value |
|---------|-------|
| Language | Go |
| Root Directory | `server` |
| Build Command | `go build -o server ./cmd/api` |
| Start Command | `./server` |

**Environment variables:** set all required API vars from the table above. Use your production frontend URL for `CLIENT_URL` and your Neon `DATABASE_URL`.

If the build fails on Go version, add:

```
GOTOOLCHAIN=auto
```

Render sets `PORT` automatically; the app reads it.

On Render without Kubernetes, route optimization runs in-process (the API already falls back when K8s is unavailable).

### Frontend (Static Site)

| Setting | Value |
|---------|-------|
| Root Directory | `client` |
| Build Command | `npm install && npm run build` |
| Publish Directory | `dist` |

**Environment variable:**

```
VITE_API_URL=https://<your-api-service>.onrender.com
```

After the frontend is live, update the API's `CLIENT_URL` to the static site URL so password-reset emails link correctly.

## Kubernetes (optional)

For local or self-hosted production with background optimizer jobs:

1. Populate `k8s/secret.yaml` with your secrets.
2. Build images and apply manifests:

```powershell
.\scripts\k8s-deploy.ps1
```

3. Port-forward the API:

```bash
kubectl port-forward svc/haul-api 8080:8080 -n haul
```

The API service account can spawn optimizer Jobs defined in `k8s/optimizer-job-template.yaml`.

## Project structure

```
Haul/
├── client/                 # React frontend
│   ├── src/
│   │   ├── pages/          # Landing, login, dashboard, app
│   │   ├── components/     # UI and map components
│   │   └── lib/            # API client, geo helpers
│   └── public/             # PWA icons and assets
├── server/
│   ├── cmd/
│   │   ├── api/            # HTTP server entrypoint
│   │   └── optimizer/      # Optimizer worker entrypoint
│   └── internal/
│       ├── handlers/       # HTTP handlers
│       ├── optimizer/      # Clustering, routing, K8s spawner
│       ├── clustering/     # K-means spatial clustering
│       ├── routing/        # Google Routes integration
│       ├── places/         # Google Places integration
│       ├── storehours/     # Store hours logic
│       ├── auth/           # JWT and password hashing
│       ├── db/             # Schema migrations
│       └── mailer/         # Password-reset email
├── k8s/                    # Kubernetes manifests
├── docker/                 # Dockerfiles
├── scripts/                # Deploy helpers
└── docker-compose.yml      # Local Postgres + API
```

## Scripts

| Command | Location | Description |
|---------|----------|-------------|
| `npm run dev` | `client/` | Start Vite dev server |
| `npm run build` | `client/` | Production frontend build |
| `go run ./cmd/api` | `server/` | Run API locally |
| `go run ./cmd/optimizer` | `server/` | Run optimizer worker manually |
| `docker compose up` | repo root | Start Postgres + API |

## License

Private project.
