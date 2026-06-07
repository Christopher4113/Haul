package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Christopher4113/Haul/server/internal/auth"
	"github.com/Christopher4113/Haul/server/internal/config"
	"github.com/Christopher4113/Haul/server/internal/middleware"
	"github.com/Christopher4113/Haul/server/internal/places"
	"github.com/Christopher4113/Haul/server/internal/storehours"
)

type ErrandHandler struct {
	pool   *pgxpool.Pool
	places *places.Client
}

func NewErrandHandler(pool *pgxpool.Pool, cfg config.Config) *ErrandHandler {
	return &ErrandHandler{
		pool:   pool,
		places: places.NewClient(cfg.GooglePlacesKey),
	}
}

type createErrandRequest struct {
	SessionID string `json:"session_id"`
	Name      string `json:"name"`
	Address   string `json:"address"`
}

type errandResponse struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Address string  `json:"address"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
}

func (h *ErrandHandler) Create(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.ClaimsFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	claimsMap := map[string]any{
		"user_id": claims.UserID,
		"id":      claims.ID,
		"email":   claims.Email,
		"sub":     claims.Subject,
		"iss":     claims.Issuer,
		"aud":     claims.Audience,
		"exp":     claims.ExpiresAt,
		"iat":     claims.IssuedAt,
		"jti":     claims.RegisteredClaims.ID,
	}
	claimsJSON, _ := json.Marshal(claimsMap)
	log.Printf("POST /api/errands JWT claims map: %s", claimsJSON)

	userID := auth.ResolveUserID(claims)
	if userID == "" {
		log.Printf("POST /api/errands: no user id found in JWT claims (checked user_id, sub, id)")
		writeError(w, http.StatusUnauthorized, "invalid token claims")
		return
	}
	log.Printf("POST /api/errands resolved user_id=%q from claims", userID)

	var req createErrandRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	req.SessionID = strings.TrimSpace(req.SessionID)
	req.Name = strings.TrimSpace(req.Name)
	req.Address = strings.TrimSpace(req.Address)

	if req.SessionID == "" || req.Name == "" || req.Address == "" {
		writeError(w, http.StatusBadRequest, "session_id, name, and address are required")
		return
	}

	log.Printf(
		"POST /api/errands request session_id=%q name=%q address=%q resolved_user_id=%q",
		req.SessionID,
		req.Name,
		req.Address,
		userID,
	)

	if err := ensureSession(r.Context(), h.pool, req.SessionID, userID); err != nil {
		if errors.Is(err, errSessionForbidden) {
			writeError(w, http.StatusForbidden, "session does not belong to user")
			return
		}
		log.Printf("POST /api/errands ensureSession failed: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to ensure session")
		return
	}

	place, err := h.places.ResolveAddress(r.Context(), req.Address)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if hours, hoursErr := h.places.FetchOpeningHours(r.Context(), place.PlaceID); hoursErr != nil {
		log.Printf("POST /api/errands: failed to fetch opening hours for %s: %v", place.PlaceID, hoursErr)
	} else if upsertErr := storehours.Upsert(r.Context(), h.pool, toStoreHours(*hours), place.PlaceID); upsertErr != nil {
		log.Printf("POST /api/errands: failed to upsert store hours for %s: %v", place.PlaceID, upsertErr)
	}

	locationWKT := fmt.Sprintf("SRID=4326;POINT(%f %f)", place.Lng, place.Lat)

	if strings.EqualFold(req.Name, "origin") {
		if _, err := h.pool.Exec(r.Context(), `
			DELETE FROM errands
			WHERE session_id = $1::uuid AND lower(name) = 'origin'
		`, req.SessionID); err != nil {
			log.Printf("POST /api/errands: failed to clear previous origin for session %q: %v", req.SessionID, err)
		}

		if _, err := h.pool.Exec(r.Context(), `
			UPDATE sessions
			SET origin = ST_GeogFromText($2::text)
			WHERE id = $1::uuid
		`, req.SessionID, locationWKT); err != nil {
			log.Printf("POST /api/errands: failed to update session origin for session %q: %v", req.SessionID, err)
		}
	}

	var errand errandResponse
	err = h.pool.QueryRow(r.Context(), `
		INSERT INTO errands (session_id, name, address, location, place_id)
		VALUES (
			$1::uuid,
			$2,
			$3,
			ST_GeogFromText($4::text),
			$5
		)
		RETURNING
			id::text,
			name,
			address,
			ST_Y(location::geometry),
			ST_X(location::geometry)
	`, req.SessionID, req.Name, req.Address, locationWKT, place.PlaceID).Scan(
		&errand.ID,
		&errand.Name,
		&errand.Address,
		&errand.Lat,
		&errand.Lng,
	)
	if err != nil {
		log.Printf("POST /api/errands INSERT failed session_id=%q: %v", req.SessionID, err)
		writeError(w, http.StatusInternalServerError, "failed to create errand")
		return
	}

	writeJSON(w, http.StatusCreated, errand)
}

func toStoreHours(hours places.OpeningHours) storehours.OpeningHours {
	periods := make([]storehours.Period, len(hours.Periods))
	for i, period := range hours.Periods {
		periods[i] = storehours.Period{
			Open: storehours.PeriodTime{
				Day:  period.Open.Day,
				Time: period.Open.Time,
			},
			Close: storehours.PeriodTime{
				Day:  period.Close.Day,
				Time: period.Close.Time,
			},
		}
	}

	return storehours.OpeningHours{
		OpenNow: hours.OpenNow,
		Periods: periods,
	}
}
