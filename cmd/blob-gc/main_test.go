package main

import (
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// executePlan (B5 review I1): the per-key objects recheck immediately before
// each blob delete closes the residual §1.4 race (census sees the row gone at
// t0, a same-sha rebuild commits its CopyObject+INSERT mid-run, our RemoveObject
// would land on live bytes). tmps carry no rows, so they never recheck.
// ---------------------------------------------------------------------------

func TestExecutePlanSkipsReappearedBlobRow(t *testing.T) {
	plan := gcPlan{
		Blobs: []string{"blobs/" + shaA, "blobs/" + shaB},
		Tmps:  []string{"users/7/tmp-crash"},
	}
	var deleted []string
	checked := 0
	liveRows := map[string]bool{"blobs/" + shaA: true} // row rebuilt mid-sweep
	res := executePlan(plan,
		func(key string) error { deleted = append(deleted, key); return nil },
		func(key string) (bool, error) {
			checked++
			return liveRows[key], nil
		},
	)
	if res.DeletedBlobs != 1 || res.SkippedBlobs != 1 || res.DeletedTmps != 1 || res.Failures != 0 {
		t.Fatalf("result = %+v, want {1 deleted blob, 1 skipped, 1 tmp, 0 failures}", res)
	}
	want := []string{"blobs/" + shaB, "users/7/tmp-crash"}
	if !reflect.DeepEqual(deleted, want) {
		t.Fatalf("deleted = %v, want %v (reappeared blob NEVER deleted)", deleted, want)
	}
	if checked != 2 {
		t.Errorf("rechecks = %d, want 2 (blobs only — tmp must not recheck)", checked)
	}
}

func TestExecutePlanRecheckErrorIsConservativeSkip(t *testing.T) {
	boom := errors.New("db down")
	var deleted []string
	res := executePlan(gcPlan{Blobs: []string{"blobs/" + shaA}},
		func(key string) error { deleted = append(deleted, key); return nil },
		func(string) (bool, error) { return false, boom },
	)
	if len(deleted) != 0 {
		t.Errorf("deleted %v after a failed recheck — must never blind-delete", deleted)
	}
	if res.Failures != 1 || res.DeletedBlobs != 0 {
		t.Errorf("result = %+v, want failures 1 / deleted 0", res)
	}
}

func TestCensusGuardEmptyCensusFootgun(t *testing.T) {
	// Mis-pointed config: zero rows but aged blobs planned → refuse, and the
	// error must name the escape hatch.
	err := censusGuard(0, 3, false)
	if err == nil {
		t.Fatal("empty census + planned blobs must abort")
	}
	if !strings.Contains(err.Error(), "--force") {
		t.Errorf("guard error must name --force: %v", err)
	}
	if err := censusGuard(0, 3, true); err != nil {
		t.Errorf("--force must override: %v", err)
	}
	if err := censusGuard(7, 3, false); err != nil {
		t.Errorf("non-empty census must pass: %v", err)
	}
	if err := censusGuard(0, 0, false); err != nil {
		t.Errorf("empty plan needs no guard: %v", err)
	}
}

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
