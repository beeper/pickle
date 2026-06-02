package core

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

func TestConvertMessageEventNormalizesRelationsAndMentions(t *testing.T) {
	core := New(nil)
	core.userID = id.UserID("@bot:example")
	content := map[string]any{
		"body":    "> <@alice:example> hi\n\nreply",
		"msgtype": "m.text",
		"m.mentions": map[string]any{
			"room":     true,
			"user_ids": []any{"@bot:example"},
		},
		"m.relates_to": map[string]any{
			"event_id":        "$thread",
			"is_falling_back": false,
			"rel_type":        "m.thread",
			"m.in_reply_to": map[string]any{
				"event_id": "$reply",
			},
		},
	}
	raw, _ := json.Marshal(content)
	evt := &event.Event{
		Content:   event.Content{Raw: content, VeryRaw: raw},
		ID:        id.EventID("$event"),
		RoomID:    id.RoomID("!room:example"),
		Sender:    id.UserID("@alice:example"),
		Timestamp: 123,
		Type:      event.EventMessage,
	}

	converted := core.convertMessageEvent(evt)
	if converted == nil {
		t.Fatal("expected message")
	}
	if converted.ThreadRootEventID == nil || *converted.ThreadRootEventID != "$thread" {
		t.Fatalf("expected thread root, got %#v", converted.ThreadRootEventID)
	}
	if converted.ReplyTo == nil || *converted.ReplyTo != "$reply" {
		t.Fatalf("expected reply target, got %#v", converted.ReplyTo)
	}
	if converted.Relation == nil || converted.Relation.Type != "m.thread" || converted.Relation.EventID != "$thread" {
		t.Fatalf("unexpected relation: %#v", converted.Relation)
	}
	if converted.Relation.ReplyTo == nil || *converted.Relation.ReplyTo != "$reply" {
		t.Fatalf("expected relation reply target, got %#v", converted.Relation)
	}
	if converted.Mentions == nil || !converted.Mentions.Room || len(converted.Mentions.UserIDs) != 1 || converted.Mentions.UserIDs[0] != "@bot:example" {
		t.Fatalf("unexpected mentions: %#v", converted.Mentions)
	}
}

func TestProcessEventSkipsDuplicateTimelineEvents(t *testing.T) {
	ctx := context.Background()
	var emitted []OutboundEvent
	core := New(func(event OutboundEvent) {
		emitted = append(emitted, event)
	})
	content := map[string]any{
		"body":    "hello",
		"msgtype": "m.text",
	}
	raw, _ := json.Marshal(content)
	evt := &event.Event{
		Content: event.Content{Raw: content, VeryRaw: raw},
		ID:      id.EventID("$event"),
		RoomID:  id.RoomID("!room:example"),
		Sender:  id.UserID("@alice:example"),
		Type:    event.EventMessage,
	}

	core.processEvent(ctx, evt)
	core.processEvent(ctx, evt)

	if len(emitted) != 1 {
		t.Fatalf("expected one emitted event, got %d", len(emitted))
	}
	message, ok := emitted[0]["event"].(*MatrixMessageEvent)
	if !ok {
		t.Fatalf("expected message event, got %#v", emitted[0]["event"])
	}
	if message.EventID != "$event" {
		t.Fatalf("unexpected event id %q", message.EventID)
	}
}

func TestFinalizeBeeperStreamMessageUsesAIBridgeFinalEditEnvelope(t *testing.T) {
	requests := make(chan map[string]any, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var content map[string]any
		if err := json.Unmarshal(body, &content); err != nil {
			t.Errorf("failed to decode request body: %v", err)
		}
		requests <- content
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"event_id":"$edit"}`))
	}))
	t.Cleanup(server.Close)

	core := New(nil)
	cli, err := mautrix.NewClient(server.URL, id.UserID("@bot:example"), "token")
	if err != nil {
		t.Fatal(err)
	}
	core.client = cli

	_, err = core.finalizeBeeperStreamMessage(context.Background(), MatrixFinalizeBeeperStreamMessageOptions{
		Content: OutboundEvent{
			"body":          "done",
			"com.beeper.ai": map[string]any{"kind": "final"},
			"msgtype":       "m.text",
		},
		EventID: "$stream",
		RoomID:  "!room:example",
		TopLevelContent: OutboundEvent{
			"custom": "value",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	replacement := <-requests
	if replacement["body"] != "done" || replacement["msgtype"] != "m.text" {
		t.Fatalf("unexpected replacement fallback content: %#v", replacement)
	}
	if replacement["com.beeper.dont_render_edited"] != true || replacement["custom"] != "value" {
		t.Fatalf("replacement missing top-level final edit markers: %#v", replacement)
	}
	if stream, ok := replacement["com.beeper.stream"]; !ok || stream != nil {
		t.Fatalf("replacement must clear top-level stream descriptor: %#v", replacement)
	}
	newContent, ok := replacement["m.new_content"].(map[string]any)
	if !ok {
		t.Fatalf("replacement missing m.new_content: %#v", replacement)
	}
	if stream, ok := newContent["com.beeper.stream"]; !ok || stream != nil {
		t.Fatalf("replacement must clear stream descriptor in m.new_content: %#v", newContent)
	}
	if ai, ok := newContent["com.beeper.ai"].(map[string]any); !ok || ai["kind"] != "final" {
		t.Fatalf("replacement lost final AI payload: %#v", newContent)
	}
	relatesTo, ok := replacement["m.relates_to"].(map[string]any)
	if !ok || relatesTo["rel_type"] != "m.replace" || relatesTo["event_id"] != "$stream" {
		t.Fatalf("replacement has unexpected relation: %#v", replacement["m.relates_to"])
	}
}

func TestProcessEncryptedEventEmitsDecryptionError(t *testing.T) {
	ctx := context.Background()
	var emitted []OutboundEvent
	core := New(func(event OutboundEvent) {
		emitted = append(emitted, event)
	})
	content := map[string]any{
		"algorithm":  "m.megolm.v1.aes-sha2",
		"ciphertext": "ciphertext",
		"device_id":  "DEVICE",
		"sender_key": "sender-key",
		"session_id": "session",
	}
	raw, _ := json.Marshal(content)
	evt := &event.Event{
		Content: event.Content{Raw: content, VeryRaw: raw},
		ID:      id.EventID("$event"),
		RoomID:  id.RoomID("!room:example"),
		Sender:  id.UserID("@alice:example"),
		Type:    event.EventEncrypted,
	}

	core.processEvent(ctx, evt)

	if len(emitted) != 1 {
		t.Fatalf("expected one emitted event, got %d", len(emitted))
	}
	if emitted[0]["type"] != "decryption_error" {
		t.Fatalf("expected decryption error, got %#v", emitted[0])
	}
	eventData, ok := emitted[0]["event"].(OutboundEvent)
	if !ok {
		t.Fatalf("expected event details, got %#v", emitted[0]["event"])
	}
	if eventData["eventId"] != "$event" || eventData["roomId"] != "!room:example" {
		t.Fatalf("unexpected event details: %#v", eventData)
	}
}

func TestConvertEditEventNormalizesReplacement(t *testing.T) {
	core := New(nil)
	content := map[string]any{
		"body":    " * edited",
		"msgtype": "m.text",
		"m.new_content": map[string]any{
			"body":    "edited",
			"msgtype": "m.text",
		},
		"m.relates_to": map[string]any{
			"event_id": "$original",
			"rel_type": "m.replace",
		},
	}
	raw, _ := json.Marshal(content)
	evt := &event.Event{
		Content:   event.Content{Raw: content, VeryRaw: raw},
		ID:        id.EventID("$edit"),
		RoomID:    id.RoomID("!room:example"),
		Sender:    id.UserID("@alice:example"),
		Timestamp: 456,
		Type:      event.EventMessage,
	}

	converted := core.convertMessageEvent(evt)
	if converted == nil {
		t.Fatal("expected edit")
	}
	if converted.EventID != "$original" {
		t.Fatalf("expected logical event id, got %q", converted.EventID)
	}
	if converted.Replaces == nil || *converted.Replaces != "$original" {
		t.Fatalf("expected replaces, got %#v", converted.Replaces)
	}
	if converted.Relation == nil || converted.Relation.Type != "m.replace" || converted.Relation.EventID != "$original" {
		t.Fatalf("unexpected relation: %#v", converted.Relation)
	}
	if !boolValue(converted.IsEdited) {
		t.Fatal("expected edited flag")
	}
}
