package core

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	agui "github.com/beeper/ai-bridge/pkg/ag-ui"
	aistream "github.com/beeper/ai-bridge/pkg/ai-stream"
)

type beeperAIRunState struct {
	run    *aistream.Run
	writer *aistream.Writer
}

type MatrixBeginBeeperAIRunOptions struct {
	AgentID   string `json:"agentId,omitempty"`
	AgentName string `json:"agentName,omitempty"`
	Model     string `json:"model,omitempty"`
	RunID     string `json:"runId,omitempty"`
	ThreadID  string `json:"threadId,omitempty"`
}

type MatrixAppendBeeperAIRunEventOptions struct {
	Event OutboundEvent `json:"event" tstype:"{ [key: string]: unknown }"`
	RunID string        `json:"runId"`
}

type MatrixFinishBeeperAIRunOptions struct {
	FinishReason string     `json:"finishReason,omitempty"`
	RunID        string     `json:"runId"`
	Usage        agui.Usage `json:"usage,omitempty"`
}

type MatrixErrorBeeperAIRunOptions struct {
	Message string `json:"message,omitempty"`
	RunID   string `json:"runId"`
	Type    string `json:"type,omitempty" tstype:"\"error\" | \"abort\""`
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

func (c *Core) handleBeginBeeperAIRun(payload []byte) ([]byte, error) {
	var req MatrixBeginBeeperAIRunOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	run := aistream.NewRun(req.RunID, req.ThreadID, req.Model, req.AgentID, req.AgentName, time.Now())
	writer := aistream.NewWriter(run, time.Now)
	writer.Start()
	c.beeperAIRuns[run.RunID] = &beeperAIRunState{run: run, writer: writer}
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
	event := agui.Event(copyOutboundEvent(req.Event))
	if event["timestamp"] == nil {
		event["timestamp"] = time.Now().UnixMilli()
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
	body := run.Preview.Text
	if body == "" {
		body = run.Text()
	}
	if body == "" {
		body = "..."
	}
	return json.Marshal(MatrixBeeperAIRunSnapshot{
		Body:             body,
		Events:           events,
		InitialAIMessage: run.InitialUIMessage(),
		FinalAIMessage:   run.FinalUIMessage(0, true),
		Metadata:         run.Metadata(),
		MessageID:        run.MessageID,
		RunID:            run.RunID,
		ThreadID:         run.ThreadID,
	})
}

func outboundEventsFromAGUI(events []agui.Event) []OutboundEvent {
	out := make([]OutboundEvent, 0, len(events))
	for _, event := range events {
		out = append(out, OutboundEvent(event))
	}
	return out
}
