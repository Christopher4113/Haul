package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Christopher4113/Haul/server/internal/config"
	"github.com/Christopher4113/Haul/server/internal/db"
	"github.com/Christopher4113/Haul/server/internal/handlers"
	"github.com/Christopher4113/Haul/server/internal/mailer"
	"github.com/Christopher4113/Haul/server/internal/middleware"
)

func main() {
	cfg := config.Load()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, cfg.DBURL)
	if err != nil {
		log.Fatalf("failed to create database pool: %v", err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("failed to ping database: %v", err)
	}

	if err := db.Migrate(context.Background(), pool); err != nil {
		log.Fatalf("failed to run migrations: %v", err)
	}

	log.Println("connected to Neon Postgres")

	mail := mailer.New(mailer.Config{
		Host:      cfg.SMTP.Host,
		Port:      cfg.SMTP.Port,
		Username:  cfg.SMTP.Username,
		Password:  cfg.SMTP.Password,
		From:      cfg.SMTP.From,
		ClientURL: cfg.SMTP.ClientURL,
	})

	if mail.Configured() {
		log.Printf("smtp mailer configured for %s", cfg.SMTP.Username)
	} else {
		log.Println("smtp mailer not configured; password reset emails will only log tokens in development")
	}

	authHandler := handlers.NewAuthHandler(pool, cfg, mail)
	authMiddleware := middleware.Auth(cfg.JWTSecret)

	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		if err := pool.Ping(r.Context()); err != nil {
			http.Error(w, "database unavailable", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "ok")
	})

	mux.HandleFunc("POST /api/auth/register", authHandler.Register)
	mux.HandleFunc("POST /api/auth/login", authHandler.Login)
	mux.HandleFunc("POST /api/auth/forgot-password", authHandler.ForgotPassword)
	mux.HandleFunc("POST /api/auth/reset-password", authHandler.ResetPassword)
	mux.Handle("GET /api/auth/me", authMiddleware(http.HandlerFunc(authHandler.Me)))

	log.Printf("listening on :%s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, middleware.CORS(mux)); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
