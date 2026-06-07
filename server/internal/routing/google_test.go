package routing

import "testing"

func TestDecodePolyline(t *testing.T) {
	coords := decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")
	if len(coords) < 2 {
		t.Fatalf("expected at least 2 coordinates, got %d", len(coords))
	}

	if coords[0][0] >= coords[1][0] && coords[0][1] >= coords[1][1] {
		t.Fatalf("expected decoded deltas to produce distinct coordinates: %v", coords)
	}
}

func TestParseDurationSeconds(t *testing.T) {
	seconds, err := parseDurationSeconds("123s")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if seconds != 123 {
		t.Fatalf("expected 123, got %v", seconds)
	}
}
