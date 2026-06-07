package main

import (
	"context"
	"errors"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Christopher4113/Haul/server/internal/optimizer"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL is required")
	}

	placesKey := os.Getenv("GOOGLE_PLACES_KEY")
	_ = placesKey

	routeID := os.Getenv("ROUTE_ID")
	if routeID == "" {
		log.Fatal("ROUTE_ID is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		log.Fatalf("failed to create database pool: %v", err)
	}
	defer pool.Close()

	var sessionID string
	err = pool.QueryRow(ctx, `
		SELECT session_id::text
		FROM routes
		WHERE id = $1::uuid
	`, routeID).Scan(&sessionID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			log.Fatalf("route %s not found", routeID)
		}
		log.Fatalf("failed to load route %s: %v", routeID, err)
	}

	log.Printf("starting optimizer job for route %s session %s", routeID, sessionID)
	routesKey := os.Getenv("GOOGLE_ROUTES_KEY")
	optimizer.Run(context.Background(), pool, routeID, sessionID, routesKey)
	log.Printf("optimizer job finished for route %s", routeID)
}
