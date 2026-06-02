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
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

type beeperAIRunState struct {
	published        int
	run              *aistream.Run
	endedToolInputs  map[string]bool
	streamDescriptor any
	streamEventID    id.EventID
	streamRoomID     id.RoomID
	startedToolCalls map[string]bool
	toolInputs       map[string]any
	toolNames        map[string]string
	writer           *aistream.Writer
}

const beeperAIRunStreamOperationTimeout = 30 * time.Second

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

type MatrixBeeperAIRunPartOptions struct {
	ActivityType     string        `json:"activityType,omitempty"`
	Aggregated       string        `json:"aggregated,omitempty"`
	Approval         any           `json:"approval,omitempty" tstype:"unknown"`
	Command          string        `json:"command,omitempty"`
	CompletedAtMs    *int64        `json:"completedAtMs,omitempty"`
	Content          OutboundEvent `json:"content,omitempty" tstype:"{ [key: string]: unknown }"`
	Cwd              string        `json:"cwd,omitempty"`
	Description      string        `json:"description,omitempty"`
	Delta            any           `json:"delta,omitempty" tstype:"unknown"`
	Details          any           `json:"details,omitempty" tstype:"unknown"`
	Dynamic          *bool         `json:"dynamic,omitempty"`
	Error            any           `json:"error,omitempty" tstype:"unknown"`
	ExitCode         *int          `json:"exitCode,omitempty"`
	Index            *int          `json:"index,omitempty"`
	Input            any           `json:"input,omitempty" tstype:"unknown"`
	Kind             string        `json:"kind" tstype:"\"text\" | \"reasoning\" | \"reasoning_end\" | \"tool_start\" | \"tool_input\" | \"tool_end\" | \"tool_result\" | \"activity\" | \"activity_delta\" | \"state_delta\" | \"state_snapshot\" | \"raw\" | \"custom\" | string"`
	Metadata         OutboundEvent `json:"metadata,omitempty" tstype:"{ [key: string]: unknown }"`
	Name             string        `json:"name,omitempty"`
	Output           any           `json:"output,omitempty" tstype:"unknown"`
	Patch            any           `json:"patch,omitempty" tstype:"unknown"`
	Preliminary      bool          `json:"preliminary,omitempty"`
	ProviderExecuted *bool         `json:"providerExecuted,omitempty"`
	Replace          *bool         `json:"replace,omitempty"`
	Response         any           `json:"response,omitempty" tstype:"unknown"`
	Result           any           `json:"result,omitempty" tstype:"unknown"`
	Source           string        `json:"source,omitempty"`
	State            string        `json:"state,omitempty"`
	Status           string        `json:"status,omitempty"`
	StartedAtMs      *int64        `json:"startedAtMs,omitempty"`
	Stderr           string        `json:"stderr,omitempty"`
	Stdout           string        `json:"stdout,omitempty"`
	Text             string        `json:"text,omitempty"`
	Title            string        `json:"title,omitempty"`
	ToolCallID       string        `json:"toolCallId,omitempty"`
	ToolName         string        `json:"toolName,omitempty"`
	Value            any           `json:"value,omitempty" tstype:"unknown"`
}

type MatrixAppendBeeperAIRunPartOptions struct {
	MatrixBeeperAIRunPartOptions `json:",inline" tstype:",extends"`
	RunID                        string `json:"runId"`
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
	InitialEvents                 []OutboundEvent                `json:"initialEvents,omitempty" tstype:"Array<{ [key: string]: unknown }>"`
	InitialParts                  []MatrixBeeperAIRunPartOptions `json:"initialParts,omitempty"`
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
	before := len(state.run.Events)
	if err := state.appendEvent(req.Event); err != nil {
		return nil, err
	}
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
	ctx, cancel := beeperAIRunStreamContext(ctx)
	defer cancel()
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
	for _, eventData := range req.InitialEvents {
		if err := state.appendEvent(eventData); err != nil {
			delete(c.beeperAIRuns, run.RunID)
			return nil, err
		}
	}
	for _, part := range req.InitialParts {
		if err := state.appendPart(part); err != nil {
			delete(c.beeperAIRuns, run.RunID)
			return nil, err
		}
	}
	descriptor, err := c.beeperStream.NewDescriptor(ctx, id.RoomID(req.RoomID), req.StreamType)
	if err != nil {
		return nil, err
	}
	content, extra := aimatrix.AnchorContent(*run)
	clearBeeperAIWorkingFallback(content, *run)
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
	ctx, cancel := beeperAIRunStreamContext(ctx)
	defer cancel()
	var req MatrixAppendBeeperAIRunEventOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	state, err := c.requireBeeperAIRun(req.RunID)
	if err != nil {
		return nil, err
	}
	before := len(state.run.Events)
	if err := state.appendEvent(req.Event); err != nil {
		return nil, err
	}
	events := outboundEventsFromAGUI(state.run.Events[before:])
	if err := c.publishBeeperAIRunStreamPending(ctx, state); err != nil {
		return nil, err
	}
	return c.marshalBeeperAIRunStreamResult(state, events, "", nil)
}

func (c *Core) handleAppendBeeperAIRunStreamPart(ctx context.Context, payload []byte) ([]byte, error) {
	ctx, cancel := beeperAIRunStreamContext(ctx)
	defer cancel()
	var req MatrixAppendBeeperAIRunPartOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	state, err := c.requireBeeperAIRun(req.RunID)
	if err != nil {
		return nil, err
	}
	before := len(state.run.Events)
	if err := state.appendPart(req.MatrixBeeperAIRunPartOptions); err != nil {
		return nil, err
	}
	events := outboundEventsFromAGUI(state.run.Events[before:])
	if err := c.publishBeeperAIRunStreamPending(ctx, state); err != nil {
		return nil, err
	}
	return c.marshalBeeperAIRunStreamResult(state, events, "", nil)
}

func (c *Core) handleFinishBeeperAIRunStream(ctx context.Context, payload []byte) ([]byte, error) {
	ctx, cancel := beeperAIRunStreamContext(ctx)
	defer cancel()
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
	ctx, cancel := beeperAIRunStreamContext(ctx)
	defer cancel()
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
	state := &beeperAIRunState{
		endedToolInputs:  map[string]bool{},
		run:              run,
		startedToolCalls: map[string]bool{},
		toolInputs:       map[string]any{},
		toolNames:        map[string]string{},
		writer:           writer,
	}
	c.beeperAIRuns[run.RunID] = state
	return state
}

func (s *beeperAIRunState) appendEvent(eventData OutboundEvent) error {
	event := agui.NewEvent(map[string]any(copyOutboundEvent(eventData)))
	if !event.Has("timestamp") {
		event.Set("timestamp", time.Now().UnixMilli())
	}
	canonicalizeBeeperAIRunEvent(s.run, event)
	if err := agui.ValidateEvent(event); err != nil {
		return err
	}
	s.writer.Add(event)
	return nil
}

func (s *beeperAIRunState) appendPart(req MatrixBeeperAIRunPartOptions) error {
	if s == nil || s.writer == nil {
		return errors.New("Beeper AI run is not initialized")
	}
	kind := normalizeBeeperAIRunPartKind(req.Kind)
	switch kind {
	case "text", "text_delta":
		s.writer.Text(firstNonEmpty(req.Text, stringFromAny(req.Delta), stringFromAny(req.Value)))
	case "text_end":
		s.writer.TextEnd(beeperAIRunPartIndex(req))
	case "reasoning", "reasoning_delta", "thinking":
		s.writer.ReasoningDelta(beeperAIRunPartIndex(req), firstNonEmpty(req.Text, stringFromAny(req.Delta), stringFromAny(req.Value)))
	case "reasoning_end", "thinking_end":
		s.writer.ReasoningMessageEnd(beeperAIRunPartIndex(req))
	case "tool_start":
		s.ensureToolStarted(req)
	case "tool_input", "tool_input_delta":
		toolCallID, toolName := s.ensureToolStarted(req)
		input := firstNonNil(req.Input, req.Value)
		if input != nil {
			s.toolInputs[toolCallID] = input
		}
		delta := firstNonEmpty(req.Text, stringFromAny(req.Delta), beeperAIJSONString(input))
		s.writer.ToolArgs(toolCallID, delta, input)
		if toolName != "" {
			s.toolNames[toolCallID] = toolName
		}
	case "tool_end", "tool_input_complete":
		toolCallID, toolName := s.ensureToolStarted(req)
		s.endToolInput(toolCallID, toolName, firstNonNil(req.Input, s.toolInputs[toolCallID]))
	case "tool_result":
		toolCallID, toolName := s.ensureToolStarted(req)
		input := firstNonNil(req.Input, s.toolInputs[toolCallID])
		if !req.Preliminary {
			s.endToolInput(toolCallID, toolName, input)
		}
		state := req.State
		if state == "" {
			if req.Error != nil {
				state = agui.ToolResultStateError
			} else if req.Preliminary {
				state = agui.ToolResultStateStreaming
			} else {
				state = agui.ToolResultStateComplete
			}
		}
		result := firstNonNil(req.Error, req.Output, req.Value)
		if isCommandToolName(toolName) {
			result = commandToolOutput(req)
		}
		content := firstNonEmpty(req.Text, beeperAIJSONString(result))
		if content != "" {
			before := len(s.run.Events)
			s.writer.ToolResult(toolCallID, content, state)
			s.annotateToolResult(before, req)
		}
	case "activity":
		content := copyOutboundEvent(req.Content)
		if len(content) == 0 {
			content = OutboundEvent{}
			if req.Text != "" {
				content["text"] = req.Text
			}
			if req.State != "" {
				content["state"] = req.State
			}
			if req.Value != nil {
				content["value"] = req.Value
			}
		}
		s.addEvent(agui.NewEvent(map[string]any{
			"type":         agui.EventActivitySnapshot,
			"messageId":    s.run.MessageID,
			"activityType": firstNonEmpty(req.ActivityType, req.Name, "activity"),
			"content":      map[string]any(content),
			"replace":      req.Replace,
		}))
	case "activity_delta":
		s.addEvent(agui.NewEvent(map[string]any{
			"type":         agui.EventActivityDelta,
			"messageId":    s.run.MessageID,
			"activityType": firstNonEmpty(req.ActivityType, req.Name, "activity"),
			"patch":        firstNonNil(req.Patch, req.Delta, req.Value),
		}))
	case "state_delta":
		s.writer.StateDelta(firstNonNil(req.Delta, req.Value))
	case "state_snapshot":
		s.addEvent(agui.NewEvent(map[string]any{
			"type":     agui.EventStateSnapshot,
			"snapshot": req.Value,
		}))
	case "raw":
		s.addEvent(agui.NewEvent(map[string]any{
			"type":   agui.EventRaw,
			"source": req.Source,
			"event":  firstNonNil(req.Value, req.Content),
		}))
	case "custom":
		s.writer.Custom(firstNonEmpty(req.Name, "openclaw.data"), req.Value)
	case "step_start", "step":
		s.writer.StepStart(firstNonEmpty(req.Name, req.Text, "step"))
	case "step_finish", "step_end":
		s.writer.StepFinish(firstNonEmpty(req.Name, req.Text, "step"))
	default:
		return fmt.Errorf("unsupported Beeper AI run stream part kind %q", req.Kind)
	}
	return nil
}

func (s *beeperAIRunState) ensureToolStarted(req MatrixBeeperAIRunPartOptions) (string, string) {
	toolName := firstNonEmpty(req.ToolName, req.Name, "tool")
	toolCallID := firstNonEmpty(req.ToolCallID, "tool:"+toolName)
	if req.Input != nil {
		s.toolInputs[toolCallID] = req.Input
	}
	if toolName != "" {
		s.toolNames[toolCallID] = toolName
	}
	if s.startedToolCalls[toolCallID] {
		return toolCallID, firstNonEmpty(s.toolNames[toolCallID], toolName)
	}
	s.startedToolCalls[toolCallID] = true
	title := toolTitle(req)
	metadata := toolMetadata(req, title)
	s.writer.ToolStartWithMetadata(toolCallID, toolName, beeperAIRunPartIndex(req), nil, metadata)
	s.annotateToolStart(req, title)
	input := firstNonNil(req.Input, req.Value)
	if input != nil {
		s.toolInputs[toolCallID] = input
		if delta := firstNonEmpty(req.Text, stringFromAny(req.Delta), beeperAIJSONString(input)); delta != "" {
			s.writer.ToolArgs(toolCallID, delta, input)
		}
	}
	return toolCallID, toolName
}

func (s *beeperAIRunState) annotateToolStart(req MatrixBeeperAIRunPartOptions, title string) {
	if len(s.run.Events) == 0 {
		return
	}
	event := s.run.Events[len(s.run.Events)-1]
	if event.Type() != agui.EventToolCallStart {
		return
	}
	if req.Approval != nil {
		event.Set("approval", req.Approval)
	}
	if req.Dynamic != nil {
		event.Set("dynamic", *req.Dynamic)
	}
	if req.ProviderExecuted != nil {
		event.Set("providerExecuted", *req.ProviderExecuted)
	}
	if req.StartedAtMs != nil {
		event.Set("startedAtMs", *req.StartedAtMs)
	}
	if title != "" {
		event.Set("title", title)
	}
}

func (s *beeperAIRunState) annotateToolResult(before int, req MatrixBeeperAIRunPartOptions) {
	for i := before; i < len(s.run.Events); i++ {
		event := s.run.Events[i]
		if event.Type() != agui.EventToolCallResult {
			continue
		}
		if req.CompletedAtMs != nil {
			event.Set("completedAtMs", *req.CompletedAtMs)
		}
		if req.Preliminary {
			event.Set("preliminary", true)
		}
		if req.ProviderExecuted != nil {
			event.Set("providerExecuted", *req.ProviderExecuted)
		}
		if req.ToolName != "" {
			event.Set("toolName", req.ToolName)
		}
	}
}

func (s *beeperAIRunState) endToolInput(toolCallID, toolName string, input any) {
	if toolCallID == "" || s.endedToolInputs[toolCallID] {
		return
	}
	s.endedToolInputs[toolCallID] = true
	s.writer.ToolInputComplete(toolCallID, firstNonEmpty(toolName, s.toolNames[toolCallID], "tool"), input)
}

func toolTitle(req MatrixBeeperAIRunPartOptions) string {
	return firstNonEmpty(req.Title, commandFromPart(req))
}

func toolMetadata(req MatrixBeeperAIRunPartOptions, title string) map[string]any {
	metadata := map[string]any(nil)
	if len(req.Metadata) > 0 {
		metadata = map[string]any(req.Metadata)
	}
	if title == "" && req.Description == "" {
		return metadata
	}
	if metadata == nil {
		metadata = map[string]any{}
	}
	if title != "" && firstString(metadata["displayName"], "") == "" {
		metadata["displayName"] = title
	}
	if req.Description != "" && firstString(metadata["description"], "") == "" {
		metadata["description"] = req.Description
	}
	return metadata
}

func isCommandToolName(toolName string) bool {
	switch strings.ToLower(strings.TrimSpace(toolName)) {
	case "bash", "command", "exec", "shell":
		return true
	default:
		return false
	}
}

func commandToolOutput(req MatrixBeeperAIRunPartOptions) any {
	details := mapFromAny(req.Details)
	if details == nil {
		if result := mapFromAny(req.Result); result != nil {
			details = mapFromAny(result["details"])
		}
	}
	if details == nil {
		if output := mapFromAny(req.Output); output != nil {
			details = mapFromAny(output["details"])
		}
	}
	if details == nil {
		if response := mapFromAny(req.Response); response != nil {
			details = mapFromAny(response["details"])
		}
	}
	if details != nil {
		output := firstNonEmpty(
			stringFromAny(details["aggregated"]),
			stringFromAny(details["output"]),
			stringFromAny(req.Output),
			stringFromAny(req.Response),
		)
		result := stripNil(map[string]any{
			"status":     firstNonEmpty(req.Status, stringFromAny(details["status"])),
			"exitCode":   firstNonNil(req.ExitCode, intFromAny(details["exitCode"]), intFromAny(details["exit_code"])),
			"durationMs": firstNonNil(intFromAny(details["durationMs"]), intFromAny(details["duration_ms"])),
			"cwd":        firstNonEmpty(req.Cwd, stringFromAny(details["cwd"]), stringFromAny(mapFromAny(req.Input)["cwd"])),
			"command":    firstNonEmpty(req.Command, stringFromAny(details["command"]), commandFromPart(req)),
			"stdout":     firstNonEmpty(req.Stdout, stringFromAny(details["stdout"])),
			"stderr":     firstNonEmpty(req.Stderr, stringFromAny(details["stderr"])),
			"aggregated": firstNonEmpty(req.Aggregated, stringFromAny(details["aggregated"])),
			"output":     output,
		})
		if len(result) == 0 {
			return nil
		}
		return result
	}

	stdout := firstNonEmpty(req.Stdout, stringFromAny(mapFromAny(req.Result)["stdout"]), stringFromAny(mapFromAny(req.Output)["stdout"]))
	stderr := firstNonEmpty(req.Stderr, stringFromAny(mapFromAny(req.Result)["stderr"]), stringFromAny(mapFromAny(req.Output)["stderr"]))
	aggregated := firstNonEmpty(req.Aggregated, stringFromAny(mapFromAny(req.Result)["aggregated"]), stringFromAny(mapFromAny(req.Output)["aggregated"]))
	output := firstCommandText(aggregated, req.Output, req.Result, req.Response, req.Value)
	if output == "" && stdout == "" && stderr == "" {
		return nil
	}
	if req.ExitCode == nil && stdout != "" && stderr == "" {
		return stdout
	}
	if req.ExitCode == nil && stdout == "" && stderr != "" {
		return stderr
	}
	if req.ExitCode == nil && stdout == "" && stderr == "" {
		return output
	}
	return stripNil(map[string]any{
		"status":     req.Status,
		"exitCode":   req.ExitCode,
		"cwd":        firstNonEmpty(req.Cwd, stringFromAny(mapFromAny(req.Input)["cwd"])),
		"command":    commandFromPart(req),
		"stdout":     stdout,
		"stderr":     stderr,
		"aggregated": aggregated,
		"output":     output,
	})
}

func commandFromPart(req MatrixBeeperAIRunPartOptions) string {
	input := mapFromAny(req.Input)
	value := mapFromAny(req.Value)
	return firstNonEmpty(
		req.Command,
		stringFromAny(input["command"]),
		stringFromAny(input["cmd"]),
		stringFromAny(value["command"]),
		stringFromAny(value["cmd"]),
	)
}

func firstCommandText(values ...any) string {
	for _, value := range values {
		if text := commandText(value); text != "" {
			return text
		}
	}
	return ""
}

func commandText(value any) string {
	if text := stringFromAny(value); text != "" {
		return text
	}
	record := mapFromAny(value)
	if len(record) == 0 || isStatusOnlyToolOutput(record) {
		return ""
	}
	return firstNonEmpty(
		stringFromAny(record["stdout"]),
		stringFromAny(record["stderr"]),
		stringFromAny(record["aggregated"]),
		stringFromAny(record["output"]),
		stringFromAny(record["text"]),
		stringFromAny(record["content"]),
		stringFromAny(record["response"]),
	)
}

func isStatusOnlyToolOutput(record map[string]any) bool {
	if len(record) == 0 {
		return false
	}
	for key := range record {
		switch key {
		case "action", "finalUrl", "final_url", "phase", "queries", "query", "queryUnavailable", "state", "status", "url":
		default:
			return false
		}
	}
	return true
}

func (s *beeperAIRunState) addEvent(event agui.Event) {
	canonicalizeBeeperAIRunEvent(s.run, event)
	if !event.Has("timestamp") {
		event.Set("timestamp", time.Now().UnixMilli())
	}
	s.writer.Add(event)
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
	clearBeeperAIWorkingFallback(projection.Content, *state.run)
	if projection.NeedsAttachment {
		partsRef, err := c.uploadBeeperAIFinalPartsRef(ctx, *state.run, projection.Message)
		if err != nil {
			return nil, err
		}
		projection = aimatrix.ProjectFinal(*state.run, partsRef)
		clearBeeperAIWorkingFallback(projection.Content, *state.run)
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

func clearBeeperAIWorkingFallback(content *event.MessageEventContent, run aistream.Run) {
	if content == nil || strings.TrimSpace(run.Text()) != "" || strings.TrimSpace(run.Preview.Text) != "" || run.Status.State == "error" {
		return
	}
	if strings.TrimSpace(content.Body) != "Working..." {
		return
	}
	content.Body = ""
	content.FormattedBody = ""
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

func beeperAIRunStreamContext(ctx context.Context) (context.Context, context.CancelFunc) {
	if _, ok := ctx.Deadline(); ok {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, beeperAIRunStreamOperationTimeout)
}

func normalizeBeeperAIRunPartKind(kind string) string {
	kind = strings.ToLower(strings.TrimSpace(kind))
	kind = strings.ReplaceAll(kind, "-", "_")
	kind = strings.ReplaceAll(kind, ".", "_")
	return kind
}

func beeperAIRunPartIndex(req MatrixBeeperAIRunPartOptions) int {
	if req.Index == nil {
		return 0
	}
	return *req.Index
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func stringFromAny(value any) string {
	text, _ := value.(string)
	return text
}

func beeperAIJSONString(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprint(value)
	}
	return string(raw)
}

func mapFromAny(value any) map[string]any {
	switch typed := value.(type) {
	case nil:
		return nil
	case map[string]any:
		return typed
	case OutboundEvent:
		return map[string]any(typed)
	default:
		return nil
	}
}

func intFromAny(value any) *int {
	switch typed := value.(type) {
	case int:
		return &typed
	case int32:
		out := int(typed)
		return &out
	case int64:
		out := int(typed)
		return &out
	case float64:
		out := int(typed)
		return &out
	case json.Number:
		raw, err := typed.Int64()
		if err != nil {
			return nil
		}
		out := int(raw)
		return &out
	default:
		return nil
	}
}

func stripNil(input map[string]any) map[string]any {
	for key, value := range input {
		if value == nil || value == "" {
			delete(input, key)
		}
	}
	return input
}

func canonicalizeBeeperAIRunEvent(run *aistream.Run, event agui.Event) {
	if run == nil || event.Len() == 0 {
		return
	}
	switch event.Type() {
	case agui.EventRunStarted, agui.EventRunFinished, agui.EventRunError:
		event.Set("runId", run.RunID)
		event.Set("threadId", run.ThreadID)
	case agui.EventTextMessageStart, agui.EventTextMessageContent, agui.EventTextMessageChunk, agui.EventTextMessageEnd,
		agui.EventReasoningStart, agui.EventReasoningMsgStart, agui.EventReasoningMsgCont, agui.EventReasoningMsgChunk, agui.EventReasoningMsgEnd, agui.EventReasoningEnd,
		agui.EventActivitySnapshot, agui.EventActivityDelta:
		event.Set("messageId", run.MessageID)
	case agui.EventToolCallStart:
		event.Set("parentMessageId", run.MessageID)
	}
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
