package core

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

const (
	liveSyncFilter      = `{"room":{"timeline":{"limit":50}}}`
	noHistorySyncFilter = `{"room":{"account_data":{"limit":0},"ephemeral":{"limit":0},"state":{"limit":0},"timeline":{"limit":0}}}`
)

type MatrixSyncOnceOptions struct {
	BeeperStreaming bool `json:"beeperStreaming,omitempty"`
	TimeoutMS       int  `json:"timeoutMs,omitempty"`
}

type MatrixSyncStartOptions struct {
	BeeperStreaming bool `json:"beeperStreaming,omitempty"`
	RetryDelayMS    int  `json:"retryDelayMs,omitempty"`
	TimeoutMS       int  `json:"timeoutMs,omitempty"`
}

const (
	defaultSyncTimeoutMS = 30000
	defaultRetryDelayMS  = 1000
	maxRetryDelayMS      = 30000
)

func (c *Core) handleSyncOnce(ctx context.Context, payload []byte) ([]byte, error) {
	c.syncMu.Lock()
	defer c.syncMu.Unlock()

	var req MatrixSyncOnceOptions
	_ = json.Unmarshal(payload, &req)
	if req.TimeoutMS <= 0 {
		req.TimeoutMS = defaultSyncTimeoutMS
	}
	if err := c.syncOnce(ctx, req.TimeoutMS, req.BeeperStreaming, true); err != nil {
		return nil, err
	}
	return c.empty()
}

func (c *Core) handleStartSync(payload []byte) ([]byte, error) {
	var req MatrixSyncStartOptions
	_ = json.Unmarshal(payload, &req)
	if req.TimeoutMS <= 0 {
		req.TimeoutMS = defaultSyncTimeoutMS
	}
	if req.RetryDelayMS <= 0 {
		req.RetryDelayMS = defaultRetryDelayMS
	}

	c.syncLoopMu.Lock()
	defer c.syncLoopMu.Unlock()
	if c.syncLoopCancel != nil {
		return c.empty()
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	c.syncLoopCancel = cancel
	c.syncLoopDone = done
	go c.runSyncLoop(ctx, done, req)
	return c.empty()
}

func (c *Core) handleStopSync() ([]byte, error) {
	c.syncLoopMu.Lock()
	cancel := c.syncLoopCancel
	done := c.syncLoopDone
	c.syncLoopMu.Unlock()
	if cancel == nil {
		c.emit(OutboundEvent{"type": "sync_status", "status": "stopped"})
		return c.empty()
	}
	cancel()
	if done != nil {
		<-done
	}
	return c.empty()
}

func (c *Core) runSyncLoop(ctx context.Context, done chan struct{}, req MatrixSyncStartOptions) {
	defer func() {
		c.syncLoopMu.Lock()
		c.syncLoopCancel = nil
		c.syncLoopDone = nil
		c.syncLoopMu.Unlock()
		c.emit(OutboundEvent{"type": "sync_status", "status": "stopped"})
		close(done)
	}()

	failures := 0
	for {
		c.syncMu.Lock()
		err := c.syncOnce(ctx, req.TimeoutMS, req.BeeperStreaming, false)
		c.syncMu.Unlock()
		if err == nil {
			failures = 0
			continue
		}
		if ctx.Err() != nil {
			return
		}
		failures++
		nextRetryMS := maxRetryDelayMS
		if failures < 16 {
			nextRetryMS = req.RetryDelayMS << (failures - 1)
		}
		if nextRetryMS > maxRetryDelayMS {
			nextRetryMS = maxRetryDelayMS
		}
		c.emit(OutboundEvent{
			"type":        "sync_status",
			"status":      "retrying",
			"error":       err.Error(),
			"failures":    failures,
			"nextRetryMs": nextRetryMS,
		})
		timer := time.NewTimer(time.Duration(nextRetryMS) * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func (c *Core) syncOnce(ctx context.Context, timeoutMS int, beeperStreaming bool, emitFailure bool) error {
	started := time.Now()

	cli, err := c.requireClient()
	if err != nil {
		return err
	}
	filterID := liveSyncFilter
	skipTimelines := c.skipNextSync
	if skipTimelines {
		timeoutMS = 0
		filterID = noHistorySyncFilter
	}
	c.emit(OutboundEvent{"type": "sync_status", "status": "syncing"})
	resp, err := retryMatrix(ctx, func() (*mautrix.RespSync, error) {
		return cli.FullSyncRequest(ctx, mautrix.ReqSync{
			Timeout:         timeoutMS,
			Since:           c.nextBatch,
			FilterID:        filterID,
			FullState:       false,
			SetPresence:     event.PresenceOffline,
			BeeperStreaming: beeperStreaming,
		})
	})
	if err != nil {
		if emitFailure {
			c.emit(OutboundEvent{
				"type":       "sync_status",
				"status":     "retrying",
				"error":      err.Error(),
				"durationMs": time.Since(started).Milliseconds(),
			})
		}
		return err
	}
	since := c.nextBatch
	if skipTimelines {
		clearRoomTimelines(resp)
	}
	if err := c.processSyncResponse(ctx, resp, since); err != nil {
		return err
	}
	if !skipTimelines {
		c.retryPendingDecryptions(ctx)
	}
	c.nextBatch = resp.NextBatch
	c.skipNextSync = false
	if c.stores != nil {
		if err := c.stores.SaveNextBatch(ctx, c.nextBatch); err != nil {
			return err
		}
	}
	c.emit(OutboundEvent{"type": "sync_status", "status": "synced", "durationMs": time.Since(started).Milliseconds()})
	return nil
}

func clearRoomTimelines(resp *mautrix.RespSync) {
	if resp == nil {
		return
	}
	for roomID, room := range resp.Rooms.Join {
		room.Timeline.Events = nil
		resp.Rooms.Join[roomID] = room
	}
	for roomID, room := range resp.Rooms.Leave {
		room.Timeline.Events = nil
		resp.Rooms.Leave[roomID] = room
	}
}

type MatrixApplySyncResponseOptions struct {
	Since    string          `json:"since,omitempty"`
	Response json.RawMessage `json:"response"`
}

func (c *Core) handleApplySyncResponse(ctx context.Context, payload []byte) ([]byte, error) {
	var req MatrixApplySyncResponseOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	var resp mautrix.RespSync
	if err := json.Unmarshal(req.Response, &resp); err != nil {
		return nil, err
	}
	if err := c.processSyncResponse(ctx, &resp, req.Since); err != nil {
		return nil, err
	}
	c.retryPendingDecryptions(ctx)
	c.nextBatch = resp.NextBatch
	if c.stores != nil {
		if err := c.stores.SaveNextBatch(ctx, c.nextBatch); err != nil {
			return nil, err
		}
	}
	return c.empty()
}

func (c *Core) processSyncResponse(ctx context.Context, resp *mautrix.RespSync, since string) error {
	cli, err := c.requireClient()
	if err != nil {
		return err
	}
	c.processInvites(resp)
	c.processBeeperStreamSync(ctx, resp)
	if cli.Syncer != nil {
		return cli.Syncer.ProcessResponse(ctx, resp, since)
	}
	for roomID, room := range resp.Rooms.Join {
		for _, evt := range room.Timeline.Events {
			if evt.RoomID == "" {
				evt.RoomID = roomID
			}
			c.processEvent(ctx, evt)
		}
	}
	return nil
}

func (c *Core) processBeeperStreamSync(ctx context.Context, resp *mautrix.RespSync) {
	if c.beeperStream == nil || resp == nil {
		return
	}
	for _, evt := range c.beeperStream.HandleSyncResponse(ctx, resp) {
		c.processBeeperStreamUpdate(evt)
	}
}

func (c *Core) processBeeperStreamUpdate(evt *event.Event) {
	if evt == nil || evt.Type != event.ToDeviceBeeperStreamUpdate {
		return
	}
	update := evt.Content.AsBeeperStreamUpdate()
	raw := evt.Content.Raw
	if raw == nil && len(evt.Content.VeryRaw) > 0 {
		_ = json.Unmarshal(evt.Content.VeryRaw, &raw)
	}
	c.emit(OutboundEvent{
		"type": "beeper_stream_update",
		"event": OutboundEvent{
			"content": raw,
			"eventId": update.EventID.String(),
			"raw":     evt,
			"roomId":  update.RoomID.String(),
			"sender":  evt.Sender.String(),
		},
	})
}

func (c *Core) processInvites(resp *mautrix.RespSync) {
	if resp == nil {
		return
	}
	for roomID, room := range resp.Rooms.Invite {
		inviter := ""
		for _, evt := range room.State.Events {
			if evt == nil {
				continue
			}
			if evt.Type == event.StateMember && evt.GetStateKey() == c.userID.String() {
				inviter = evt.Sender.String()
				break
			}
		}
		c.emit(OutboundEvent{
			"type": "invite",
			"event": MatrixInviteEvent{
				Inviter: optionalString(inviter),
				Raw:     room,
				RoomID:  roomID.String(),
			},
		})
	}
}

func (c *Core) processEvent(ctx context.Context, evt *event.Event) {
	if evt == nil {
		return
	}
	switch evt.Type {
	case event.EventMessage:
		if converted := c.convertMessageEvent(evt); converted != nil {
			if !c.markTimelineEventEmitted(evt.ID) {
				return
			}
			c.emit(OutboundEvent{"type": "message", "event": converted})
		}
	case event.EventReaction:
		_ = evt.Content.ParseRaw(evt.Type)
		content := evt.Content.AsReaction()
		if content.RelatesTo.EventID == "" {
			return
		}
		if !c.markTimelineEventEmitted(evt.ID) {
			return
		}
		snapshot := reactionSnapshot{
			EventID:          evt.ID,
			Key:              content.RelatesTo.Key,
			Raw:              evt,
			RelatesToEventID: content.RelatesTo.EventID,
			RoomID:           evt.RoomID,
			Sender:           evt.Sender,
		}
		c.rememberReaction(ctx, snapshot)
		c.emitReaction(snapshot, true)
	case event.EventRedaction:
		if !c.markTimelineEventEmitted(evt.ID) {
			return
		}
		c.processRedaction(ctx, evt)
	case event.EventEncrypted:
		if converted := c.convertMaybeEncryptedMessageEvent(ctx, evt); converted != nil {
			if !c.markTimelineEventEmitted(evt.ID) {
				return
			}
			c.emit(OutboundEvent{"type": "message", "event": converted})
		}
	default:
		_ = ctx
	}
}

func (c *Core) markTimelineEventEmitted(eventID id.EventID) bool {
	if eventID == "" {
		return true
	}
	if c.emittedTimelineIDs == nil {
		c.emittedTimelineIDs = make(map[id.EventID]struct{})
	}
	if _, ok := c.emittedTimelineIDs[eventID]; ok {
		return false
	}
	c.emittedTimelineIDs[eventID] = struct{}{}
	return true
}

func (c *Core) convertMaybeEncryptedMessageEvent(ctx context.Context, evt *event.Event) *MatrixMessageEvent {
	decrypted, err := c.decryptIfNeeded(ctx, evt)
	if err != nil {
		c.rememberPendingDecryption(ctx, evt)
		eventData := OutboundEvent{}
		if evt != nil {
			eventData["eventId"] = evt.ID.String()
			eventData["roomId"] = evt.RoomID.String()
			eventData["sender"] = evt.Sender.String()
		}
		c.emit(OutboundEvent{
			"type":  "decryption_error",
			"error": err.Error(),
			"event": eventData,
		})
		return nil
	}
	if decrypted.Type != event.EventMessage {
		return nil
	}
	c.removePendingDecryption(ctx, evt.ID)
	return c.convertMessageEvent(decrypted)
}

func (c *Core) decryptIfNeeded(ctx context.Context, evt *event.Event) (*event.Event, error) {
	if evt == nil {
		return nil, errors.New("matrix event is nil")
	}
	if evt.Type != event.EventEncrypted {
		return evt, nil
	}
	if c.crypto == nil {
		return nil, errors.New("matrix E2EE is not initialized")
	}
	_ = evt.Content.ParseRaw(evt.Type)
	decrypted, err := retryMatrix(ctx, func() (*event.Event, error) {
		return c.crypto.Decrypt(ctx, evt)
	})
	if err != nil {
		return nil, err
	}
	decrypted.Mautrix.EventSource |= event.SourceDecrypted
	return decrypted, nil
}
