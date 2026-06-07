package handlers

import (
	"context"
	"errors"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var errSessionForbidden = errors.New("session does not belong to user")

func ensureSession(ctx context.Context, pool *pgxpool.Pool, sessionID, userID string) error {
	log.Printf("ensureSession: start session_id=%q user_id=%q", sessionID, userID)

	if userID == "" {
		log.Printf("ensureSession: aborting because user_id is empty")
		return fmt.Errorf("user_id is empty")
	}

	log.Printf("ensureSession: inserting session with id + user_id only (origin deferred)")
	tag, err := pool.Exec(ctx, `
		INSERT INTO sessions (id, user_id)
		VALUES ($1::uuid, $2::uuid)
		ON CONFLICT (id) DO NOTHING
	`, sessionID, userID)
	if err != nil {
		log.Printf(
			"ensureSession: INSERT INTO sessions failed session_id=%q user_id=%q: %v",
			sessionID,
			userID,
			err,
		)
		return err
	}
	log.Printf("ensureSession: INSERT ok session_id=%q rows_affected=%d", sessionID, tag.RowsAffected())

	var ownerID string
	err = pool.QueryRow(ctx, `
		SELECT user_id::text
		FROM sessions
		WHERE id = $1::uuid
	`, sessionID).Scan(&ownerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			log.Printf("ensureSession: session %q missing after insert", sessionID)
			return fmt.Errorf("session not found after insert")
		}
		log.Printf("ensureSession: SELECT user_id failed session_id=%q: %v", sessionID, err)
		return err
	}

	log.Printf("ensureSession: found session_id=%q owner_id=%q", sessionID, ownerID)
	if ownerID != userID {
		log.Printf(
			"ensureSession: forbidden session_id=%q owner_id=%q requested_user_id=%q",
			sessionID,
			ownerID,
			userID,
		)
		return errSessionForbidden
	}

	log.Printf("ensureSession: ok session_id=%q", sessionID)
	return nil
}

func sessionOwnedByUser(ctx context.Context, pool *pgxpool.Pool, sessionID, userID string) (bool, error) {
	var ownerID string
	err := pool.QueryRow(ctx, `
		SELECT user_id::text
		FROM sessions
		WHERE id = $1::uuid
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
		WHERE r.id = $1::uuid
	`, routeID).Scan(&ownerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return ownerID == userID, nil
}
