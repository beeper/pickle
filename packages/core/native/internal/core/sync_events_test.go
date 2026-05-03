package core

import (
	"context"
	"encoding/json"
	"testing"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

func TestProcessSyncResponseEmitsGenericAndRawEvents(t *testing.T) {
	var emitted []OutboundEvent
	core := New(func(evt OutboundEvent) {
		emitted = append(emitted, evt)
	})
	core.client, _ = mautrix.NewClient("https://example.com", id.UserID("@alice:example"), "token")
	stateKey := "@alice:example"
	resp := &mautrix.RespSync{
		AccountData: mautrix.SyncEventsList{Events: []*event.Event{syncTestEvent(event.AccountDataDirectChats, map[string]any{"@bob:example": []any{"!room:example"}})}},
		ToDevice:    mautrix.SyncEventsList{Events: []*event.Event{syncTestEvent(event.ToDeviceRoomKey, map[string]any{"algorithm": "m.megolm.v1.aes-sha2"})}},
		Rooms: mautrix.RespSyncRooms{Join: map[id.RoomID]*mautrix.SyncJoinedRoom{
			"!room:example": {
				AccountData: mautrix.SyncEventsList{Events: []*event.Event{syncTestEvent(event.Type{Type: "m.tag", Class: event.AccountDataEventType}, map[string]any{"tags": map[string]any{}})}},
				Ephemeral: mautrix.SyncEventsList{Events: []*event.Event{syncTestEvent(event.EphemeralEventReceipt, map[string]any{"$event": map[string]any{}})}},
				State: mautrix.SyncEventsList{Events: []*event.Event{{
					Content:  event.Content{Raw: map[string]any{"membership": "join"}},
					RoomID:   id.RoomID("!room:example"),
					Sender:   id.UserID("@alice:example"),
					StateKey: &stateKey,
					Type:     event.StateMember,
				}}},
			},
		}},
	}

	if err := core.processSyncResponse(context.Background(), resp, "s123"); err != nil {
		t.Fatal(err)
	}

	counts := map[string]int{}
	for _, evt := range emitted {
		if eventType, ok := evt["type"].(string); ok {
			counts[eventType]++
		}
	}
	for _, eventType := range []string{"raw_event", "account_data", "to_device", "receipt", "membership"} {
		if counts[eventType] == 0 {
			t.Fatalf("expected %s event in %#v", eventType, counts)
		}
	}
	if counts["raw_event"] < 5 {
		t.Fatalf("expected raw event for each sync event, got %d", counts["raw_event"])
	}
}

func syncTestEvent(eventType event.Type, content map[string]any) *event.Event {
	raw, _ := json.Marshal(content)
	return &event.Event{
		Content: event.Content{Raw: content, VeryRaw: raw},
		Sender:  id.UserID("@alice:example"),
		Type:    eventType,
	}
}
