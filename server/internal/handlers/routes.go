package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Christopher4113/Haul/server/internal/middleware"
	"github.com/Christopher4113/Haul/server/internal/optimizer"
)

type RouteHandler struct {
	pool *pgxpool.Pool
}

func NewRouteHandler(pool *pgxpool.Pool) *RouteHandler {
	return &RouteHandler{pool: pool}
}

type optimizeRouteRequest struct {
	SessionID string `json:"session_id"`
}

type optimizeRouteResponse struct {
	RouteID string `json:"route_id"`
}

func (h *RouteHandler) Optimize(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.ClaimsFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req optimizeRouteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	req.SessionID = strings.TrimSpace(req.SessionID)
	if req.SessionID == "" {
		writeError(w, http.StatusBadRequest, "session_id is required")
		return
	}

	owned, err := sessionOwnedByUser(r.Context(), h.pool, req.SessionID, claims.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to verify session")
		return
	}
	if !owned {
		writeError(w, http.StatusForbidden, "session does not belong to user")
		return
	}

	var routeID string
	err = h.pool.QueryRow(r.Context(), `
		INSERT INTO routes (session_id, status)
		VALUES ($1, 'pending')
		RETURNING id::text
	`, req.SessionID).Scan(&routeID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create route")
		return
	}

	go optimizer.Run(context.Background(), h.pool, routeID, req.SessionID)

	writeJSON(w, http.StatusAccepted, optimizeRouteResponse{RouteID: routeID})
}

func (h *RouteHandler) Stream(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.ClaimsFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	routeID := strings.TrimSpace(chi.URLParam(r, "route_id"))
	if routeID == "" {
		writeError(w, http.StatusBadRequest, "route_id is required")
		return
	}

	owned, err := routeOwnedByUser(r.Context(), h.pool, routeID, claims.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to verify route")
		return
	}
	if !owned {
		writeError(w, http.StatusForbidden, "route does not belong to user")
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	lastEventID := int64(0)
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			events, err := h.fetchEventsSince(r.Context(), routeID, lastEventID)
			if err != nil {
				return
			}

			for _, event := range events {
				if _, err := fmt.Fprintf(w, "data: %s\n\n", event.Payload); err != nil {
					return
				}
				flusher.Flush()
				lastEventID = event.ID
			}

			status, err := h.routeStatus(r.Context(), routeID)
			if err != nil {
				return
			}
			if status == "done" || status == "error" {
				return
			}
		}
	}
}

type streamEvent struct {
	ID      int64
	Payload json.RawMessage
}

func (h *RouteHandler) fetchEventsSince(ctx context.Context, routeID string, afterID int64) ([]streamEvent, error) {
	rows, err := h.pool.Query(ctx, `
		SELECT id, payload
		FROM optimizer_events
		WHERE route_id = $1 AND id > $2
		ORDER BY id ASC
	`, routeID, afterID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]streamEvent, 0)
	for rows.Next() {
		var event streamEvent
		if err := rows.Scan(&event.ID, &event.Payload); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func (h *RouteHandler) routeStatus(ctx context.Context, routeID string) (string, error) {
	var status string
	err := h.pool.QueryRow(ctx, `
		SELECT status
		FROM routes
		WHERE id = $1
	`, routeID).Scan(&status)
	return status, err
}
