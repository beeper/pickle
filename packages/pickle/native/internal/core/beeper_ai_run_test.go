package core

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	aistream "github.com/beeper/ai-bridge/pkg/ai-stream"
	aimatrix "github.com/beeper/ai-bridge/pkg/ai-stream/matrix"
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
	if got := eventTypes(begin.Events); strings.Join(got, ",") != "RUN_STARTED" {
		t.Fatalf("unexpected begin events: %#v", got)
	}
	if begin.InitialAIMessage == nil || begin.Metadata == nil {
		t.Fatalf("expected begin snapshot to include initial message and metadata: %#v", begin)
	}

	appendPayload, err := json.Marshal(MatrixAppendBeeperAIRunEventOptions{
		RunID: "run-1",
		Event: OutboundEvent{
			"delta": "hello",
			"type":  "TEXT_MESSAGE_CONTENT",
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
	if appendSnap.Events[0]["messageId"] != begin.MessageID {
		t.Fatalf("append event messageId = %v, want %s", appendSnap.Events[0]["messageId"], begin.MessageID)
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
	if got := eventTypes(finish.Events); strings.Join(got, ",") != "MESSAGES_SNAPSHOT,RUN_FINISHED" {
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

func TestBeeperAIRunSemanticPartsUseAIBridgeWriter(t *testing.T) {
	core := New(nil)
	state := core.beginBeeperAIRun(MatrixBeginBeeperAIRunOptions{RunID: "run-parts", ThreadID: "thread-parts"})
	providerExecuted := true
	startedAtMs := int64(123)
	completedAtMs := int64(456)
	parts := []MatrixBeeperAIRunPartOptions{
		{Kind: "text", Text: "hello"},
		{Kind: "reasoning", Text: "checking"},
		{Description: "Searches project documentation", Input: map[string]any{"query": "docs"}, Kind: "tool_start", Metadata: OutboundEvent{"source": "codex"}, ProviderExecuted: &providerExecuted, StartedAtMs: &startedAtMs, Title: "Search docs", ToolCallID: "tool-1", ToolName: "search"},
		{CompletedAtMs: &completedAtMs, Kind: "tool_result", Output: map[string]any{"ok": true}, ProviderExecuted: &providerExecuted, ToolCallID: "tool-1", ToolName: "search"},
		{Kind: "activity", ActivityType: "status", Content: OutboundEvent{"text": "Working..."}},
		{Kind: "custom", Name: "com.beeper.source", Value: map[string]any{"url": "https://example.com"}},
	}
	for _, part := range parts {
		if err := state.appendPart(part); err != nil {
			t.Fatalf("appendPart(%s): %v", part.Kind, err)
		}
	}
	types := eventTypes(outboundEventsFromAGUI(state.run.Events))
	want := []string{
		"RUN_STARTED",
		"TEXT_MESSAGE_START",
		"TEXT_MESSAGE_CONTENT",
		"REASONING_START",
		"REASONING_MESSAGE_START",
		"REASONING_MESSAGE_CONTENT",
		"TOOL_CALL_START",
		"TOOL_CALL_ARGS",
		"TOOL_CALL_END",
		"TOOL_CALL_RESULT",
		"ACTIVITY_SNAPSHOT",
		"CUSTOM",
	}
	if strings.Join(types, ",") != strings.Join(want, ",") {
		t.Fatalf("unexpected semantic event types:\n got %v\nwant %v", types, want)
	}
	events := outboundEventsFromAGUI(state.run.Events)
	start := firstEventOfType(events, "TOOL_CALL_START")
	if start["providerExecuted"] != true || fmt.Sprint(start["startedAtMs"]) != "123" || start["title"] != "Search docs" {
		t.Fatalf("tool start lost rich fields: %#v", start)
	}
	if metadata, ok := start["metadata"].(map[string]any); !ok || metadata["source"] != "codex" || metadata["description"] != "Searches project documentation" {
		t.Fatalf("tool start lost metadata: %#v", start)
	}
	result := firstEventOfType(events, "TOOL_CALL_RESULT")
	if result["providerExecuted"] != true || fmt.Sprint(result["completedAtMs"]) != "456" || result["toolName"] != "search" {
		t.Fatalf("tool result lost rich fields: %#v", result)
	}
	finalPart := firstToolPart(state.run.FinalBeeperAIMessage(0, true).Parts, "tool-1")
	if finalPart == nil {
		t.Fatalf("final message is missing tool part: %#v", state.run.FinalBeeperAIMessage(0, true).Parts)
	}
	finalMetadata, _ := finalPart["metadata"].(map[string]any)
	if finalPart["providerExecuted"] != true || fmt.Sprint(finalPart["startedAtMs"]) != "123" || fmt.Sprint(finalPart["completedAtMs"]) != "456" || finalPart["title"] != "Search docs" || finalMetadata["description"] != "Searches project documentation" {
		t.Fatalf("final tool part lost rich fields: %#v", finalPart)
	}
}

func TestBeeperAIRunCommandPartUsesCommandAsTitleAndActualOutput(t *testing.T) {
	core := New(nil)
	state := core.beginBeeperAIRun(MatrixBeginBeeperAIRunOptions{RunID: "run-command", ThreadID: "thread-command"})
	err := state.appendPart(MatrixBeeperAIRunPartOptions{
		Input: map[string]any{
			"command": `/bin/zsh -lc "date '+%Y-%m-%d %H:%M:%S %Z'"`,
			"cwd":     "/Users/batuhan/.openclaw/workspace",
		},
		Kind:       "tool_result",
		Output:     map[string]any{"status": "completed"},
		Response:   "2026-06-02 03:15:00 CEST",
		Status:     "completed",
		ToolCallID: "cmd-date",
		ToolName:   "bash",
	})
	if err != nil {
		t.Fatal(err)
	}
	events := outboundEventsFromAGUI(state.run.Events)
	start := firstEventOfType(events, "TOOL_CALL_START")
	if start["title"] != `/bin/zsh -lc "date '+%Y-%m-%d %H:%M:%S %Z'"` {
		t.Fatalf("command title not promoted: %#v", start)
	}
	metadata, ok := start["metadata"].(map[string]any)
	if !ok || metadata["displayName"] != start["title"] {
		t.Fatalf("command display metadata missing: %#v", start)
	}
	result := firstEventOfType(events, "TOOL_CALL_RESULT")
	if result["content"] != "2026-06-02 03:15:00 CEST" {
		t.Fatalf("command result should be actual output, got %#v", result)
	}
	if strings.Contains(fmt.Sprint(result["content"]), "completed") {
		t.Fatalf("command result leaked status wrapper: %#v", result)
	}
}

func TestBeeperAIEmptyStreamProjectionDoesNotExposeWorkingFallback(t *testing.T) {
	core := New(nil)
	state := core.beginBeeperAIRun(MatrixBeginBeeperAIRunOptions{RunID: "run-empty", ThreadID: "thread-empty"})

	anchorContent, _ := aimatrix.AnchorContent(*state.run)
	clearBeeperAIWorkingFallback(anchorContent, *state.run)
	if strings.Contains(anchorContent.Body, "Working") || strings.Contains(anchorContent.FormattedBody, "Working") {
		t.Fatalf("empty stream anchor leaked working fallback: %#v", anchorContent)
	}

	state.writer.Finish("stop")
	finalProjection := aimatrix.ProjectFinal(*state.run, nil)
	clearBeeperAIWorkingFallback(finalProjection.Content, *state.run)
	if strings.Contains(finalProjection.Content.Body, "Working") || strings.Contains(finalProjection.Content.FormattedBody, "Working") {
		t.Fatalf("empty final projection leaked working fallback: %#v", finalProjection.Content)
	}
}

func TestBeeperStreamCarrierContentsUsesBeeperAIPayloadAndAdvancesSeq(t *testing.T) {
	core := New(nil)
	contents, nextSeq, err := core.beeperStreamCarrierContents("com.beeper.llm", MatrixPublishBeeperStreamMessagePartOptions{
		AgentID: "codex",
		EventID: "$stream",
		Part: OutboundEvent{
			"delta":     "hello",
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
	if len(contents) != 1 {
		t.Fatalf("expected one carrier, got %d", len(contents))
	}
	if nextSeq != 7+len(contents) {
		t.Fatalf("next seq = %d, want %d", nextSeq, 7+len(contents))
	}
	for index, content := range contents {
		payload, ok := content[aistream.BeeperAIKey].(aistream.BeeperAI)
		if !ok || len(payload.Events) != 1 {
			t.Fatalf("carrier %d has unexpected payload shape: %#v", index, content)
		}
		wantSeq := 7 + index
		if payload.Events[0].Seq != wantSeq {
			t.Fatalf("carrier %d seq = %d, want %d", index, payload.Events[0].Seq, wantSeq)
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

func firstEventOfType(events []OutboundEvent, eventType string) OutboundEvent {
	for _, event := range events {
		if event["type"] == eventType {
			return event
		}
	}
	return nil
}

func firstToolPart(parts []aistream.MessagePart, toolCallID string) aistream.MessagePart {
	for _, part := range parts {
		if part["toolCallId"] == toolCallID {
			return part
		}
	}
	return nil
}
