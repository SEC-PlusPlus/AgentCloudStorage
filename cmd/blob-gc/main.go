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
// Assumptions this sweeper is built on — all three are load-bearing:
//   - MinIO bucket versioning is OFF (the deployment assumption in
//     deploy/README): List surfaces exactly the current object set, and a
//     re-Copy of blobs/<sha> replaces rather than shadows it.
//   - The safety window exceeds the longest healthy upload: a tmp object is
//     written by ONE in-flight request (direct uploads are ≤50MiB and finish
//     in seconds), so a LIVE tmp is always younger than maxAge and survives.
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

	result := struct {
		DryRun       bool     `json:"dry_run"`
		MaxAge       string   `json:"max_age"`
		PlannedBlobs []string `json:"planned_blobs"`
		PlannedTmps  []string `json:"planned_tmps"`
		DeletedBlobs int      `json:"deleted_blobs"`
		DeletedTmps  int      `json:"deleted_tmps"`
		Failures     int      `json:"failures"`
	}{
		DryRun:       *dryRun,
		MaxAge:       maxAge.String(),
		PlannedBlobs: plan.Blobs,
		PlannedTmps:  plan.Tmps,
	}

	if !*dryRun {
		for _, key := range plan.Blobs {
			if err := objectStorage.Delete(ctx, key); err != nil {
				slog.Error("delete blob failed", "key", key, "error", err)
				result.Failures++
				continue
			}
			result.DeletedBlobs++
		}
		for _, key := range plan.Tmps {
			if err := objectStorage.Delete(ctx, key); err != nil {
				slog.Error("delete tmp object failed", "key", key, "error", err)
				result.Failures++
				continue
			}
			result.DeletedTmps++
		}
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
		"failures", result.Failures)
	if result.Failures > 0 {
		os.Exit(1)
	}
}

func toListed(infos []storage.ObjectInfo) []listedObject {
	out := make([]listedObject, 0, len(infos))
	for _, info := range infos {
		out = append(out, listedObject{Key: info.Key, Size: info.Size, LastModified: info.LastModified})
	}
	return out
}
