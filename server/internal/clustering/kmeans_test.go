package clustering

import "testing"

func TestKMeansAssignments(t *testing.T) {
	points := []Point{
		{Lat: 0, Lng: 0},
		{Lat: 0.1, Lng: 0.1},
		{Lat: 10, Lng: 10},
		{Lat: 10.1, Lng: 10.1},
	}

	assignments := KMeans(points, 2)
	if len(assignments) != len(points) {
		t.Fatalf("expected %d assignments, got %d", len(points), len(assignments))
	}
	if assignments[0] != assignments[1] {
		t.Fatalf("expected nearby points in same cluster")
	}
	if assignments[2] != assignments[3] {
		t.Fatalf("expected distant points in same cluster")
	}
	if assignments[0] == assignments[2] {
		t.Fatalf("expected separate clusters for distant groups")
	}
}

func TestKMeansSinglePoint(t *testing.T) {
	assignments := KMeans([]Point{{Lat: 43.65, Lng: -79.38}}, 3)
	if len(assignments) != 1 || assignments[0] != 0 {
		t.Fatalf("unexpected assignments: %v", assignments)
	}
}
