package handlers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Christopher4113/Haul/server/internal/auth"
	"github.com/Christopher4113/Haul/server/internal/middleware"
)

type SessionHandler struct {
	pool *pgxpool.Pool
}

func NewSessionHandler(pool *pgxpool.Pool) *SessionHandler {
	return &SessionHandler{pool: pool}
}

type saveSessionRequest struct {
	Name string `json:"name"`
}

type saveSessionResponse struct {
	ID      string    `json:"id"`
	Name    string    `json:"name"`
	SavedAt time.Time `json:"saved_at"`
}

type savedStopResponse struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Address   string   `json:"address"`
	Lat       float64  `json:"lat"`
	Lng       float64  `json:"lng"`
	SeqOrder  *int     `json:"seq_order"`
	ClusterID *int     `json:"cluster_id"`
}

type savedSessionResponse struct {
	ID         string              `json:"id"`
	Name       string              `json:"name"`
	SavedAt    time.Time           `json:"saved_at"`
	StopCount  int                 `json:"stop_count"`
	TotalKm    *float64            `json:"total_km"`
	TotalMins  *int                `json:"total_mins"`
	Status     string              `json:"status"`
	Stops      []savedStopResponse `json:"stops"`
	GeoJSON    json.RawMessage     `json:"geojson"`
}

func (h *SessionHandler) Save(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.ClaimsFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	userID := auth.ResolveUserID(claims)
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "invalid token claims")
		return
	}

	sessionID := strings.TrimSpace(chi.URLParam(r, "session_id"))
	if sessionID == "" {
		writeError(w, http.StatusBadRequest, "session_id is required")
		return
	}

	var req saveSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	owned, err := sessionOwnedByUser(r.Context(), h.pool, sessionID, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to verify session")
		return
	}
	if !owned {
		writeError(w, http.StatusForbidden, "session does not belong to user")
		return
	}

	var savedAt time.Time
	err = h.pool.QueryRow(r.Context(), `
		UPDATE sessions
		SET name = $2, saved_at = NOW()
		WHERE id = $1::uuid
		RETURNING saved_at
	`, sessionID, name).Scan(&savedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "session not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to save session")
		return
	}

	writeJSON(w, http.StatusOK, saveSessionResponse{
		ID:      sessionID,
		Name:    name,
		SavedAt: savedAt,
	})
}

func (h *SessionHandler) List(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.ClaimsFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	userID := auth.ResolveUserID(claims)
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "invalid token claims")
		return
	}

	rows, err := h.pool.Query(r.Context(), `
		SELECT
			s.id::text,
			s.name,
			s.saved_at,
			COALESCE(sc.stop_count, 0) AS stop_count,
			r.total_km,
			r.total_mins,
			COALESCE(r.status, 'pending') AS status,
			r.geojson
		FROM sessions s
		LEFT JOIN LATERAL (
			SELECT COUNT(*)::int AS stop_count
			FROM errands e
			WHERE e.session_id = s.id
				AND lower(e.name) <> 'origin'
		) sc ON true
		LEFT JOIN LATERAL (
			SELECT status, total_km, total_mins, geojson
			FROM routes
			WHERE session_id = s.id
			ORDER BY created_at DESC
			LIMIT 1
		) r ON true
		WHERE s.user_id = $1::uuid
			AND s.saved_at IS NOT NULL
		ORDER BY s.saved_at DESC
	`, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list sessions")
		return
	}
	defer rows.Close()

	type sessionRow struct {
		ID        string
		Name      *string
		SavedAt   time.Time
		StopCount int
		TotalKm   *float64
		TotalMins *int
		Status    string
		GeoJSON   []byte
	}

	sessions := make([]sessionRow, 0)
	sessionIDs := make([]string, 0)

	for rows.Next() {
		var row sessionRow
		if err := rows.Scan(
			&row.ID,
			&row.Name,
			&row.SavedAt,
			&row.StopCount,
			&row.TotalKm,
			&row.TotalMins,
			&row.Status,
			&row.GeoJSON,
		); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read sessions")
			return
		}
		sessions = append(sessions, row)
		sessionIDs = append(sessionIDs, row.ID)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list sessions")
		return
	}

	stopsBySession := make(map[string][]savedStopResponse)
	if len(sessionIDs) > 0 {
		stopRows, err := h.pool.Query(r.Context(), `
			SELECT
				e.session_id::text,
				e.id::text,
				e.name,
				e.address,
				ST_Y(e.location::geometry) AS lat,
				ST_X(e.location::geometry) AS lng,
				e.seq_order,
				e.cluster_id
			FROM errands e
			WHERE e.session_id = ANY($1::uuid[])
				AND e.location IS NOT NULL
				AND lower(e.name) <> 'origin'
			ORDER BY e.session_id, COALESCE(e.seq_order, 999999), e.created_at ASC
		`, sessionIDs)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read stops")
			return
		}
		defer stopRows.Close()

		for stopRows.Next() {
			var sessionID string
			var stop savedStopResponse
			if err := stopRows.Scan(
				&sessionID,
				&stop.ID,
				&stop.Name,
				&stop.Address,
				&stop.Lat,
				&stop.Lng,
				&stop.SeqOrder,
				&stop.ClusterID,
			); err != nil {
				writeError(w, http.StatusInternalServerError, "failed to read stops")
				return
			}
			stopsBySession[sessionID] = append(stopsBySession[sessionID], stop)
		}
		if err := stopRows.Err(); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read stops")
			return
		}
	}

	response := make([]savedSessionResponse, 0, len(sessions))
	for _, session := range sessions {
		name := "Untitled run"
		if session.Name != nil && strings.TrimSpace(*session.Name) != "" {
			name = strings.TrimSpace(*session.Name)
		}

		var geojson json.RawMessage
		if len(session.GeoJSON) > 0 {
			geojson = json.RawMessage(session.GeoJSON)
		}

		stops := stopsBySession[session.ID]
		if stops == nil {
			stops = []savedStopResponse{}
		}

		response = append(response, savedSessionResponse{
			ID:        session.ID,
			Name:      name,
			SavedAt:   session.SavedAt,
			StopCount: session.StopCount,
			TotalKm:   session.TotalKm,
			TotalMins: session.TotalMins,
			Status:    session.Status,
			Stops:     stops,
			GeoJSON:   geojson,
		})
	}

	if response == nil {
		response = []savedSessionResponse{}
	}

	writeJSON(w, http.StatusOK, response)
}

func (h *SessionHandler) DeleteSession(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.ClaimsFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	userID := auth.ResolveUserID(claims)
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "invalid token claims")
		return
	}

	sessionID := strings.TrimSpace(chi.URLParam(r, "session_id"))
	log.Printf("DELETE /api/sessions/{session_id}: parsed session_id=%q user_id=%q", sessionID, userID)
	if sessionID == "" {
		writeError(w, http.StatusBadRequest, "session_id is required")
		return
	}

	tag, err := h.pool.Exec(r.Context(), `
		DELETE FROM sessions WHERE id = $1::uuid AND user_id = $2::uuid
	`, sessionID, userID)
	if err != nil {
		log.Printf("delete session failed: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to delete session")
		return
	}

	rowsAffected := tag.RowsAffected()
	log.Printf("DELETE /api/sessions/{session_id}: delete query ok session_id=%q rows_affected=%d", sessionID, rowsAffected)
	if rowsAffected == 0 {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
