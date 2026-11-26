package main

import (
	"reflect"
	"testing"
	"time"
)

// gcDecision matrix (B5 contract 3):
//   - blob WITH an objects row                      → keep, any age
//   - blob rowless, age > maxAge                    → delete
//   - blob rowless, age <= maxAge (incl. boundary)  → keep
//   - tmp (users/*/tmp-*), age > maxAge             → delete
//   - tmp young                                     → keep
//   - users/<uid>/<uuid> multipart key, ANY age     → NEVER
//   - odd keys (non-hex blobs/, other prefixes)     → NEVER (out of contract)

func TestGcDecisionKeepsBlobWithRow(t *testing.T) {
	now := mustTime()
	old := now.Add(-2 * time.Hour)
	plan := gcDecision(
		[]objectRow{{Sha256: shaA, ObjectKey: "blobs/" + shaA}},
		[]listedObject{{Key: "blobs/" + shaA, Size: 10, LastModified: old}},
		nil, now, time.Hour,
	)
	if len(plan.Blobs) != 0 || len(plan.Tmps) != 0 {
		t.Fatalf("plan = %+v, want empty — a blob with a row is IN USE at any age", plan)
	}
}

func TestGcDecisionRowMatchByShaEvenIfStoredKeyDiffers(t *testing.T) {
	// Defensive arm: rows normally key blobs/<sha>, but a row whose sha equals
	// the blob's suffix keeps the blob even if object_key drifted.
	now := mustTime()
	plan := gcDecision(
		[]objectRow{{Sha256: shaA, ObjectKey: "somewhere/else"}},
		[]listedObject{{Key: "blobs/" + shaA, LastModified: now.Add(-2 * time.Hour)}},
		nil, now, time.Hour,
	)
	if len(plan.Blobs) != 0 {
		t.Fatalf("blobs = %v, want none (row exists for that sha)", plan.Blobs)
	}
}

func TestGcDecisionRowlessAgeWindow(t *testing.T) {
	now := mustTime()
	plan := gcDecision(nil, []listedObject{
		{Key: "blobs/" + shaA, LastModified: now.Add(-90 * time.Minute)}, // old → delete
		{Key: "blobs/" + shaB, LastModified: now.Add(-30 * time.Minute)}, // fresh → keep
		{Key: "blobs/" + shaC, LastModified: now.Add(-time.Hour)},        // boundary age==maxAge → keep (strict >)
	}, nil, now, time.Hour)
	want := []string{"blobs/" + shaA}
	if !reflect.DeepEqual(plan.Blobs, want) {
		t.Fatalf("blobs = %v, want %v", plan.Blobs, want)
	}
}

func TestGcDecisionMaxAgeZeroDeletesPastOnly(t *testing.T) {
	// --max-age 0: strictly-older-than-now is gone. The live e2e relies on
	// this: any object written microseconds ago has LastModified < now.
	now := mustTime()
	plan := gcDecision(nil, []listedObject{
		{Key: "blobs/" + shaA, LastModified: now.Add(-time.Nanosecond)},
		{Key: "blobs/" + shaB, LastModified: now},
	}, []listedObject{
		{Key: "users/7/tmp-crash", LastModified: now.Add(-time.Second)},
	}, now, 0)
	if !reflect.DeepEqual(plan.Blobs, []string{"blobs/" + shaA}) {
		t.Errorf("blobs = %v, want [%s]", plan.Blobs, "blobs/"+shaA)
	}
	if !reflect.DeepEqual(plan.Tmps, []string{"users/7/tmp-crash"}) {
		t.Errorf("tmps = %v, want the crash leftover", plan.Tmps)
	}
}

func TestGcDecisionTmpRules(t *testing.T) {
	now := mustTime()
	old := now.Add(-2 * time.Hour)
	plan := gcDecision(nil, nil, []listedObject{
		{Key: "users/7/tmp-old", LastModified: old},   // swept
		{Key: "users/7/tmp-fresh", LastModified: now}, // live upload must survive
		{Key: "users/7/550e8400-e29b-41d4-a716-446655440000", // multipart live object: NEVER
			LastModified: old},
		{Key: "users/7/legacy-object", LastModified: old}, // legacy exclusive key: never (no row logic here)
		{Key: "weird/tmp-key", LastModified: old},         // not users/<uid>/tmp-*: never
	}, now, time.Hour)
	if !reflect.DeepEqual(plan.Tmps, []string{"users/7/tmp-old"}) {
		t.Fatalf("tmps = %v, want exactly [users/7/tmp-old]", plan.Tmps)
	}
}

func TestGcDecisionIgnoresOddBlobKeys(t *testing.T) {
	now := mustTime()
	old := now.Add(-2 * time.Hour)
	plan := gcDecision(nil, []listedObject{
		{Key: "blobs/", LastModified: old},
		{Key: "blobs/not-hex", LastModified: old},
		{Key: "blobs/" + shaA + "trailing", LastModified: old},
		{Key: "blobs/" + upperA, LastModified: old}, // uppercase hex is not our convention
		{Key: "elsewhere/" + shaA, LastModified: old},
	}, nil, now, time.Hour)
	if len(plan.Blobs) != 0 {
		t.Fatalf("blobs = %v, want none — only blobs/<64-lowercase-hex> is in contract", plan.Blobs)
	}
}

func TestGcDecisionSortedAndEmpty(t *testing.T) {
	now := mustTime()
	old := now.Add(-2 * time.Hour)
	plan := gcDecision(nil, []listedObject{
		{Key: "blobs/" + shaC, LastModified: old},
		{Key: "blobs/" + shaA, LastModified: old},
		{Key: "blobs/" + shaB, LastModified: old},
	}, []listedObject{
		{Key: "users/9/tmp-z", LastModified: old},
		{Key: "users/1/tmp-a", LastModified: old},
	}, now, time.Hour)
	wantBlobs := []string{"blobs/" + shaA, "blobs/" + shaB, "blobs/" + shaC}
	wantTmps := []string{"users/1/tmp-a", "users/9/tmp-z"}
	if !reflect.DeepEqual(plan.Blobs, wantBlobs) || !reflect.DeepEqual(plan.Tmps, wantTmps) {
		t.Fatalf("plan = %+v, want sorted %v / %v", plan, wantBlobs, wantTmps)
	}

	empty := gcDecision(nil, nil, nil, now, time.Hour)
	if len(empty.Blobs) != 0 || len(empty.Tmps) != 0 {
		t.Fatalf("empty inputs → %+v", empty)
	}
}

func mustTime() time.Time {
	// A fixed wall clock keeps "boundary age == maxAge" exact.
	return time.Date(2026, 11, 26, 12, 0, 0, 0, time.UTC)
}

const (
	shaA   = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	shaB   = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	shaC   = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
	upperA = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
)
