package handlers

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var errSessionForbidden = errors.New("session does not belong to user")

func ensureSession(ctx context.Context, pool *pgxpool.Pool, sessionID, userID string) error {
	var ownerID *string
	err := pool.QueryRow(ctx, `
		SELECT user_id::text
		FROM sessions
		WHERE id = $1
	`, sessionID).Scan(&ownerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			_, err = pool.Exec(ctx, `
				INSERT INTO sessions (id, user_id)
				VALUES ($1, $2)
			`, sessionID, userID)
			return err
		}
		return err
	}

	if ownerID == nil || *ownerID != userID {
		return errSessionForbidden
	}

	return nil
}

func sessionOwnedByUser(ctx context.Context, pool *pgxpool.Pool, sessionID, userID string) (bool, error) {
	var ownerID string
	err := pool.QueryRow(ctx, `
		SELECT user_id::text
		FROM sessions
		WHERE id = $1
	`, sessionID).Scan(&ownerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return ownerID == userID, nil
}

func routeOwnedByUser(ctx context.Context, pool *pgxpool.Pool, routeID, userID string) (bool, error) {
	var ownerID string
	err := pool.QueryRow(ctx, `
		SELECT s.user_id::text
		FROM routes r
		JOIN sessions s ON s.id = r.session_id
		WHERE r.id = $1
	`, routeID).Scan(&ownerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return ownerID == userID, nil
}
