package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	Port             string
	DBURL            string
	JWTSecret        string
	Env              string
	GooglePlacesKey  string
	GoogleRoutesKey  string
	SMTP             SMTPConfig
}

type SMTPConfig struct {
	Host      string
	Port      string
	Username  string
	Password  string
	From      string
	ClientURL string
}

func Load() Config {
	if err := godotenv.Load(); err != nil {
		log.Println("no .env file found, using environment variables")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	dbURL := firstEnv("DATABASE_URL", "NEON_DB_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL or NEON_DB_URL is not set")
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		log.Fatal("JWT_SECRET is not set")
	}

	env := os.Getenv("ENV")
	if env == "" {
		env = "development"
	}

	smtpUser := firstEnv("SMTP_USER", "user")
	smtpPass := firstEnv("SMTP_PASS", "pass")

	clientURL := firstEnv("CLIENT_URL", "DOMAIN")
	if clientURL == "" {
		clientURL = "http://localhost:5173"
	}

	smtpHost := os.Getenv("SMTP_HOST")
	if smtpHost == "" {
		smtpHost = "smtp.gmail.com"
	}

	smtpPort := os.Getenv("SMTP_PORT")
	if smtpPort == "" {
		smtpPort = "465"
	}

	smtpFrom := os.Getenv("SMTP_FROM")
	if smtpFrom == "" {
		smtpFrom = smtpUser
	}

	return Config{
		Port:            port,
		DBURL:           dbURL,
		JWTSecret:       jwtSecret,
		Env:             env,
		GooglePlacesKey: os.Getenv("GOOGLE_PLACES_KEY"),
		GoogleRoutesKey: os.Getenv("GOOGLE_ROUTES_KEY"),
		SMTP: SMTPConfig{
			Host:      smtpHost,
			Port:      smtpPort,
			Username:  smtpUser,
			Password:  smtpPass,
			From:      smtpFrom,
			ClientURL: clientURL,
		},
	}
}

func firstEnv(keys ...string) string {
	for _, key := range keys {
		if value := os.Getenv(key); value != "" {
			return value
		}
	}
	return ""
}
