package core

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/crypto"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

const (
	liveSyncFilter      = `{"room":{"timeline":{"limit":50}}}`
	noHistorySyncFilter = `{"room":{"account_data":{"limit":0},"ephemeral":{"limit":0},"state":{"limit":0},"timeline":{"limit":0}}}`
)

type MatrixSyncOnceOptions struct {
	BeeperStreaming bool `json:"beeperStreaming,omitempty"`
	ReplayMissed    bool `json:"replayMissed,omitempty"`
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
	if err := c.syncOnce(ctx, req.TimeoutMS, req.BeeperStreaming, true, req.ReplayMissed); err != nil {
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
		err := c.syncOnce(ctx, req.TimeoutMS, req.BeeperStreaming, false, false)
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

func (c *Core) syncOnce(
	ctx context.Context,
	timeoutMS int,
	beeperStreaming bool,
	emitFailure bool,
	replayMissed bool,
) error {
	started := time.Now()

	cli, err := c.requireClient()
	if err != nil {
		return err
	}
	filterID := liveSyncFilter
	skipTimelines := c.skipNextSync && !replayMissed
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
	if req.Since != "" && c.nextBatch != "" && req.Since != c.nextBatch {
		c.emit(OutboundEvent{
			"type":       "sync_status",
			"status":     "skipped",
			"since":      req.Since,
			"nextBatch":  c.nextBatch,
			"remoteNext": resp.NextBatch,
		})
		return c.empty()
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
	c.processSyncMetadata(resp, since)
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

func (c *Core) processSyncMetadata(resp *mautrix.RespSync, since string) {
	if resp == nil {
		return
	}
	for _, evt := range resp.AccountData.Events {
		c.emitSyncEvent("account_data", "accountData", "", evt, since, resp.NextBatch)
	}
	for _, evt := range resp.Presence.Events {
		c.emitSyncEvent("presence", "presence", "", evt, since, resp.NextBatch)
	}
	for _, evt := range resp.ToDevice.Events {
		c.emitSyncEvent("to_device", "toDevice", "", evt, since, resp.NextBatch)
	}
	if len(resp.DeviceLists.Changed) > 0 || len(resp.DeviceLists.Left) > 0 {
		c.emitDeviceListEvent(resp.DeviceLists, since, resp.NextBatch)
	}
	for roomID, room := range resp.Rooms.Invite {
		for _, evt := range room.State.Events {
			c.emitClassifiedRoomEvent("invite_state", roomID, evt, since, resp.NextBatch)
		}
	}
	for roomID, room := range resp.Rooms.Knock {
		for _, evt := range room.State.Events {
			c.emitClassifiedRoomEvent("knock_state", roomID, evt, since, resp.NextBatch)
		}
	}
	for roomID, room := range resp.Rooms.Join {
		for _, evt := range room.State.Events {
			c.emitClassifiedRoomEvent("room_state", roomID, evt, since, resp.NextBatch)
		}
		if room.StateAfter != nil {
			for _, evt := range room.StateAfter.Events {
				c.emitClassifiedRoomEvent("room_state_after", roomID, evt, since, resp.NextBatch)
			}
		}
		for _, evt := range room.Timeline.Events {
			c.emitSyncEvent("room_timeline", "raw", roomID, evt, since, resp.NextBatch)
		}
		for _, evt := range room.Ephemeral.Events {
			class := "ephemeral"
			if evt != nil {
				switch evt.Type {
				case event.EphemeralEventReceipt:
					class = "receipt"
				case event.EphemeralEventTyping:
					class = "typing"
				}
			}
			c.emitSyncEvent("room_ephemeral", class, roomID, evt, since, resp.NextBatch)
		}
		for _, evt := range room.AccountData.Events {
			c.emitSyncEvent("room_account_data", "accountData", roomID, evt, since, resp.NextBatch)
		}
	}
	for roomID, room := range resp.Rooms.Leave {
		for _, evt := range room.State.Events {
			c.emitClassifiedRoomEvent("left_room_state", roomID, evt, since, resp.NextBatch)
		}
		for _, evt := range room.Timeline.Events {
			c.emitClassifiedRoomEvent("left_room_timeline", roomID, evt, since, resp.NextBatch)
		}
	}
}

func (c *Core) emitClassifiedRoomEvent(section string, roomID id.RoomID, evt *event.Event, since string, nextBatch string) {
	class := "state"
	if evt != nil {
		switch evt.Type {
		case event.StateMember:
			class = "membership"
		case event.EventRedaction:
			class = "redaction"
		}
	}
	c.emitSyncEvent(section, class, roomID, evt, since, nextBatch)
}

func (c *Core) emitSyncEvent(section string, class string, roomID id.RoomID, evt *event.Event, since string, nextBatch string) {
	if evt == nil {
		return
	}
	if roomID != "" && evt.RoomID == "" {
		evt.RoomID = roomID
	}
	syncEvent := c.toMatrixSyncEvent(section, class, evt, nextBatch)
	c.emit(OutboundEvent{
		"type":      "raw_event",
		"event":     syncEvent,
		"since":     since,
		"nextBatch": nextBatch,
	})
	switch class {
	case "accountData":
		c.emit(OutboundEvent{"type": "account_data", "event": syncEvent})
	case "toDevice":
		c.emit(OutboundEvent{"type": "to_device", "event": syncEvent})
	case "receipt":
		c.emit(OutboundEvent{"type": "receipt", "event": syncEvent})
	case "typing":
		c.emit(OutboundEvent{"type": "typing", "event": syncEvent})
	case "presence":
		c.emit(OutboundEvent{"type": "presence", "event": syncEvent})
	case "ephemeral":
		c.emit(OutboundEvent{"type": "ephemeral", "event": syncEvent})
	case "membership":
		c.emit(OutboundEvent{"type": "membership", "event": syncEvent})
	case "redaction":
		c.emit(OutboundEvent{"type": "redaction", "event": syncEvent})
	case "state":
		c.emit(OutboundEvent{"type": "room_state", "event": syncEvent})
	}
}

func (c *Core) emitDeviceListEvent(lists mautrix.DeviceLists, since string, nextBatch string) {
	changed := make([]string, 0, len(lists.Changed))
	for _, userID := range lists.Changed {
		changed = append(changed, userID.String())
	}
	left := make([]string, 0, len(lists.Left))
	for _, userID := range lists.Left {
		left = append(left, userID.String())
	}
	content := map[string]any{
		"changed": changed,
		"left":    left,
	}
	syncEvent := MatrixSyncEvent{
		Class:     "deviceList",
		Content:   content,
		NextBatch: optionalString(nextBatch),
		Raw:       lists,
		Section:   "device_lists",
		Type:      "m.device_list",
	}
	c.emit(OutboundEvent{
		"type":      "raw_event",
		"event":     syncEvent,
		"since":     since,
		"nextBatch": nextBatch,
	})
	c.emit(OutboundEvent{"type": "device_list", "event": syncEvent})
}

func (c *Core) toMatrixSyncEvent(section string, class string, evt *event.Event, nextBatch string) MatrixSyncEvent {
	content := evt.Content.Raw
	if content == nil && len(evt.Content.VeryRaw) > 0 {
		_ = json.Unmarshal(evt.Content.VeryRaw, &content)
	}
	if content == nil {
		content = map[string]any{}
	}
	eventID := optionalString(evt.ID.String())
	roomID := optionalString(evt.RoomID.String())
	sender := optionalString(evt.Sender.String())
	stateKey := optionalString(evt.GetStateKey())
	var originServerTS *int64
	if evt.Timestamp != 0 {
		originServerTS = &evt.Timestamp
	}
	encrypted := evt.Type == event.EventEncrypted
	decrypted := encrypted && evt.Content.Raw["msgtype"] != nil
	return MatrixSyncEvent{
		Class:          class,
		Content:        content,
		Decrypted:      optionalBool(decrypted),
		Encrypted:      optionalBool(encrypted),
		EventID:        eventID,
		NextBatch:      optionalString(nextBatch),
		OriginServerTS: originServerTS,
		Raw:            evt,
		RoomID:         roomID,
		Section:        section,
		Sender:         sender,
		StateKey:       stateKey,
		Type:           evt.Type.Type,
	}
}

func (c *Core) processBeeperStreamSync(ctx context.Context, resp *mautrix.RespSync) {
	if c.beeperStream == nil || resp == nil {
		return
	}
	toDeviceCount := len(resp.ToDevice.Events)
	subscribeCount := 0
	updateCount := 0
	for _, evt := range resp.ToDevice.Events {
		if evt == nil {
			continue
		}
		switch evt.Type.Type {
		case event.ToDeviceBeeperStreamSubscribe.Type:
			subscribeCount++
		case event.ToDeviceBeeperStreamUpdate.Type, event.ToDeviceEncrypted.Type:
			updateCount++
		}
	}
	updates := c.beeperStream.HandleSyncResponse(ctx, resp)
	if c.client != nil && (toDeviceCount > 0 || len(updates) > 0) {
		c.client.Log.Debug().
			Int("to_device_events", toDeviceCount).
			Int("stream_subscribe_events", subscribeCount).
			Int("stream_update_events", updateCount).
			Int("normalized_stream_updates", len(updates)).
			Str("user_id", c.client.UserID.String()).
			Str("device_id", c.client.DeviceID.String()).
			Msg("Processed beeper stream sync")
	}
	for _, evt := range updates {
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
	if c.client != nil {
		trace := beeperStreamUpdateTrace(raw)
		c.client.Log.Debug().
			Int("delta_count", trace.DeltaCount).
			Interface("first_seq", trace.FirstSeq).
			Str("first_part_type", trace.FirstPartType).
			Str("first_turn_id", trace.FirstTurnID).
			Stringer("room_id", update.RoomID).
			Stringer("event_id", update.EventID).
			Stringer("sender", evt.Sender).
			Msg("Emitting beeper stream update")
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
		if restored := c.restoreEventFromBackup(ctx, evt); restored != nil {
			c.removePendingDecryption(ctx, evt.ID)
			return c.convertMessageEvent(restored)
		}
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

func (c *Core) restoreEventFromBackup(ctx context.Context, evt *event.Event) *event.Event {
	if evt == nil || evt.Type != event.EventEncrypted || c.crypto == nil || c.backupKey == nil {
		return nil
	}
	_ = evt.Content.ParseRaw(evt.Type)
	content := evt.Content.AsEncrypted()
	minIndex, _ := crypto.ParseMegolmMessageIndex(content.MegolmCiphertext)
	pending := &pendingDecryption{
		AddedAt:   time.Now().UnixMilli(),
		EventID:   evt.ID.String(),
		MinIndex:  minIndex,
		RoomID:    evt.RoomID.String(),
		Sender:    evt.Sender.String(),
		DeviceID:  content.DeviceID.String(),
		SenderKey: content.SenderKey.String(),
		SessionID: content.SessionID.String(),
	}
	if restored, _ := c.restorePendingFromBackup(ctx, pending); !restored {
		return nil
	}
	decrypted, err := c.decryptIfNeeded(ctx, evt)
	if err != nil {
		return nil
	}
	return decrypted
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
