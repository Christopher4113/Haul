package storehours

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type PeriodTime struct {
	Day  int    `json:"day"`
	Time string `json:"time"`
}

type Period struct {
	Open  PeriodTime `json:"open"`
	Close PeriodTime `json:"close"`
}

type OpeningHours struct {
	OpenNow *bool    `json:"open_now"`
	Periods []Period `json:"periods"`
}

type Record struct {
	PlaceID   string
	HoursJSON json.RawMessage
	OpenNow   *bool
	OpensAt   *time.Time
	ClosesAt  *time.Time
}

func Upsert(ctx context.Context, pool *pgxpool.Pool, hours OpeningHours, placeID string) error {
	periodsJSON, err := json.Marshal(hours.Periods)
	if err != nil {
		return fmt.Errorf("marshal periods: %w", err)
	}

	now := time.Now()
	openHHMM, closeHHMM, hasToday := todayPeriod(hours.Periods, now)

	var opensAt *string
	var closesAt *string
	if hasToday {
		openTime, err := hhmmToPGTime(openHHMM)
		if err != nil {
			return err
		}
		closeTime, err := hhmmToPGTime(closeHHMM)
		if err != nil {
			return err
		}
		opensAt = &openTime
		closesAt = &closeTime
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO store_hours (place_id, hours_json, open_now, opens_at, closes_at, fetched_at)
		VALUES ($1, $2, $3, $4::time, $5::time, NOW())
		ON CONFLICT (place_id) DO UPDATE SET
			hours_json = EXCLUDED.hours_json,
			open_now = EXCLUDED.open_now,
			opens_at = EXCLUDED.opens_at,
			closes_at = EXCLUDED.closes_at,
			fetched_at = NOW()
	`, placeID, periodsJSON, hours.OpenNow, opensAt, closesAt)
	if err != nil {
		return fmt.Errorf("upsert store_hours: %w", err)
	}

	return nil
}

func todayPeriod(periods []Period, now time.Time) (openHHMM, closeHHMM string, ok bool) {
	day := int(now.Weekday())
	for _, period := range periods {
		if period.Open.Day == day {
			return period.Open.Time, period.Close.Time, true
		}
	}
	return "", "", false
}

func hhmmToPGTime(hhmm string) (string, error) {
	if len(hhmm) != 4 {
		return "", fmt.Errorf("invalid HHMM time %q", hhmm)
	}
	return fmt.Sprintf("%s:%s:00", hhmm[0:2], hhmm[2:4]), nil
}

func TimeOfDayToToday(value time.Time, now time.Time) time.Time {
	return time.Date(
		now.Year(),
		now.Month(),
		now.Day(),
		value.Hour(),
		value.Minute(),
		value.Second(),
		0,
		now.Location(),
	)
}
