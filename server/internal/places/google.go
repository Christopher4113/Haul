package places

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Result struct {
	PlaceID string
	Lat     float64
	Lng     float64
}

type Client struct {
	apiKey     string
	httpClient *http.Client
}

func NewClient(apiKey string) *Client {
	return &Client{
		apiKey: apiKey,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (c *Client) ResolveAddress(ctx context.Context, address string) (*Result, error) {
	if c.apiKey == "" {
		return nil, fmt.Errorf("google places api key is not configured")
	}

	placeID, err := c.autocomplete(ctx, address)
	if err != nil {
		return nil, err
	}

	return c.details(ctx, placeID)
}

func (c *Client) autocomplete(ctx context.Context, address string) (string, error) {
	endpoint := "https://maps.googleapis.com/maps/api/place/autocomplete/json"
	query := url.Values{}
	query.Set("input", address)
	query.Set("key", c.apiKey)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?"+query.Encode(), nil)
	if err != nil {
		return "", err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var payload struct {
		Status      string `json:"status"`
		Predictions []struct {
			PlaceID string `json:"place_id"`
		} `json:"predictions"`
		ErrorMessage string `json:"error_message"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", err
	}
	if payload.Status != "OK" && payload.Status != "ZERO_RESULTS" {
		if payload.ErrorMessage != "" {
			return "", fmt.Errorf("places autocomplete: %s", payload.ErrorMessage)
		}
		return "", fmt.Errorf("places autocomplete: %s", payload.Status)
	}
	if len(payload.Predictions) == 0 {
		return "", fmt.Errorf("no places found for address")
	}

	return payload.Predictions[0].PlaceID, nil
}

func (c *Client) details(ctx context.Context, placeID string) (*Result, error) {
	endpoint := "https://maps.googleapis.com/maps/api/place/details/json"
	query := url.Values{}
	query.Set("place_id", placeID)
	query.Set("fields", "geometry,place_id")
	query.Set("key", c.apiKey)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?"+query.Encode(), nil)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var payload struct {
		Status string `json:"status"`
		Result struct {
			PlaceID  string `json:"place_id"`
			Geometry struct {
				Location struct {
					Lat float64 `json:"lat"`
					Lng float64 `json:"lng"`
				} `json:"location"`
			} `json:"geometry"`
		} `json:"result"`
		ErrorMessage string `json:"error_message"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	if payload.Status != "OK" {
		if payload.ErrorMessage != "" {
			return nil, fmt.Errorf("places details: %s", payload.ErrorMessage)
		}
		return nil, fmt.Errorf("places details: %s", payload.Status)
	}

	lat := payload.Result.Geometry.Location.Lat
	lng := payload.Result.Geometry.Location.Lng
	if lat == 0 && lng == 0 {
		return nil, fmt.Errorf("places details: missing coordinates")
	}

	resolvedPlaceID := strings.TrimSpace(payload.Result.PlaceID)
	if resolvedPlaceID == "" {
		resolvedPlaceID = placeID
	}

	return &Result{
		PlaceID: resolvedPlaceID,
		Lat:     lat,
		Lng:     lng,
	}, nil
}
