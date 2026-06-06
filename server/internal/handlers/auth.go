package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Christopher4113/Haul/server/internal/auth"
	"github.com/Christopher4113/Haul/server/internal/config"
	"github.com/Christopher4113/Haul/server/internal/mailer"
	"github.com/Christopher4113/Haul/server/internal/middleware"
	"github.com/Christopher4113/Haul/server/internal/models"
)

var emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

type AuthHandler struct {
	pool    *pgxpool.Pool
	config  config.Config
	mailer  *mailer.Mailer
}

func NewAuthHandler(pool *pgxpool.Pool, cfg config.Config, mail *mailer.Mailer) *AuthHandler {
	return &AuthHandler{pool: pool, config: cfg, mailer: mail}
}

type authResponse struct {
	Token string       `json:"token"`
	User  models.User  `json:"user"`
}

type registerRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type forgotPasswordRequest struct {
	Email string `json:"email"`
}

type resetPasswordRequest struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))

	if req.Name == "" || req.Email == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "name, email, and password are required")
		return
	}
	if !emailPattern.MatchString(req.Email) {
		writeError(w, http.StatusBadRequest, "invalid email address")
		return
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create account")
		return
	}

	var user models.User
	err = h.pool.QueryRow(r.Context(), `
		INSERT INTO users (email, password_hash, name)
		VALUES ($1, $2, $3)
		RETURNING id, email, name, created_at
	`, req.Email, hash, req.Name).Scan(&user.ID, &user.Email, &user.Name, &user.CreatedAt)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique constraint") {
			writeError(w, http.StatusConflict, "email already registered")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to create account")
		return
	}

	token, err := auth.GenerateToken(user.ID, user.Email, h.config.JWTSecret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create session")
		return
	}

	writeJSON(w, http.StatusCreated, authResponse{Token: token, User: user})
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "email and password are required")
		return
	}

	var user models.User
	var passwordHash string
	err := h.pool.QueryRow(r.Context(), `
		SELECT id, email, name, password_hash, created_at
		FROM users
		WHERE email = $1
	`, req.Email).Scan(&user.ID, &user.Email, &user.Name, &passwordHash, &user.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusUnauthorized, "invalid email or password")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to sign in")
		return
	}

	if !auth.CheckPassword(passwordHash, req.Password) {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}

	token, err := auth.GenerateToken(user.ID, user.Email, h.config.JWTSecret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create session")
		return
	}

	writeJSON(w, http.StatusOK, authResponse{Token: token, User: user})
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.ClaimsFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var user models.User
	err := h.pool.QueryRow(r.Context(), `
		SELECT id, email, name, created_at
		FROM users
		WHERE id = $1
	`, claims.UserID).Scan(&user.ID, &user.Email, &user.Name, &user.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load profile")
		return
	}

	writeJSON(w, http.StatusOK, user)
}

func (h *AuthHandler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var req forgotPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" || !emailPattern.MatchString(req.Email) {
		writeError(w, http.StatusBadRequest, "valid email is required")
		return
	}

	var userID string
	err := h.pool.QueryRow(r.Context(), `SELECT id FROM users WHERE email = $1`, req.Email).Scan(&userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusOK, map[string]string{
				"message": "If an account exists for that email, a reset link has been sent.",
			})
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to process request")
		return
	}

	rawToken, tokenHash, err := generateResetToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to process request")
		return
	}

	_, err = h.pool.Exec(r.Context(), `DELETE FROM password_reset_tokens WHERE user_id = $1`, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to process request")
		return
	}

	expiresAt := time.Now().Add(time.Hour)
	_, err = h.pool.Exec(r.Context(), `
		INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`, userID, tokenHash, expiresAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to process request")
		return
	}

	if h.mailer.Configured() {
		if err := h.mailer.SendPasswordReset(req.Email, rawToken); err != nil {
			log.Printf("failed to send password reset email to %s: %v", req.Email, err)
			writeError(w, http.StatusInternalServerError, "failed to send reset email")
			return
		}
	} else if h.config.Env == "development" {
		log.Printf("password reset token for %s: %s", req.Email, rawToken)
	} else {
		writeError(w, http.StatusInternalServerError, "email service is not configured")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"message": "If an account exists for that email, a reset link has been sent.",
	})
}

func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var req resetPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	req.Token = strings.TrimSpace(req.Token)
	if req.Token == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "token and password are required")
		return
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	tokenHash := hashToken(req.Token)

	var userID string
	err := h.pool.QueryRow(r.Context(), `
		SELECT user_id
		FROM password_reset_tokens
		WHERE token_hash = $1 AND expires_at > NOW()
	`, tokenHash).Scan(&userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusBadRequest, "invalid or expired reset token")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to reset password")
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to reset password")
		return
	}

	err = h.withTx(r.Context(), func(ctx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2
		`, hash, userID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM password_reset_tokens WHERE user_id = $1`, userID); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to reset password")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"message": "Password updated. You can sign in with your new password.",
	})
}

func (h *AuthHandler) withTx(ctx context.Context, fn func(context.Context, pgx.Tx) error) error {
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := fn(ctx, tx); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func generateResetToken() (raw string, hash string, err error) {
	bytes := make([]byte, 32)
	if _, err = rand.Read(bytes); err != nil {
		return "", "", err
	}
	raw = hex.EncodeToString(bytes)
	return raw, hashToken(raw), nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
