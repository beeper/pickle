package core

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestTrimPendingDecryptionsDropsOldAndCapsNewest(t *testing.T) {
	c := New(nil)
	now := time.Now()
	pending := make([]pendingDecryption, 0, maxPendingDecryptions+2)
	pending = append(pending, pendingDecryption{
		AddedAt: now.Add(-maxPendingAge - time.Minute).UnixMilli(),
		EventID: "old",
	})
	for i := range maxPendingDecryptions + 1 {
		pending = append(pending, pendingDecryption{
			AddedAt: now.Add(time.Duration(i) * time.Second).UnixMilli(),
			EventID: string(rune('a' + i%26)),
		})
	}

	trimmed := c.trimPendingDecryptions(pending)
	if len(trimmed) != maxPendingDecryptions {
		t.Fatalf("expected %d pending decryptions, got %d", maxPendingDecryptions, len(trimmed))
	}
	if trimmed[0].AddedAt < trimmed[len(trimmed)-1].AddedAt {
		t.Fatal("expected pending decryptions to be newest-first")
	}
	for _, item := range trimmed {
		if item.EventID == "old" {
			t.Fatal("old pending decryption was not dropped")
		}
	}
}

func TestRequestMissingSessionIgnoresIncompletePending(t *testing.T) {
	c := New(nil)
	if c.requestMissingSession(context.Background(), &pendingDecryption{RoomID: "!room:example"}, true) {
		t.Fatal("incomplete pending decryption should not restore from backup")
	}
}

func TestPendingDecryptionsPersistAcrossColdStart(t *testing.T) {
	ctx := context.Background()
	store := memoryByteStore{values: map[string][]byte{}}
	first := New(nil)
	first.stores = &storeBundle{kv: store}
	first.pendingDecryptions = []pendingDecryption{
		{
			AddedAt:   time.Now().UnixMilli(),
			Attempts:  2,
			Event:     json.RawMessage(`{"event_id":"$encrypted"}`),
			EventID:   "$encrypted",
			RoomID:    "!room:example",
			SessionID: "session",
		},
	}
	if err := first.savePendingDecryptions(ctx); err != nil {
		t.Fatal(err)
	}

	second := New(nil)
	second.stores = &storeBundle{kv: store}
	if err := second.loadPendingDecryptions(ctx); err != nil {
		t.Fatal(err)
	}

	if len(second.pendingDecryptions) != 1 {
		t.Fatalf("expected one pending decryption, got %d", len(second.pendingDecryptions))
	}
	loaded := second.pendingDecryptions[0]
	if loaded.EventID != "$encrypted" || loaded.Attempts != 2 || loaded.SessionID != "session" {
		t.Fatalf("unexpected pending decryption: %#v", loaded)
	}
}
