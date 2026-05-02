package core

import (
	"context"
	"encoding/json"
	"errors"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
)

const (
	liveSyncFilter      = `{"room":{"timeline":{"limit":50}}}`
	noHistorySyncFilter = `{"room":{"account_data":{"limit":0},"ephemeral":{"limit":0},"state":{"limit":0},"timeline":{"limit":0}}}`
)

type syncOnceReq struct {
	TimeoutMS int `json:"timeoutMs,omitempty"`
}

func (c *Core) handleSyncOnce(ctx context.Context, payload []byte) ([]byte, error) {
	c.syncMu.Lock()
	defer c.syncMu.Unlock()

	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req syncOnceReq
	_ = json.Unmarshal(payload, &req)
	if req.TimeoutMS <= 0 {
		req.TimeoutMS = 30000
	}
	timeoutMS := req.TimeoutMS
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
			BeeperStreaming: true,
		})
	})
	if err != nil {
		return nil, err
	}
	since := c.nextBatch
	if skipTimelines {
		clearRoomTimelines(resp)
	}
	if err := c.processSyncResponse(ctx, resp, since); err != nil {
		return nil, err
	}
	if !skipTimelines {
		c.retryPendingDecryptions(ctx)
	}
	c.nextBatch = resp.NextBatch
	c.skipNextSync = false
	if c.stores != nil {
		if err := c.stores.SaveNextBatch(ctx, c.nextBatch); err != nil {
			return nil, err
		}
	}
	return c.empty()
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

type applySyncReq struct {
	Since    string          `json:"since,omitempty"`
	Response json.RawMessage `json:"response"`
}

func (c *Core) handleApplySyncResponse(ctx context.Context, payload []byte) ([]byte, error) {
	var req applySyncReq
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
			"event": OutboundEvent{
				"inviter": inviter,
				"raw":     room,
				"roomId":  roomID.String(),
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
			c.emit(OutboundEvent{"type": "message", "event": converted})
		}
	case event.EventReaction:
		_ = evt.Content.ParseRaw(evt.Type)
		content := evt.Content.AsReaction()
		if content.RelatesTo.EventID == "" {
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
		if snapshot.EventID != "" {
			c.reactions[snapshot.EventID] = snapshot
		}
		c.emitReaction(snapshot, true)
	case event.EventRedaction:
		c.processRedaction(evt)
	case event.EventEncrypted:
		// CryptoHelper owns encrypted timeline events. It waits for missing room
		// keys, requests sessions, then redispatches the decrypted logical event
		// through the syncer. Handling encrypted events here would turn a
		// recoverable missing-session state into an immediate user-visible miss.
		return
	default:
		_ = ctx
	}
}

func (c *Core) convertMaybeEncryptedMessageEvent(ctx context.Context, evt *event.Event) OutboundEvent {
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
