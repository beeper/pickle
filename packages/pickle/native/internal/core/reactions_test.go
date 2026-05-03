package core

import (
	"context"
	"strings"
	"testing"

	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

func TestReactionRedactionSurvivesColdStart(t *testing.T) {
	ctx := context.Background()
	kv := memoryByteStore{values: map[string][]byte{}}
	first := New(nil)
	first.stores = &storeBundle{kv: kv}
	first.rememberReaction(ctx, reactionSnapshot{
		EventID:          id.EventID("$reaction"),
		Key:              "hi",
		RelatesToEventID: id.EventID("$message"),
		RoomID:           id.RoomID("!room:example"),
		Sender:           id.UserID("@alice:example"),
	})

	var emitted []OutboundEvent
	second := New(func(event OutboundEvent) {
		emitted = append(emitted, event)
	})
	second.stores = &storeBundle{kv: kv}
	if err := second.loadReactionSnapshots(ctx); err != nil {
		t.Fatal(err)
	}
	second.processRedaction(ctx, &event.Event{
		ID:      id.EventID("$redaction"),
		Redacts: id.EventID("$reaction"),
		RoomID:  id.RoomID("!room:example"),
		Type:    event.EventRedaction,
	})

	if len(emitted) != 1 {
		t.Fatalf("expected one emitted event, got %d", len(emitted))
	}
	reaction, ok := emitted[0]["event"].(MatrixReactionEvent)
	if !ok {
		t.Fatalf("expected reaction event, got %#v", emitted[0]["event"])
	}
	if boolValue(reaction.Added) {
		t.Fatal("expected reaction removal")
	}
	if reaction.RelatesToEventID != "$message" || reaction.Key != "hi" {
		t.Fatalf("unexpected reaction event: %#v", reaction)
	}
	if _, ok := kv.values[reactionSnapshotPrefix+"$reaction"]; ok {
		t.Fatal("expected persisted reaction snapshot to be deleted")
	}
}

type memoryByteStore struct {
	values map[string][]byte
}

func (store memoryByteStore) Delete(_ context.Context, key string) error {
	delete(store.values, key)
	return nil
}

func (store memoryByteStore) Get(_ context.Context, key string) ([]byte, error) {
	return store.values[key], nil
}

func (store memoryByteStore) List(_ context.Context, prefix string) ([]string, error) {
	keys := make([]string, 0, len(store.values))
	for key := range store.values {
		if strings.HasPrefix(key, prefix) {
			keys = append(keys, key)
		}
	}
	return keys, nil
}

func (store memoryByteStore) Set(_ context.Context, key string, value []byte) error {
	store.values[key] = value
	return nil
}
