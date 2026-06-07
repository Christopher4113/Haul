package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

const migrationSQL = `
CREATE TABLE IF NOT EXISTS users (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	email TEXT NOT NULL UNIQUE,
	password_hash TEXT NOT NULL,
	name TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	token_hash TEXT NOT NULL UNIQUE,
	expires_at TIMESTAMPTZ NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS sessions (
	id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
	user_id    UUID NOT NULL,
	origin     GEOGRAPHY(POINT, 4326),
	created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS errands (
	id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
	session_id  UUID REFERENCES sessions(id) ON DELETE CASCADE,
	name        TEXT NOT NULL,
	address     TEXT NOT NULL,
	location    GEOGRAPHY(POINT, 4326),
	place_id    TEXT,
	cluster_id  INT,
	seq_order   INT,
	created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_errands_location ON errands USING GIST(location);

CREATE TABLE IF NOT EXISTS routes (
	id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
	session_id    UUID REFERENCES sessions(id),
	status        TEXT DEFAULT 'pending',
	geojson       JSONB,
	total_km      FLOAT,
	total_mins    INT,
	cluster_count INT,
	created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS optimizer_events (
	id          BIGSERIAL PRIMARY KEY,
	route_id    UUID REFERENCES routes(id),
	event_type  TEXT,
	payload     JSONB,
	created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS store_hours (
	place_id   TEXT PRIMARY KEY,
	hours_json JSONB,
	open_now   BOOLEAN,
	opens_at   TIME,
	closes_at  TIME,
	fetched_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS saved_at TIMESTAMPTZ;

ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_session_id_fkey;
ALTER TABLE routes
	ADD CONSTRAINT routes_session_id_fkey
	FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;

ALTER TABLE optimizer_events DROP CONSTRAINT IF EXISTS optimizer_events_route_id_fkey;
ALTER TABLE optimizer_events
	ADD CONSTRAINT optimizer_events_route_id_fkey
	FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE;
`

func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, migrationSQL)
	return err
}
