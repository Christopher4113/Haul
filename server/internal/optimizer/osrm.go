package optimizer

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/Christopher4113/Haul/server/internal/clustering"
	"github.com/Christopher4113/Haul/server/internal/routing"
)

const osrmBaseURL = "http://router.project-osrm.org/route/v1/driving"

type routeWaypoint struct {
	ID  string
	Lat float64
	Lng float64
}

type routeLeg struct {
	FromID       string  `json:"from_id"`
	ToID         string  `json:"to_id"`
	DurationMins float64 `json:"duration_mins"`
	DistanceKm   float64 `json:"distance_km"`
}

type osrmResult struct {
	Geometry  map[string]any
	TotalKm   float64
	TotalMins float64
	Legs      []routeLeg
}

type osrmResponse struct {
	Code   string `json:"code"`
	Routes []struct {
		Distance float64         `json:"distance"`
		Duration float64         `json:"duration"`
		Geometry json.RawMessage `json:"geometry"`
		Legs     []struct {
			Distance float64 `json:"distance"`
			Duration float64 `json:"duration"`
		} `json:"legs"`
	} `json:"routes"`
}

func fetchOSRMRoute(ctx context.Context, waypoints []routeWaypoint) (*osrmResult, error) {
	if len(waypoints) < 2 {
		return nil, fmt.Errorf("osrm requires at least 2 waypoints")
	}

	coords := make([]string, len(waypoints))
	for i, wp := range waypoints {
		coords[i] = fmt.Sprintf("%f,%f", wp.Lng, wp.Lat)
	}

	url := fmt.Sprintf("%s/%s?overview=full&geometries=geojson", osrmBaseURL, strings.Join(coords, ";"))

	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var payload osrmResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	if payload.Code != "Ok" || len(payload.Routes) == 0 {
		return nil, fmt.Errorf("osrm returned code %q", payload.Code)
	}

	route := payload.Routes[0]

	var geometry map[string]any
	if err := json.Unmarshal(route.Geometry, &geometry); err != nil {
		return nil, fmt.Errorf("osrm geometry: %w", err)
	}

	legs := make([]routeLeg, 0, len(route.Legs))
	for i, leg := range route.Legs {
		if i+1 >= len(waypoints) {
			break
		}
		legs = append(legs, routeLeg{
			FromID:       waypoints[i].ID,
			ToID:         waypoints[i+1].ID,
			DurationMins: leg.Duration / 60,
			DistanceKm:   leg.Distance / 1000,
		})
	}

	return &osrmResult{
		Geometry:  geometry,
		TotalKm:   route.Distance / 1000,
		TotalMins: route.Duration / 60,
		Legs:      legs,
	}, nil
}

func buildWaypoints(origin clustering.Point, hasOrigin bool, ordered []orderedErrand) []routeWaypoint {
	waypoints := make([]routeWaypoint, 0, len(ordered)+1)
	if hasOrigin {
		waypoints = append(waypoints, routeWaypoint{
			ID:  "origin",
			Lat: origin.Lat,
			Lng: origin.Lng,
		})
	}
	for _, item := range ordered {
		waypoints = append(waypoints, routeWaypoint{
			ID:  item.ID,
			Lat: item.Lat,
			Lng: item.Lng,
		})
	}
	return waypoints
}

func applyRouteRouting(
	ctx context.Context,
	googleRoutesKey string,
	origin clustering.Point,
	hasOrigin bool,
	ordered []orderedErrand,
	fallbackGeoJSON map[string]any,
) (geojson map[string]any, totalKm, totalMins float64, legs []routeLeg) {
	geojson = fallbackGeoJSON
	legs = []routeLeg{}

	waypoints := buildWaypoints(origin, hasOrigin, ordered)
	if len(waypoints) < 2 {
		totalKm = straightLineKm(fallbackGeoJSON)
		return geojson, totalKm, 0, legs
	}

	if strings.TrimSpace(googleRoutesKey) != "" {
		routingWaypoints := make([]routing.Waypoint, len(waypoints))
		for i, wp := range waypoints {
			routingWaypoints[i] = routing.Waypoint{
				ID:  wp.ID,
				Lat: wp.Lat,
				Lng: wp.Lng,
			}
		}

		result, err := routing.GetGoogleRoute(ctx, googleRoutesKey, routingWaypoints)
		if err == nil {
			legs = make([]routeLeg, len(result.Legs))
			for i, leg := range result.Legs {
				legs[i] = routeLeg{
					FromID:       leg.FromID,
					ToID:         leg.ToID,
					DurationMins: leg.DurationMins,
					DistanceKm:   leg.DistanceKm,
				}
			}
			return result.Geometry, result.TotalKm, result.TotalMins, legs
		}

		log.Printf("google routes routing failed, falling back to osrm: %v", err)
	} else {
		log.Printf("GOOGLE_ROUTES_KEY not set, falling back to osrm")
	}

	return applyOSRMRouting(ctx, origin, hasOrigin, ordered, fallbackGeoJSON)
}

func applyOSRMRouting(
	ctx context.Context,
	origin clustering.Point,
	hasOrigin bool,
	ordered []orderedErrand,
	fallbackGeoJSON map[string]any,
) (geojson map[string]any, totalKm, totalMins float64, legs []routeLeg) {
	geojson = fallbackGeoJSON
	legs = []routeLeg{}

	waypoints := buildWaypoints(origin, hasOrigin, ordered)
	if len(waypoints) < 2 {
		totalKm = straightLineKm(fallbackGeoJSON)
		return geojson, totalKm, 0, legs
	}

	result, err := fetchOSRMRoute(ctx, waypoints)
	if err != nil {
		log.Printf("osrm routing failed, using straight line: %v", err)
		totalKm = straightLineKm(fallbackGeoJSON)
		return geojson, totalKm, 0, legs
	}

	return result.Geometry, result.TotalKm, result.TotalMins, result.Legs
}

func straightLineKm(geojson map[string]any) float64 {
	coordsAny, ok := geojson["coordinates"].([]any)
	if !ok {
		if coords, ok := geojson["coordinates"].([][]float64); ok {
			return straightLineKmFromFloats(coords)
		}
		return 0
	}

	coords := make([][]float64, 0, len(coordsAny))
	for _, c := range coordsAny {
		pair, ok := c.([]any)
		if !ok || len(pair) < 2 {
			continue
		}
		lng, _ := pair[0].(float64)
		lat, _ := pair[1].(float64)
		coords = append(coords, []float64{lng, lat})
	}
	return straightLineKmFromFloats(coords)
}

func straightLineKmFromFloats(coords [][]float64) float64 {
	total := 0.0
	for i := 1; i < len(coords); i++ {
		lng1, lat1 := coords[i-1][0], coords[i-1][1]
		lng2, lat2 := coords[i][0], coords[i][1]
		total += haversineKm(lat1, lng1, lat2, lng2)
	}
	return total
}

func haversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadiusKm = 6371.0
	dLat := (lat2 - lat1) * math.Pi / 180
	dLng := (lng2 - lng1) * math.Pi / 180
	lat1Rad := lat1 * math.Pi / 180
	lat2Rad := lat2 * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return earthRadiusKm * c
}
