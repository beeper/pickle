package core

import (
	"context"
	"encoding/json"
	"testing"

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
