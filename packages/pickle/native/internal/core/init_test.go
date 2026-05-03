package core

import (
	"context"
	"testing"

	"maunium.net/go/mautrix/crypto/backup"
	"maunium.net/go/mautrix/id"
)

func TestResolveStartupSyncPlanDefaultsToLiveCursorForFreshLogin(t *testing.T) {
	plan := resolveStartupSyncPlan(MatrixCoreInitOptions{}, "")
	if !plan.skipNextSync {
		t.Fatal("fresh login should establish a live cursor without timeline history")
	}
	if plan.nextBatch != "" {
		t.Fatalf("fresh login should sync without a since token, got %q", plan.nextBatch)
	}
	if plan.loadPendingDecryptions {
		t.Fatal("fresh live-cursor startup should not load stale pending decryptions")
	}
}

func TestResolveStartupSyncPlanUsesPersistedCursorAsFutureOnlyByDefault(t *testing.T) {
	plan := resolveStartupSyncPlan(MatrixCoreInitOptions{}, "s123")
	if !plan.skipNextSync {
		t.Fatal("persisted cursor should not catch up timeline events by default")
	}
	if plan.nextBatch != "s123" {
		t.Fatalf("expected stored cursor, got %q", plan.nextBatch)
	}
	if plan.loadPendingDecryptions {
		t.Fatal("future-only startup should not load stale pending decryptions")
	}
	if plan.cursorSource != "stored_latest" {
		t.Fatalf("expected stored_latest source, got %q", plan.cursorSource)
	}
}

func TestResolveStartupSyncPlanUsesProvidedCursor(t *testing.T) {
	plan := resolveStartupSyncPlan(MatrixCoreInitOptions{InitialSyncSince: "provided"}, "stored")
	if plan.skipNextSync {
		t.Fatal("provided cursor should catch up from that cursor")
	}
	if plan.nextBatch != "provided" {
		t.Fatalf("expected provided cursor, got %q", plan.nextBatch)
	}
	if plan.cursorSource != "provided" {
		t.Fatalf("expected provided source, got %q", plan.cursorSource)
	}
}

func TestResolveStartupSyncPlanCompatibilityCatchUpOnStartFalseMeansLatest(t *testing.T) {
	catchUp := false
	plan := resolveStartupSyncPlan(MatrixCoreInitOptions{CatchUpOnStart: &catchUp}, "stored")
	if !plan.skipNextSync {
		t.Fatal("catchUpOnStart=false should skip timeline catch-up")
	}
	if plan.nextBatch != "stored" {
		t.Fatalf("expected stored cursor to advance from, got %q", plan.nextBatch)
	}
}

func TestRecoveryBackupCacheRoundTripsWithMatchingRecoveryKey(t *testing.T) {
	ctx := context.Background()
	store := mapByteStore{values: make(map[string][]byte)}
	bundle := &storeBundle{kv: store, pickleKey: []byte("pickle"), prefix: "test/"}
	backupKey, err := backup.NewMegolmBackupKey()
	if err != nil {
		t.Fatal(err)
	}

	if err := bundle.SaveRecoveryBackup(ctx, "recovery", id.KeyBackupVersion("v1"), backupKey); err != nil {
		t.Fatal(err)
	}
	version, loaded, ok, err := bundle.LoadRecoveryBackup(ctx, "recovery")
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("expected cached recovery backup")
	}
	if version != "v1" {
		t.Fatalf("expected version v1, got %q", version)
	}
	if string(loaded.Bytes()) != string(backupKey.Bytes()) {
		t.Fatal("loaded backup key does not match saved backup key")
	}
}

func TestRecoveryBackupCacheRejectsDifferentRecoveryKey(t *testing.T) {
	ctx := context.Background()
	store := mapByteStore{values: make(map[string][]byte)}
	bundle := &storeBundle{kv: store, pickleKey: []byte("pickle"), prefix: "test/"}
	backupKey, err := backup.NewMegolmBackupKey()
	if err != nil {
		t.Fatal(err)
	}

	if err := bundle.SaveRecoveryBackup(ctx, "recovery", "", backupKey); err != nil {
		t.Fatal(err)
	}
	_, _, ok, err := bundle.LoadRecoveryBackup(ctx, "different")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("cache should not load with a different recovery key")
	}
}

type mapByteStore struct {
	values map[string][]byte
}

func (store mapByteStore) Delete(_ context.Context, key string) error {
	delete(store.values, key)
	return nil
}

func (store mapByteStore) Get(_ context.Context, key string) ([]byte, error) {
	value := store.values[key]
	if value == nil {
		return nil, nil
	}
	return append([]byte(nil), value...), nil
}

func (store mapByteStore) List(_ context.Context, prefix string) ([]string, error) {
	keys := make([]string, 0, len(store.values))
	for key := range store.values {
		if len(key) >= len(prefix) && key[:len(prefix)] == prefix {
			keys = append(keys, key)
		}
	}
	return keys, nil
}

func (store mapByteStore) Set(_ context.Context, key string, value []byte) error {
	store.values[key] = append([]byte(nil), value...)
	return nil
}
