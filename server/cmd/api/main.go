package main

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
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

	log.Println("connected to Postgres")

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

	healthHandler := handlers.NewHealthHandler(pool)
	authHandler := handlers.NewAuthHandler(pool, cfg, mail)
	errandHandler := handlers.NewErrandHandler(pool, cfg)
	routeHandler := handlers.NewRouteHandler(pool, cfg.GoogleRoutesKey)
	sessionHandler := handlers.NewSessionHandler(pool)
	authMiddleware := middleware.Auth(cfg.JWTSecret)

	r := chi.NewRouter()
	r.Use(middleware.CORS)

	r.Get("/health", healthHandler.Health)

	r.Route("/api", func(r chi.Router) {
		r.Post("/auth/register", authHandler.Register)
		r.Post("/auth/login", authHandler.Login)
		r.Post("/auth/forgot-password", authHandler.ForgotPassword)
		r.Post("/auth/reset-password", authHandler.ResetPassword)

		r.Group(func(r chi.Router) {
			r.Use(authMiddleware)
			r.Get("/auth/me", authHandler.Me)
			r.Post("/errands", errandHandler.Create)
			r.Post("/routes/optimize", routeHandler.Optimize)
			r.Get("/routes/{route_id}/stream", routeHandler.Stream)
			r.Get("/sessions", sessionHandler.List)
			r.Patch("/sessions/{session_id}", sessionHandler.Save)
			r.Delete("/sessions/{session_id}", sessionHandler.DeleteSession)
		})
	})

	log.Printf("listening on :%s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, r); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
