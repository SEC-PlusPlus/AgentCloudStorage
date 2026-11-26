// Command blob-gc is the delayed physical-GC sweeper of the dedup design
// (spec §1.4). PermanentDelete never deletes a shared blob inline — the
// refcount-zero path only removes the objects row — because a late
// storage.Delete could kill a just-rebuilt same-sha object (the §1.4
// data-loss race). This command closes the loop: it lists the bucket, deletes
// blobs that have NO objects row and are OLDER than the safety window, and
// sweeps crash-leftover tmp keys.
//
// Usage (same CONFIG_FILE / env conventions as cmd/server):
//
//	go run ./cmd/blob-gc                 # real sweep, max-age 1h
//	go run ./cmd/blob-gc --dry-run       # print the plan JSON, delete nothing
//	go run ./cmd/blob-gc --max-age 0     # sweep-everything-older-than-now (tests)
//
// Output: one JSON object on stdout {"dry_run","planned_blobs","planned_tmps",
// "deleted_blobs","deleted_tmps","failures"}; diagnostics on stderr via slog.
// Exit code 1 on any configuration/connection/delete failure.
//
// Scheduling (deploy/README): v1 is a manually-invoked (cron-able) one-shot,
// no daemon — a daily run with the default 1h window is the suggested cadence
// for a personal drive; see deploy/README.md for the cron line.
//
// Assumptions this sweeper is built on — load-bearing:
//   - MinIO bucket versioning is OFF (the deployment assumption in
//     deploy/README): List surfaces exactly the current object set, and a
//     re-Copy of blobs/<sha> replaces rather than shadows it.
//   - 窗口以对象 age 近似行丢失时刻（B5 review I1）：the safety window
//     approximates the ROW-LOSS time by the BLOB's LastModified, which only
//     bounds it for first-ever uploads — a same-sha rebuild refreshes the age
//     AND the row, so the dangerous shape (row lost at t0, blob age stale) is
//     closed NOT by the window but by executePlan's per-key objects recheck
//     immediately before each blob delete. tmps are never row-referenced, so
//     no recheck is needed there.
//   - The window exceeds the longest healthy upload: a tmp object is written
//     by ONE in-flight request (direct uploads are ≤50MiB and finish in
//     seconds), so a LIVE tmp is always younger than maxAge and survives.
//     Anything older at users/*/tmp-* is a crash leftover by construction.
//   - Multipart channel keys users/<uid>/<uuid> are NEVER touched: the v1
//     dedup scope (spec §1.2 decision 2) leaves them exclusively owned by
//     their files rows; deleting one here would destroy live data.
package main

import (
	"PersonalCloudStorage/internal/config"
	"PersonalCloudStorage/internal/database"
	"PersonalCloudStorage/internal/file"
	"PersonalCloudStorage/internal/storage"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"sort"
	"strings"
	"time"
)

// objectRow is one row of the `objects` table — the liveness authority for
// blobs/<sha>. Only the identity columns are read.
type objectRow struct {
	Sha256    string
	ObjectKey string
}

// listedObject is one bucket listing entry as needed by the decision: key +
// age source (LastModified). Size is carried for diagnostics only.
type listedObject struct {
	Key          string
	Size         int64
	LastModified time.Time
}

// gcPlan is the decision output: keys to delete, split by rule so the runner
// (and the e2e script) can tell blobs sweeps from tmp sweeps.
type gcPlan struct {
	Blobs []string
	Tmps  []string
}

// gcDecision is the PURE sweeper rule — every safety property of the command
// lives here and is unit-tested without MinIO or MySQL:
//
//   - blobs are deleted iff NO objects row references them (matched by
//     object_key OR by blobs/<sha> derived from the row's sha) AND their age
//     strictly exceeds maxAge (age == maxAge keeps — the window is inclusive);
//   - tmp keys (users/<uid>/tmp-*) older than maxAge are crash leftovers and
//     get swept; anything at users/<uid>/ with another final component —
//     multipart objects, legacy keys — is NEVER touched;
//   - keys outside the two prefixes, or under blobs/ but not blobs/<64-hex>,
//     are out of contract and stay untouched (a human investigates those).
func gcDecision(objs []objectRow, blobs, userObjects []listedObject, now time.Time, maxAge time.Duration) gcPlan {
	live := make(map[string]struct{}, 2*len(objs))
	for _, row := range objs {
		if row.ObjectKey != "" {
			live[row.ObjectKey] = struct{}{}
		}
		if isLowerHex64(row.Sha256) {
			live[file.BlobObjectKey(row.Sha256)] = struct{}{}
		}
	}

	plan := gcPlan{Blobs: []string{}, Tmps: []string{}}
	for _, blob := range blobs {
		if _, hasRow := live[blob.Key]; hasRow {
			continue
		}
		sha, ok := strings.CutPrefix(blob.Key, "blobs/")
		if !ok || !isLowerHex64(sha) {
			continue
		}
		if now.Sub(blob.LastModified) > maxAge {
			plan.Blobs = append(plan.Blobs, blob.Key)
		}
	}

	for _, entry := range userObjects {
		if !isTmpKey(entry.Key) {
			continue
		}
		if now.Sub(entry.LastModified) > maxAge {
			plan.Tmps = append(plan.Tmps, entry.Key)
		}
	}

	sort.Strings(plan.Blobs)
	sort.Strings(plan.Tmps)
	return plan
}

// isLowerHex64 mirrors file.validateBlobSha256's rule without exporting it —
// a blob key only counts as content-addressed when its suffix is a canonical
// lowercase hex digest, exactly what BlobObjectKey can produce.
func isLowerHex64(s string) bool {
	if len(s) != 64 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

// isTmpKey accepts only users/<uid>/tmp-*: the exact shape Upload writes
// before promotion. The "tmp-" discriminator is what keeps live multipart
// keys users/<uid>/<uuid> permanently out of reach.
func isTmpKey(key string) bool {
	rest, ok := strings.CutPrefix(key, "users/")
	if !ok {
		return false
	}
	uid, tail, ok := strings.Cut(rest, "/")
	return ok && uid != "" && strings.HasPrefix(tail, "tmp-")
}

func main() {
	maxAge := flag.Duration("max-age", time.Hour, "safety window: sweep only objects strictly older than this (0 = everything older than now; tests)")
	dryRun := flag.Bool("dry-run", false, "print the deletion plan as JSON and delete nothing")
	force := flag.Bool("force", false, "proceed even when the objects census is empty while blobs are planned (mis-config guard off; see censusGuard)")
	flag.Parse()

	if *maxAge < 0 {
		slog.Error("max-age must not be negative", "max_age", *maxAge)
		os.Exit(1)
	}

	// Config + connections reuse the server's wiring so the sweeper targets
	// exactly the same MySQL/MinIO pair. storage.NewMinIO refuses an empty
	// endpoint/creds/bucket and database.OpenMySQL an empty DSN — together
	// that is the "obviously broken config → refuse to run" guard.
	cfg, err := config.Load()
	if err != nil {
		slog.Error("load config failed", "error", err)
		os.Exit(1)
	}
	objectStorage, err := storage.NewMinIO(storage.MinIOConfig{
		Endpoint:  cfg.MinIO.Endpoint,
		AccessKey: cfg.MinIO.AccessKey,
		SecretKey: cfg.MinIO.SecretKey,
		Bucket:    cfg.MinIO.Bucket,
		UseSSL:    cfg.MinIO.UseSSL,
	})
	if err != nil {
		slog.Error("create minio storage failed", "error", err)
		os.Exit(1)
	}
	db, err := database.OpenMySQL(cfg.MySQL.ConnectionString())
	if err != nil {
		slog.Error("connect mysql failed", "error", err)
		os.Exit(1)
	}
	defer func() {
		if sqlDB, dbErr := db.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	}()

	// Liveness authority. A missing/unreadable objects table aborts BEFORE
	// any listing is trusted — treating "no rows I can read" as "no rows"
	// would delete every aged blob, so this query must simply succeed.
	// (Migrations 000007/000008 applied is a hard prerequisite — deploy/README.)
	var rows []objectRow
	if err := db.Table("objects").Select("sha256, object_key").Scan(&rows).Error; err != nil {
		slog.Error("read objects table failed — is migration 000007 applied?", "error", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	listBlobs, err := objectStorage.List(ctx, "blobs/")
	if err != nil {
		slog.Error("list blobs failed", "error", err)
		os.Exit(1)
	}
	listUsers, err := objectStorage.List(ctx, "users/")
	if err != nil {
		slog.Error("list users objects failed", "error", err)
		os.Exit(1)
	}

	plan := gcDecision(rows, toListed(listBlobs), toListed(listUsers), time.Now(), *maxAge)

	if err := censusGuard(len(rows), len(plan.Blobs), *force); err != nil {
		slog.Error(err.Error())
		os.Exit(1)
	}

	result := struct {
		DryRun       bool     `json:"dry_run"`
		MaxAge       string   `json:"max_age"`
		PlannedBlobs []string `json:"planned_blobs"`
		PlannedTmps  []string `json:"planned_tmps"`
		DeletedBlobs int      `json:"deleted_blobs"`
		DeletedTmps  int      `json:"deleted_tmps"`
		SkippedBlobs int      `json:"skipped_blobs"`
		Failures     int      `json:"failures"`
	}{
		DryRun:       *dryRun,
		MaxAge:       maxAge.String(),
		PlannedBlobs: plan.Blobs,
		PlannedTmps:  plan.Tmps,
	}

	if !*dryRun {
		// rowExists: the I1 per-key recheck — an objects row matching by
		// object_key OR blobs/<sha> (exactly the census's liveness test,
		// re-run NOW so a rebuild that committed mid-flight is respected).
		rowExists := func(key string) (bool, error) {
			q := db.Table("objects").Where("object_key = ?", key)
			if sha, ok := strings.CutPrefix(key, "blobs/"); ok && isLowerHex64(sha) {
				q = q.Or("sha256 = ?", sha)
			}
			var n int64
			if err := q.Count(&n).Error; err != nil {
				return false, err
			}
			return n > 0, nil
		}
		del := func(key string) error { return objectStorage.Delete(ctx, key) }
		run := executePlan(plan, del, rowExists)
		result.DeletedBlobs = run.DeletedBlobs
		result.DeletedTmps = run.DeletedTmps
		result.SkippedBlobs = run.SkippedBlobs
		result.Failures = run.Failures
	}

	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		slog.Error("write plan json failed", "error", err)
		os.Exit(1)
	}
	slog.Info("blob-gc finished",
		"dry_run", result.DryRun,
		"planned_blobs", len(plan.Blobs),
		"planned_tmps", len(plan.Tmps),
		"deleted_blobs", result.DeletedBlobs,
		"deleted_tmps", result.DeletedTmps,
		"skipped_blobs", result.SkippedBlobs,
		"failures", result.Failures)
	if result.Failures > 0 {
		os.Exit(1)
	}
}

// planResult tallies one executePlan run.
type planResult struct {
	DeletedBlobs int
	DeletedTmps  int
	SkippedBlobs int // rows reappeared at recheck — §1.4 race closed live
	Failures     int
}

// executePlan performs the deletion half of the sweep (B5 review I1):
// IMMEDIATELY before each blob delete it rechecks the objects table
// (`rowExists`) — the census above only approximates the row-loss moment via
// blob age, so a same-sha rebuild whose CopyObject+INSERT commit landed
// between census and here would otherwise lose its bytes to our RemoveObject
// (the ONLY surviving delete-references-blob path, and exactly the §1.4 race
// the delayed design exists to 杜绝). Recheck hit → skip, keep bytes. tmp
// keys carry no row ever, so they delete straight away. A failed recheck is
// treated as "row may exist": conservative skip + failure, never a blind
// delete.
func executePlan(plan gcPlan, del func(string) error, rowExists func(string) (bool, error)) planResult {
	var res planResult
	for _, key := range plan.Blobs {
		live, err := rowExists(key)
		if err != nil {
			slog.Error("objects recheck failed — skipping key (conservative)", "key", key, "error", err)
			res.Failures++
			continue
		}
		if live {
			slog.Warn("objects row reappeared since census — skipping (in use)", "key", key)
			res.SkippedBlobs++
			continue
		}
		if err := del(key); err != nil {
			slog.Error("delete blob failed", "key", key, "error", err)
			res.Failures++
			continue
		}
		res.DeletedBlobs++
	}
	for _, key := range plan.Tmps {
		if err := del(key); err != nil {
			slog.Error("delete tmp object failed", "key", key, "error", err)
			res.Failures++
			continue
		}
		res.DeletedTmps++
	}
	return res
}

// censusGuard is the mis-pointed-config footgun break (B5 review M4): a
// healthy dedup deployment ALWAYS has objects rows for its blobs/. Zero rows
// while the plan wants to delete aged blobs therefore means the DB we
// queried is not the one the bucket belongs to (wrong config/env) — deleting
// then would erase a live drive. Refuse unless --force.
func censusGuard(objectRows, plannedBlobs int, force bool) error {
	if objectRows == 0 && plannedBlobs > 0 && !force {
		return fmt.Errorf(
			"objects census returned ZERO rows while %d aged blob(s) are planned for deletion — "+
				"the database almost certainly is not the one this bucket belongs to; "+
				"verify config, then re-run with --force only if a rowless-while-blobs-alive state is real",
			plannedBlobs,
		)
	}
	return nil
}

func toListed(infos []storage.ObjectInfo) []listedObject {
	out := make([]listedObject, 0, len(infos))
	for _, info := range infos {
		out = append(out, listedObject{Key: info.Key, Size: info.Size, LastModified: info.LastModified})
	}
	return out
}
