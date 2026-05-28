package core

import (
	"encoding/json"
	"strings"
	"testing"

	aistream "github.com/beeper/ai-bridge/pkg/ai-stream"
)

func TestBeeperAIRunLifecycleUsesAIBridgeFinalContent(t *testing.T) {
	core := New(nil)
	beginPayload, err := json.Marshal(MatrixBeginBeeperAIRunOptions{
		AgentID:   "codex",
		AgentName: "Codex",
		Model:     "openclaw/plugin",
		RunID:     "run-1",
		ThreadID:  "thread-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	beginRaw, err := core.handleBeginBeeperAIRun(beginPayload)
	if err != nil {
		t.Fatal(err)
	}
	begin := decodeBeeperAIRunSnapshot(t, beginRaw)
	if begin.RunID != "run-1" || begin.ThreadID != "thread-1" || begin.MessageID == "" {
		t.Fatalf("unexpected begin identity: %#v", begin)
	}
	if got := eventTypes(begin.Events); strings.Join(got, ",") != "RUN_STARTED,TEXT_MESSAGE_START" {
		t.Fatalf("unexpected begin events: %#v", got)
	}
	if begin.InitialAIMessage == nil || begin.Metadata == nil {
		t.Fatalf("expected begin snapshot to include initial message and metadata: %#v", begin)
	}

	appendPayload, err := json.Marshal(MatrixAppendBeeperAIRunEventOptions{
		RunID: "run-1",
		Event: OutboundEvent{
			"delta":     "hello",
			"messageId": begin.MessageID,
			"type":      "TEXT_MESSAGE_CONTENT",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	appendRaw, err := core.handleAppendBeeperAIRunEvent(appendPayload)
	if err != nil {
		t.Fatal(err)
	}
	appendSnap := decodeBeeperAIRunSnapshot(t, appendRaw)
	if appendSnap.Body != "hello" {
		t.Fatalf("append body = %q, want hello", appendSnap.Body)
	}
	if got := eventTypes(appendSnap.Events); strings.Join(got, ",") != "TEXT_MESSAGE_CONTENT" {
		t.Fatalf("unexpected append events: %#v", got)
	}
	if _, ok := appendSnap.Events[0]["timestamp"]; !ok {
		t.Fatalf("append event missing native timestamp: %#v", appendSnap.Events[0])
	}

	finishPayload, err := json.Marshal(MatrixFinishBeeperAIRunOptions{
		FinishReason: "stop",
		RunID:        "run-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	finishRaw, err := core.handleFinishBeeperAIRun(finishPayload)
	if err != nil {
		t.Fatal(err)
	}
	finish := decodeBeeperAIRunSnapshot(t, finishRaw)
	if finish.Body != "hello" {
		t.Fatalf("finish body = %q, want hello", finish.Body)
	}
	if got := eventTypes(finish.Events); strings.Join(got, ",") != "TEXT_MESSAGE_END,MESSAGES_SNAPSHOT,RUN_FINISHED" {
		t.Fatalf("unexpected finish events: %#v", got)
	}
	finalMessage, ok := finish.FinalAIMessage.(map[string]any)
	if !ok {
		t.Fatalf("final message has unexpected shape: %#v", finish.FinalAIMessage)
	}
	parts, ok := finalMessage["parts"].([]any)
	if !ok || len(parts) != 1 {
		t.Fatalf("final message parts have unexpected shape: %#v", finalMessage["parts"])
	}
	textPart, ok := parts[0].(map[string]any)
	if !ok || textPart["type"] != "text" || textPart["content"] != "hello" {
		t.Fatalf("final text part has unexpected shape: %#v", parts[0])
	}
}

func TestBeeperAIRunErrorAbortAndDelete(t *testing.T) {
	core := New(nil)
	beginPayload, err := json.Marshal(MatrixBeginBeeperAIRunOptions{RunID: "run-error", ThreadID: "thread-error"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := core.handleBeginBeeperAIRun(beginPayload); err != nil {
		t.Fatal(err)
	}
	errorPayload, err := json.Marshal(MatrixErrorBeeperAIRunOptions{
		Message: "user stopped it",
		RunID:   "run-error",
		Type:    "abort",
	})
	if err != nil {
		t.Fatal(err)
	}
	errorRaw, err := core.handleErrorBeeperAIRun(errorPayload)
	if err != nil {
		t.Fatal(err)
	}
	errorSnap := decodeBeeperAIRunSnapshot(t, errorRaw)
	if got := eventTypes(errorSnap.Events); strings.Join(got, ",") != "MESSAGES_SNAPSHOT,RUN_ERROR" {
		t.Fatalf("unexpected error events: %#v", got)
	}
	errorEvent := errorSnap.Events[len(errorSnap.Events)-1]
	if errorEvent["type"] != "RUN_ERROR" || errorEvent["message"] != "user stopped it" {
		t.Fatalf("unexpected error event payload: %#v", errorEvent)
	}
	deletePayload, err := json.Marshal(MatrixDeleteBeeperAIRunOptions{RunID: "run-error"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := core.handleDeleteBeeperAIRun(deletePayload); err != nil {
		t.Fatal(err)
	}
	if _, err := core.handleFinishBeeperAIRun([]byte(`{"runId":"run-error"}`)); err == nil {
		t.Fatal("expected deleted run to be unavailable")
	}
}

func TestBeeperStreamCarrierContentsSplitsLargeEventsAndAdvancesSeq(t *testing.T) {
	core := New(nil)
	contents, nextSeq, err := core.beeperStreamCarrierContents("com.beeper.llm", MatrixPublishBeeperStreamMessagePartOptions{
		AgentID: "codex",
		EventID: "$stream",
		Part: OutboundEvent{
			"delta":     strings.Repeat("x", aistream.CarrierBudgetBytes*2),
			"messageId": "msg-1",
			"runId":     "run-1",
			"threadId":  "thread-1",
			"type":      "TEXT_MESSAGE_CONTENT",
		},
		TurnID: "run-1",
	}, 7)
	if err != nil {
		t.Fatal(err)
	}
	if len(contents) < 2 {
		t.Fatalf("expected large event to split into multiple carriers, got %d", len(contents))
	}
	if nextSeq != 7+len(contents) {
		t.Fatalf("next seq = %d, want %d", nextSeq, 7+len(contents))
	}
	for index, content := range contents {
		if size := aistream.JSONSize(content); size > aistream.CarrierBudgetBytes {
			t.Fatalf("carrier %d size = %d, budget %d", index, size, aistream.CarrierBudgetBytes)
		}
		envelopes, ok := content[aistream.BeeperAIStreamDeltas].([]aistream.Envelope)
		if !ok || len(envelopes) != 1 {
			t.Fatalf("carrier %d has unexpected envelope shape: %#v", index, content)
		}
		wantSeq := 7 + index
		if envelopes[0].Seq != wantSeq {
			t.Fatalf("carrier %d seq = %d, want %d", index, envelopes[0].Seq, wantSeq)
		}
	}
}

func decodeBeeperAIRunSnapshot(t *testing.T, raw []byte) MatrixBeeperAIRunSnapshot {
	t.Helper()
	var snapshot MatrixBeeperAIRunSnapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func eventTypes(events []OutboundEvent) []string {
	types := make([]string, 0, len(events))
	for _, event := range events {
		if eventType, ok := event["type"].(string); ok {
			types = append(types, eventType)
		}
	}
	return types
}
