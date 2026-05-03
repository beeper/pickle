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
		NextBatch:   "s124",
		AccountData: mautrix.SyncEventsList{Events: []*event.Event{syncTestEvent(event.AccountDataDirectChats, map[string]any{"@bob:example": []any{"!room:example"}})}},
		DeviceLists: mautrix.DeviceLists{
			Changed: []id.UserID{"@alice:example"},
			Left:    []id.UserID{"@left:example"},
		},
		Presence: mautrix.SyncEventsList{Events: []*event.Event{syncTestEvent(event.EphemeralEventPresence, map[string]any{"presence": "online"})}},
		ToDevice: mautrix.SyncEventsList{Events: []*event.Event{syncTestEvent(event.ToDeviceRoomKey, map[string]any{"algorithm": "m.megolm.v1.aes-sha2"})}},
		Rooms: mautrix.RespSyncRooms{Join: map[id.RoomID]*mautrix.SyncJoinedRoom{
			"!room:example": {
				AccountData: mautrix.SyncEventsList{Events: []*event.Event{syncTestEvent(event.Type{Type: "m.tag", Class: event.AccountDataEventType}, map[string]any{"tags": map[string]any{}})}},
				Ephemeral: mautrix.SyncEventsList{Events: []*event.Event{
					syncTestEvent(event.EphemeralEventReceipt, map[string]any{"$event": map[string]any{}}),
					syncTestEvent(event.EphemeralEventTyping, map[string]any{"user_ids": []any{"@alice:example"}}),
				}},
				State: mautrix.SyncEventsList{Events: []*event.Event{{
					Content:  event.Content{Raw: map[string]any{"membership": "join"}},
					RoomID:   id.RoomID("!room:example"),
					Sender:   id.UserID("@alice:example"),
					StateKey: &stateKey,
					Type:     event.StateMember,
				}}},
				Timeline: mautrix.SyncTimeline{
					SyncEventsList: mautrix.SyncEventsList{Events: []*event.Event{{
						Content: event.Content{Raw: map[string]any{"algorithm": "m.megolm.v1.aes-sha2", "ciphertext": "cipher"}},
						ID:      id.EventID("$message"),
						RoomID:  id.RoomID("!room:example"),
						Sender:  id.UserID("@alice:example"),
						Type:    event.EventEncrypted,
					}}},
				},
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
	for _, eventType := range []string{"raw_event", "account_data", "to_device", "receipt", "typing", "presence", "device_list", "membership"} {
		if counts[eventType] == 0 {
			t.Fatalf("expected %s event in %#v", eventType, counts)
		}
	}
	if counts["raw_event"] < 9 {
		t.Fatalf("expected raw event for each sync event, got %d", counts["raw_event"])
	}
	foundTimelineRaw := false
	for _, evt := range emitted {
		syncEvent, ok := evt["event"].(MatrixSyncEvent)
		if !ok || syncEvent.Section != "room_timeline" {
			continue
		}
		if syncEvent.NextBatch == nil || *syncEvent.NextBatch != "s124" {
			t.Fatalf("expected next batch on timeline raw event, got %#v", syncEvent.NextBatch)
		}
		if syncEvent.Encrypted == nil || !*syncEvent.Encrypted {
			t.Fatalf("expected encrypted raw timeline status, got %#v", syncEvent.Encrypted)
		}
		foundTimelineRaw = true
	}
	if !foundTimelineRaw {
		t.Fatal("expected room timeline raw event")
	}
}

func TestApplySyncResponseSkipsStaleWebhookReplay(t *testing.T) {
	var emitted []OutboundEvent
	core := New(func(evt OutboundEvent) {
		emitted = append(emitted, evt)
	})
	core.client, _ = mautrix.NewClient("https://example.com", id.UserID("@alice:example"), "token")
	core.nextBatch = "s124"

	_, err := core.handleApplySyncResponse(context.Background(), []byte(`{
		"since":"s123",
		"response":{
			"next_batch":"s124",
			"rooms":{
				"join":{
					"!room:example":{
						"timeline":{
							"events":[{
								"content":{"body":"hello","msgtype":"m.text"},
								"event_id":"$message",
								"sender":"@alice:example",
								"type":"m.room.message"
							}]
						}
					}
				}
			}
		}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	for _, evt := range emitted {
		if evt["type"] == "message" || evt["type"] == "raw_event" {
			t.Fatalf("stale apply should not replay events, got %#v", emitted)
		}
	}
	if len(emitted) != 1 || emitted[0]["status"] != "skipped" {
		t.Fatalf("expected skipped status, got %#v", emitted)
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
