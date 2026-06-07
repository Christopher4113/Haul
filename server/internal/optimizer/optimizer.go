package optimizer

import (
	"context"
	"encoding/json"
	"log"
	"math"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Christopher4113/Haul/server/internal/clustering"
)

type errandRow struct {
	ID    string
	Name  string
	Address string
	Lat   float64
	Lng   float64
}

func Run(ctx context.Context, pool *pgxpool.Pool, routeID, sessionID string) {
	if err := run(ctx, pool, routeID, sessionID); err != nil {
		log.Printf("optimizer failed for route %s: %v", routeID, err)
		if _, updateErr := pool.Exec(ctx, `
			UPDATE routes SET status = 'error' WHERE id = $1
		`, routeID); updateErr != nil {
			log.Printf("failed to mark route %s as error: %v", routeID, updateErr)
		}
		_ = writeEvent(ctx, pool, routeID, "error", map[string]string{
			"type":    "error",
			"message": err.Error(),
		})
	}
}

func run(ctx context.Context, pool *pgxpool.Pool, routeID, sessionID string) error {
	errands, err := fetchGeocodedErrands(ctx, pool, sessionID)
	if err != nil {
		return err
	}

	if err := writeEvent(ctx, pool, routeID, "geocoded", map[string]any{
		"type":  "geocoded",
		"count": len(errands),
	}); err != nil {
		return err
	}

	if len(errands) == 0 {
		if _, err := pool.Exec(ctx, `UPDATE routes SET status = 'error' WHERE id = $1`, routeID); err != nil {
			return err
		}
		return writeEvent(ctx, pool, routeID, "error", map[string]string{
			"type":    "error",
			"message": "no geocoded errands found for session",
		})
	}

	points := make([]clustering.Point, len(errands))
	for i, errand := range errands {
		points[i] = clustering.Point{Lat: errand.Lat, Lng: errand.Lng}
	}

	k := max(1, int(math.Floor(math.Sqrt(float64(len(errands))/2))))
	assignments := clustering.KMeans(points, k)

	clusterSummaries := make([]map[string]any, k)
	clusterMembers := make([][]errandRow, k)
	for clusterID := 0; clusterID < k; clusterID++ {
		clusterMembers[clusterID] = make([]errandRow, 0)
	}

	for i, errand := range errands {
		clusterID := assignments[i]
		if err := updateErrandCluster(ctx, pool, errand.ID, clusterID); err != nil {
			return err
		}
		clusterMembers[clusterID] = append(clusterMembers[clusterID], errand)
	}

	for clusterID := 0; clusterID < k; clusterID++ {
		members := clusterMembers[clusterID]
		memberPoints := make([]clustering.Point, len(members))
		for i, member := range members {
			memberPoints[i] = clustering.Point{Lat: member.Lat, Lng: member.Lng}
		}
		centroid := clustering.Centroid(memberPoints)
		clusterSummaries[clusterID] = map[string]any{
			"id":           clusterID,
			"centroid_lat": centroid.Lat,
			"centroid_lng": centroid.Lng,
			"count":        len(members),
		}
	}

	if err := writeEvent(ctx, pool, routeID, "clustered", map[string]any{
		"type":     "clustered",
		"clusters": clusterSummaries,
	}); err != nil {
		return err
	}

	ordered := make([]orderedErrand, 0, len(errands))
	seq := 1
	lineCoords := make([][]float64, 0, len(errands))

	for clusterID := 0; clusterID < k; clusterID++ {
		members := clusterMembers[clusterID]
		if len(members) == 0 {
			continue
		}

		memberPoints := make([]clustering.Point, len(members))
		for i, member := range members {
			memberPoints[i] = clustering.Point{Lat: member.Lat, Lng: member.Lng}
		}
		centroid := clustering.Centroid(memberPoints)
		clusterOrder := nearestNeighborOrder(members, centroid)

		for _, errand := range clusterOrder {
			if err := updateErrandSeqOrder(ctx, pool, errand.ID, seq); err != nil {
				return err
			}
			ordered = append(ordered, orderedErrand{
				ID:        errand.ID,
				Name:      errand.Name,
				SeqOrder:  seq,
				Lat:       errand.Lat,
				Lng:       errand.Lng,
				ClusterID: clusterID,
			})
			lineCoords = append(lineCoords, []float64{errand.Lng, errand.Lat})
			seq++
		}
	}

	geojson := map[string]any{
		"type":        "LineString",
		"coordinates": lineCoords,
	}
	geojsonBytes, err := json.Marshal(geojson)
	if err != nil {
		return err
	}

	if _, err := pool.Exec(ctx, `
		UPDATE routes
		SET status = 'done', geojson = $2, cluster_count = $3
		WHERE id = $1
	`, routeID, geojsonBytes, k); err != nil {
		return err
	}

	orderPayload := make([]map[string]any, len(ordered))
	for i, item := range ordered {
		orderPayload[i] = map[string]any{
			"id":         item.ID,
			"name":       item.Name,
			"seq_order":  item.SeqOrder,
			"lat":        item.Lat,
			"lng":        item.Lng,
			"cluster_id": item.ClusterID,
		}
	}

	return writeEvent(ctx, pool, routeID, "optimized", map[string]any{
		"type":    "optimized",
		"geojson": geojson,
		"order":   orderPayload,
	})
}

type orderedErrand struct {
	ID        string
	Name      string
	SeqOrder  int
	Lat       float64
	Lng       float64
	ClusterID int
}

func fetchGeocodedErrands(ctx context.Context, pool *pgxpool.Pool, sessionID string) ([]errandRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT
			id::text,
			name,
			address,
			ST_Y(location::geometry) AS lat,
			ST_X(location::geometry) AS lng
		FROM errands
		WHERE session_id = $1 AND location IS NOT NULL
		ORDER BY created_at ASC
	`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	errands := make([]errandRow, 0)
	for rows.Next() {
		var errand errandRow
		if err := rows.Scan(&errand.ID, &errand.Name, &errand.Address, &errand.Lat, &errand.Lng); err != nil {
			return nil, err
		}
		errands = append(errands, errand)
	}
	return errands, rows.Err()
}

func updateErrandCluster(ctx context.Context, pool *pgxpool.Pool, errandID string, clusterID int) error {
	_, err := pool.Exec(ctx, `
		UPDATE errands SET cluster_id = $2 WHERE id = $1
	`, errandID, clusterID)
	return err
}

func updateErrandSeqOrder(ctx context.Context, pool *pgxpool.Pool, errandID string, seqOrder int) error {
	_, err := pool.Exec(ctx, `
		UPDATE errands SET seq_order = $2 WHERE id = $1
	`, errandID, seqOrder)
	return err
}

func nearestNeighborOrder(errands []errandRow, start clustering.Point) []errandRow {
	remaining := append([]errandRow(nil), errands...)
	ordered := make([]errandRow, 0, len(remaining))
	current := start

	for len(remaining) > 0 {
		bestIdx := 0
		bestDist := math.MaxFloat64
		for i, errand := range remaining {
			dist := clusteringSquaredDistance(current, clustering.Point{Lat: errand.Lat, Lng: errand.Lng})
			if dist < bestDist {
				bestDist = dist
				bestIdx = i
			}
		}

		next := remaining[bestIdx]
		ordered = append(ordered, next)
		current = clustering.Point{Lat: next.Lat, Lng: next.Lng}
		remaining = append(remaining[:bestIdx], remaining[bestIdx+1:]...)
	}

	return ordered
}

func clusteringSquaredDistance(a, b clustering.Point) float64 {
	dLat := a.Lat - b.Lat
	dLng := a.Lng - b.Lng
	return dLat*dLat + dLng*dLng
}

func writeEvent(ctx context.Context, pool *pgxpool.Pool, routeID, eventType string, payload any) error {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO optimizer_events (route_id, event_type, payload)
		VALUES ($1, $2, $3)
	`, routeID, eventType, payloadBytes)
	return err
}
