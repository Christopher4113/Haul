package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Christopher4113/Haul/server/internal/config"
	"github.com/Christopher4113/Haul/server/internal/middleware"
	"github.com/Christopher4113/Haul/server/internal/places"
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

	if err := ensureSession(r.Context(), h.pool, req.SessionID, claims.UserID); err != nil {
		if errors.Is(err, errSessionForbidden) {
			writeError(w, http.StatusForbidden, "session does not belong to user")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to ensure session")
		return
	}

	place, err := h.places.ResolveAddress(r.Context(), req.Address)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var errand errandResponse
	err = h.pool.QueryRow(r.Context(), `
		INSERT INTO errands (session_id, name, address, location, place_id)
		VALUES (
			$1,
			$2,
			$3,
			ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
			$6
		)
		RETURNING
			id::text,
			name,
			address,
			ST_Y(location::geometry),
			ST_X(location::geometry)
	`, req.SessionID, req.Name, req.Address, place.Lng, place.Lat, place.PlaceID).Scan(
		&errand.ID,
		&errand.Name,
		&errand.Address,
		&errand.Lat,
		&errand.Lng,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create errand")
		return
	}

	writeJSON(w, http.StatusCreated, errand)
}
