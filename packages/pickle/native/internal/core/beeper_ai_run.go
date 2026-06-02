package core

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	agui "github.com/beeper/ai-bridge/pkg/ag-ui"
	aistream "github.com/beeper/ai-bridge/pkg/ai-stream"
	aimatrix "github.com/beeper/ai-bridge/pkg/ai-stream/matrix"
	"maunium.net/go/mautrix/id"
)

type beeperAIRunState struct {
	published        int
	run              *aistream.Run
	streamDescriptor any
	streamEventID    id.EventID
	streamRoomID     id.RoomID
	writer           *aistream.Writer
}

type MatrixBeginBeeperAIRunOptions struct {
	AgentID   string        `json:"agentId,omitempty"`
	AgentName string        `json:"agentName,omitempty"`
	Data      OutboundEvent `json:"data,omitempty" tstype:"{ [key: string]: unknown }"`
	MessageID string        `json:"messageId,omitempty"`
	Model     string        `json:"model,omitempty"`
	RunID     string        `json:"runId,omitempty"`
	ThreadID  string        `json:"threadId,omitempty"`
}

type MatrixAppendBeeperAIRunEventOptions struct {
	Event OutboundEvent `json:"event" tstype:"{ [key: string]: unknown }"`
	RunID string        `json:"runId"`
}

type MatrixFinishBeeperAIRunOptions struct {
	FinishReason string        `json:"finishReason,omitempty"`
	RunID        string        `json:"runId"`
	Terminal     OutboundEvent `json:"terminal,omitempty" tstype:"{ [key: string]: unknown }"`
	Usage        agui.Usage    `json:"usage,omitempty"`
}

type MatrixErrorBeeperAIRunOptions struct {
	Message  string        `json:"message,omitempty"`
	RunID    string        `json:"runId"`
	Terminal OutboundEvent `json:"terminal,omitempty" tstype:"{ [key: string]: unknown }"`
	Type     string        `json:"type,omitempty" tstype:"\"error\" | \"abort\""`
}

type MatrixDeleteBeeperAIRunOptions struct {
	RunID string `json:"runId"`
}

type MatrixBeeperAIRunSnapshot struct {
	Body             string          `json:"body"`
	Events           []OutboundEvent `json:"events" tstype:"Array<{ [key: string]: unknown }>"`
	InitialAIMessage any             `json:"initialAIMessage" tstype:"{ [key: string]: unknown }"`
	FinalAIMessage   any             `json:"finalAIMessage" tstype:"{ [key: string]: unknown }"`
	Metadata         any             `json:"metadata" tstype:"{ [key: string]: unknown }"`
	MessageID        string          `json:"messageId"`
	RunID            string          `json:"runId"`
	ThreadID         string          `json:"threadId"`
}

type MatrixStartBeeperAIRunStreamOptions struct {
	MatrixBeginBeeperAIRunOptions `json:",inline" tstype:",extends"`
	RoomID                        string                         `json:"roomId"`
	StreamType                    string                         `json:"streamType,omitempty"`
	Subscribers                   []MatrixBeeperStreamSubscriber `json:"subscribers,omitempty"`
	ThreadRootEventID             string                         `json:"threadRootEventId,omitempty"`
	UserID                        string                         `json:"userId,omitempty"`
}

type MatrixBeeperAIRunStreamResult struct {
	MatrixBeeperAIRunSnapshot `json:",inline" tstype:",extends"`
	Descriptor                any    `json:"descriptor,omitempty" tstype:"{ [key: string]: unknown }"`
	EventID                   string `json:"eventId"`
	Raw                       any    `json:"raw,omitempty"`
	ReplacementEventID        string `json:"replacementEventId,omitempty"`
	RoomID                    string `json:"roomId"`
}

func (c *Core) handleBeginBeeperAIRun(payload []byte) ([]byte, error) {
	var req MatrixBeginBeeperAIRunOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	state := c.beginBeeperAIRun(req)
	run := state.run
	return c.marshalBeeperAIRunSnapshot(run, outboundEventsFromAGUI(run.Events))
}

func (c *Core) handleAppendBeeperAIRunEvent(payload []byte) ([]byte, error) {
	var req MatrixAppendBeeperAIRunEventOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	state, err := c.requireBeeperAIRun(req.RunID)
	if err != nil {
		return nil, err
	}
	event := agui.NewEvent(map[string]any(copyOutboundEvent(req.Event)))
	if !event.Has("timestamp") {
		event.Set("timestamp", time.Now().UnixMilli())
	}
	if err := agui.ValidateEvent(event); err != nil {
		return nil, err
	}
	before := len(state.run.Events)
	state.writer.Add(event)
	return c.marshalBeeperAIRunSnapshot(state.run, outboundEventsFromAGUI(state.run.Events[before:]))
}

func (c *Core) handleFinishBeeperAIRun(payload []byte) ([]byte, error) {
	var req MatrixFinishBeeperAIRunOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	state, err := c.requireBeeperAIRun(req.RunID)
	if err != nil {
		return nil, err
	}
	before := len(state.run.Events)
	if req.Usage.PromptTokens != 0 || req.Usage.CompletionTokens != 0 || req.Usage.ReasoningTokens != 0 || req.Usage.TotalTokens != 0 {
		usage := req.Usage
		state.writer.FinishWithUsage(req.FinishReason, &usage)
	} else {
		state.writer.Finish(req.FinishReason)
	}
	return c.marshalBeeperAIRunSnapshot(state.run, outboundEventsFromAGUI(state.run.Events[before:]))
}

func (c *Core) handleErrorBeeperAIRun(payload []byte) ([]byte, error) {
	var req MatrixErrorBeeperAIRunOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	state, err := c.requireBeeperAIRun(req.RunID)
	if err != nil {
		return nil, err
	}
	before := len(state.run.Events)
	message := strings.TrimSpace(req.Message)
	if message == "" {
		message = "run failed"
	}
	if req.Type == "abort" {
		state.writer.Abort(message)
	} else {
		state.writer.Error(message)
	}
	if state.run.Preview.Text == "" {
		state.run.Preview = aistream.PreviewFromText(message, aistream.PreviewBudgetBytes)
	}
	return c.marshalBeeperAIRunSnapshot(state.run, outboundEventsFromAGUI(state.run.Events[before:]))
}

func (c *Core) handleDeleteBeeperAIRun(payload []byte) ([]byte, error) {
	var req MatrixDeleteBeeperAIRunOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	delete(c.beeperAIRuns, req.RunID)
	return c.empty()
}

func (c *Core) handleStartBeeperAIRunStream(ctx context.Context, payload []byte) ([]byte, error) {
	if c.beeperStream == nil {
		return nil, errors.New("beeper stream helper is not initialized")
	}
	var req MatrixStartBeeperAIRunStreamOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.RoomID == "" {
		return nil, errors.New("missing beeper AI run stream room ID")
	}
	if req.StreamType == "" {
		req.StreamType = "com.beeper.llm"
	}
	state := c.beginBeeperAIRun(req.MatrixBeginBeeperAIRunOptions)
	run := state.run
	descriptor, err := c.beeperStream.NewDescriptor(ctx, id.RoomID(req.RoomID), req.StreamType)
	if err != nil {
		return nil, err
	}
	content, extra := aimatrix.AnchorContent(*run)
	contentMap := messageContentMap(content, OutboundEvent(extra))
	if len(req.Subscribers) > 0 {
		contentMap["com.beeper.stream"] = descriptor
	} else {
		contentMap["com.beeper.stream"] = map[string]any{
			"type": req.StreamType,
		}
	}
	resp, err := c.sendBeeperStreamMessageEvent(ctx, req.RoomID, req.ThreadRootEventID, req.UserID, contentMap)
	if err != nil {
		delete(c.beeperAIRuns, run.RunID)
		return nil, err
	}
	eventID := id.EventID(resp.EventID.String())
	if err = c.beeperStream.Register(ctx, id.RoomID(req.RoomID), eventID, descriptor); err != nil {
		delete(c.beeperAIRuns, run.RunID)
		return nil, err
	}
	c.beeperStreamMessages[eventID] = &beeperStreamMessage{
		descriptor: descriptor.Clone(),
		direct:     len(req.Subscribers) > 0,
		nextSeq:    1,
		roomID:     id.RoomID(req.RoomID),
		userID:     req.UserID,
	}
	state.streamEventID = eventID
	state.streamRoomID = id.RoomID(req.RoomID)
	state.streamDescriptor = descriptor.Clone()
	c.addBeeperStreamSubscribers(ctx, id.RoomID(req.RoomID), eventID, req.Subscribers)
	events := outboundEventsFromAGUI(run.Events)
	if err = c.publishBeeperAIRunStreamPending(ctx, state); err != nil {
		delete(c.beeperAIRuns, run.RunID)
		delete(c.beeperStreamMessages, eventID)
		c.beeperStream.Unregister(id.RoomID(req.RoomID), eventID)
		c.beeperStream.Unsubscribe(id.RoomID(req.RoomID), eventID)
		return nil, err
	}
	return c.marshalBeeperAIRunStreamResult(state, events, "", nil)
}

func (c *Core) handleAppendBeeperAIRunStreamEvent(ctx context.Context, payload []byte) ([]byte, error) {
	var req MatrixAppendBeeperAIRunEventOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	state, err := c.requireBeeperAIRun(req.RunID)
	if err != nil {
		return nil, err
	}
	event := agui.NewEvent(map[string]any(copyOutboundEvent(req.Event)))
	if !event.Has("timestamp") {
		event.Set("timestamp", time.Now().UnixMilli())
	}
	if err := agui.ValidateEvent(event); err != nil {
		return nil, err
	}
	before := len(state.run.Events)
	state.writer.Add(event)
	events := outboundEventsFromAGUI(state.run.Events[before:])
	if err := c.publishBeeperAIRunStreamPending(ctx, state); err != nil {
		return nil, err
	}
	return c.marshalBeeperAIRunStreamResult(state, events, "", nil)
}

func (c *Core) handleFinishBeeperAIRunStream(ctx context.Context, payload []byte) ([]byte, error) {
	var req MatrixFinishBeeperAIRunOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	state, err := c.requireBeeperAIRun(req.RunID)
	if err != nil {
		return nil, err
	}
	before := len(state.run.Events)
	if req.Usage.PromptTokens != 0 || req.Usage.CompletionTokens != 0 || req.Usage.ReasoningTokens != 0 || req.Usage.TotalTokens != 0 {
		usage := req.Usage
		state.writer.FinishWithUsage(req.FinishReason, &usage)
	} else {
		state.writer.Finish(req.FinishReason)
	}
	events := outboundEventsFromAGUI(state.run.Events[before:])
	if err := c.publishBeeperAIRunStreamPending(ctx, state); err != nil {
		return nil, err
	}
	return c.finalizeBeeperAIRunStream(ctx, state, events)
}

func (c *Core) handleErrorBeeperAIRunStream(ctx context.Context, payload []byte) ([]byte, error) {
	var req MatrixErrorBeeperAIRunOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	state, err := c.requireBeeperAIRun(req.RunID)
	if err != nil {
		return nil, err
	}
	before := len(state.run.Events)
	message := strings.TrimSpace(req.Message)
	if message == "" {
		message = "run failed"
	}
	if req.Type == "abort" {
		state.writer.Abort(message)
	} else {
		state.writer.Error(message)
	}
	if state.run.Preview.Text == "" {
		state.run.Preview = aistream.PreviewFromText(message, aistream.PreviewBudgetBytes)
	}
	events := outboundEventsFromAGUI(state.run.Events[before:])
	if err := c.publishBeeperAIRunStreamPending(ctx, state); err != nil {
		return nil, err
	}
	return c.finalizeBeeperAIRunStream(ctx, state, events)
}

func (c *Core) beginBeeperAIRun(req MatrixBeginBeeperAIRunOptions) *beeperAIRunState {
	run := aistream.NewRun(req.RunID, req.ThreadID, req.Model, req.AgentID, req.AgentName, time.Now())
	if strings.TrimSpace(req.MessageID) != "" {
		run.MessageID = strings.TrimSpace(req.MessageID)
	}
	if len(req.Data) > 0 {
		run.Data = map[string]any(req.Data)
	}
	writer := aistream.NewWriter(run, time.Now)
	writer.Start()
	state := &beeperAIRunState{run: run, writer: writer}
	c.beeperAIRuns[run.RunID] = state
	return state
}

func (c *Core) publishBeeperAIRunStreamPending(ctx context.Context, state *beeperAIRunState) error {
	if state == nil || state.streamEventID == "" {
		return errors.New("Beeper AI run is not attached to a stream message")
	}
	stream := c.beeperStreamMessages[state.streamEventID]
	if stream == nil {
		return fmt.Errorf("beeper stream message %s is not registered", state.streamEventID)
	}
	if state.published >= len(state.run.Events) {
		return nil
	}
	partial := *state.run
	partial.Events = append([]agui.Event(nil), state.run.Events[state.published:]...)
	carriers, err := aistream.PackRunFromSeq(partial, stream.nextSeq)
	if err != nil {
		return err
	}
	contents := make([]map[string]any, 0, len(carriers))
	for _, carrier := range carriers {
		contents = append(contents, aistream.CarrierContent(partial, carrier.Envelopes))
	}
	if err := c.publishBeeperStreamCarrierContents(ctx, state.streamEventID, stream, contents); err != nil {
		return err
	}
	stream.nextSeq = aistream.NextSeq(carriers)
	state.published = len(state.run.Events)
	return nil
}

func (c *Core) finalizeBeeperAIRunStream(ctx context.Context, state *beeperAIRunState, events []OutboundEvent) ([]byte, error) {
	if state == nil || state.streamEventID == "" {
		return nil, errors.New("Beeper AI run is not attached to a stream message")
	}
	stream := c.beeperStreamMessages[state.streamEventID]
	if stream == nil {
		return nil, fmt.Errorf("beeper stream message %s is not registered", state.streamEventID)
	}
	projection := aimatrix.ProjectFinal(*state.run, nil)
	if projection.NeedsAttachment {
		partsRef, err := c.uploadBeeperAIFinalPartsRef(ctx, *state.run, projection.Message)
		if err != nil {
			return nil, err
		}
		projection = aimatrix.ProjectFinal(*state.run, partsRef)
	}
	contentMap := messageContentMap(projection.Content, OutboundEvent(projection.Extra))
	result, err := c.finalizeBeeperStreamMessage(ctx, MatrixFinalizeBeeperStreamMessageOptions{
		Body:            projection.Content.Body,
		Content:         contentMap,
		EventID:         state.streamEventID.String(),
		RoomID:          stream.roomID.String(),
		TopLevelContent: OutboundEvent{"com.beeper.dont_render_edited": true},
		UserID:          stream.userID,
	})
	if err != nil {
		return nil, err
	}
	delete(c.beeperAIRuns, state.run.RunID)
	return c.marshalBeeperAIRunStreamResult(state, events, result.ReplacementEventID, result.Raw)
}

func (c *Core) uploadBeeperAIFinalPartsRef(ctx context.Context, run aistream.Run, message aistream.UIMessage) (*aistream.FinalPartsRef, error) {
	payload, err := json.Marshal(run.FinalPartsPayload(message))
	if err != nil {
		return nil, fmt.Errorf("failed to encode Beeper AI final parts: %w", err)
	}
	raw, err := c.uploadEncryptedMedia(ctx, MatrixUploadMediaOptions{
		ContentType: aistream.FinalPartsMediaType,
		Filename:    fmt.Sprintf("ai-final-parts-%s.json", run.RunID),
	}, payload)
	if err != nil {
		return nil, fmt.Errorf("failed to upload Beeper AI final parts: %w", err)
	}
	var uploaded MatrixUploadEncryptedMediaResult
	if err := json.Unmarshal(raw, &uploaded); err != nil {
		return nil, err
	}
	hash := sha256.Sum256(payload)
	return &aistream.FinalPartsRef{
		Schema:     aistream.FinalPartsRefSchema,
		MediaType:  aistream.FinalPartsMediaType,
		File:       uploaded.File,
		ByteSize:   len(payload),
		SHA256:     base64.RawURLEncoding.EncodeToString(hash[:]),
		PartsCount: len(message.Parts),
	}, nil
}

func (c *Core) requireBeeperAIRun(runID string) (*beeperAIRunState, error) {
	if strings.TrimSpace(runID) == "" {
		return nil, errors.New("missing Beeper AI run ID")
	}
	state := c.beeperAIRuns[runID]
	if state == nil {
		return nil, errors.New("Beeper AI run is not registered")
	}
	return state, nil
}

func (c *Core) marshalBeeperAIRunSnapshot(run *aistream.Run, events []OutboundEvent) ([]byte, error) {
	return json.Marshal(c.beeperAIRunSnapshot(run, events))
}

func (c *Core) marshalBeeperAIRunStreamResult(state *beeperAIRunState, events []OutboundEvent, replacementEventID string, raw any) ([]byte, error) {
	return json.Marshal(MatrixBeeperAIRunStreamResult{
		MatrixBeeperAIRunSnapshot: c.beeperAIRunSnapshot(state.run, events),
		Descriptor:                state.streamDescriptor,
		EventID:                   state.streamEventID.String(),
		Raw:                       raw,
		ReplacementEventID:        replacementEventID,
		RoomID:                    state.streamRoomID.String(),
	})
}

func (c *Core) beeperAIRunSnapshot(run *aistream.Run, events []OutboundEvent) MatrixBeeperAIRunSnapshot {
	body := run.Preview.Text
	if body == "" {
		body = run.Text()
	}
	if body == "" {
		body = "..."
	}
	return MatrixBeeperAIRunSnapshot{
		Body:             body,
		Events:           events,
		InitialAIMessage: run.InitialBeeperAIMessage(),
		FinalAIMessage:   run.FinalBeeperAIMessage(0, true),
		Metadata:         run.AI(aistream.AIKindStream),
		MessageID:        run.MessageID,
		RunID:            run.RunID,
		ThreadID:         run.ThreadID,
	}
}

func outboundEventsFromAGUI(events []agui.Event) []OutboundEvent {
	out := make([]OutboundEvent, 0, len(events))
	for _, event := range events {
		out = append(out, OutboundEvent(event.Map()))
	}
	return out
}
