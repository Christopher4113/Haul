package routing

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const googleRoutesURL = "https://routes.googleapis.com/directions/v2:computeRoutes"

const googleFieldMask = "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.duration,routes.legs.distanceMeters"

type Waypoint struct {
	ID  string
	Lat float64
	Lng float64
}

type Leg struct {
	FromID       string
	ToID         string
	DurationMins float64
	DistanceKm   float64
}

type RouteResult struct {
	Geometry  map[string]any
	TotalKm   float64
	TotalMins float64
	Legs      []Leg
}

type latLng struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type routeLocation struct {
	LatLng latLng `json:"latLng"`
}

type computeRoutesRequest struct {
	Origin             routeLocation   `json:"origin"`
	Destination        routeLocation   `json:"destination"`
	Intermediates      []routeLocation `json:"intermediates,omitempty"`
	TravelMode         string          `json:"travelMode"`
	RoutingPreference  string          `json:"routingPreference"`
	DepartureTime      string          `json:"departureTime"`
}

type computeRoutesResponse struct {
	Routes []struct {
		DistanceMeters int64  `json:"distanceMeters"`
		Duration       string `json:"duration"`
		Polyline       struct {
			EncodedPolyline string `json:"encodedPolyline"`
		} `json:"polyline"`
		Legs []struct {
			DistanceMeters int64  `json:"distanceMeters"`
			Duration       string `json:"duration"`
		} `json:"legs"`
	} `json:"routes"`
	Error struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Status  string `json:"status"`
	} `json:"error"`
}

func GetGoogleRoute(ctx context.Context, apiKey string, waypoints []Waypoint) (*RouteResult, error) {
	if strings.TrimSpace(apiKey) == "" {
		return nil, fmt.Errorf("google routes api key is empty")
	}
	if len(waypoints) < 2 {
		return nil, fmt.Errorf("google routes requires at least 2 waypoints")
	}

	body := computeRoutesRequest{
		Origin: routeLocation{
			LatLng: latLng{Latitude: waypoints[0].Lat, Longitude: waypoints[0].Lng},
		},
		Destination: routeLocation{
			LatLng: latLng{
				Latitude:  waypoints[len(waypoints)-1].Lat,
				Longitude: waypoints[len(waypoints)-1].Lng,
			},
		},
		TravelMode:        "DRIVE",
		RoutingPreference: "TRAFFIC_AWARE",
		DepartureTime:     time.Now().UTC().Format(time.RFC3339),
	}

	if len(waypoints) > 2 {
		body.Intermediates = make([]routeLocation, 0, len(waypoints)-2)
		for _, wp := range waypoints[1 : len(waypoints)-1] {
			body.Intermediates = append(body.Intermediates, routeLocation{
				LatLng: latLng{Latitude: wp.Lat, Longitude: wp.Lng},
			})
		}
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal google routes request: %w", err)
	}

	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, googleRoutesURL, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", apiKey)
	req.Header.Set("X-Goog-FieldMask", googleFieldMask)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("google routes returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	var parsed computeRoutesResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, fmt.Errorf("decode google routes response: %w", err)
	}
	if parsed.Error.Message != "" || parsed.Error.Status != "" {
		return nil, fmt.Errorf("google routes error: %s", parsed.Error.Message)
	}
	if len(parsed.Routes) == 0 {
		return nil, fmt.Errorf("google routes returned no routes")
	}

	route := parsed.Routes[0]

	totalSeconds, err := parseDurationSeconds(route.Duration)
	if err != nil {
		return nil, fmt.Errorf("parse route duration: %w", err)
	}

	coords := decodePolyline(route.Polyline.EncodedPolyline)
	if len(coords) == 0 {
		return nil, fmt.Errorf("google routes returned empty polyline")
	}

	coordSlice := make([][]float64, len(coords))
	for i, pair := range coords {
		coordSlice[i] = []float64{pair[0], pair[1]}
	}

	legs := make([]Leg, 0, len(route.Legs))
	for i, leg := range route.Legs {
		if i+1 >= len(waypoints) {
			break
		}
		legSeconds, err := parseDurationSeconds(leg.Duration)
		if err != nil {
			return nil, fmt.Errorf("parse leg duration: %w", err)
		}
		legs = append(legs, Leg{
			FromID:       waypoints[i].ID,
			ToID:         waypoints[i+1].ID,
			DurationMins: legSeconds / 60,
			DistanceKm:   float64(leg.DistanceMeters) / 1000,
		})
	}

	return &RouteResult{
		Geometry: map[string]any{
			"type":        "LineString",
			"coordinates": coordSlice,
		},
		TotalKm:   float64(route.DistanceMeters) / 1000,
		TotalMins: totalSeconds / 60,
		Legs:      legs,
	}, nil
}

func parseDurationSeconds(value string) (float64, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, fmt.Errorf("empty duration")
	}
	if strings.HasSuffix(value, "s") {
		value = strings.TrimSuffix(value, "s")
	}
	return strconv.ParseFloat(value, 64)
}

func decodePolyline(encoded string) [][2]float64 {
	coords := make([][2]float64, 0)
	var lat int
	var lng int
	index := 0

	for index < len(encoded) {
		var result int
		var shift uint
		for {
			if index >= len(encoded) {
				return coords
			}
			b := int(encoded[index]) - 63
			index++
			result |= (b & 0x1f) << shift
			shift += 5
			if b < 0x20 {
				break
			}
		}

		dlat := result
		if dlat&1 != 0 {
			dlat = ^(dlat >> 1)
		} else {
			dlat >>= 1
		}
		lat += dlat

		result = 0
		shift = 0
		for {
			if index >= len(encoded) {
				return coords
			}
			b := int(encoded[index]) - 63
			index++
			result |= (b & 0x1f) << shift
			shift += 5
			if b < 0x20 {
				break
			}
		}

		dlng := result
		if dlng&1 != 0 {
			dlng = ^(dlng >> 1)
		} else {
			dlng >>= 1
		}
		lng += dlng

		coords = append(coords, [2]float64{float64(lng) / 1e5, float64(lat) / 1e5})
	}

	return coords
}
