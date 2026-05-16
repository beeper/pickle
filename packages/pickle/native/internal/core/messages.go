package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"time"

	"maunium.net/go/mautrix"
	mautrixbeeperstream "maunium.net/go/mautrix/beeperstream"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

type MatrixSendMessageOptions struct {
	RoomID            string          `json:"roomId"`
	Body              string          `json:"body"`
	Content           OutboundEvent   `json:"content,omitempty" tstype:"{ [key: string]: unknown }"`
	FormattedBody     string          `json:"formattedBody,omitempty"`
	Mentions          *MatrixMentions `json:"mentions,omitempty"`
	MsgType           string          `json:"msgtype,omitempty" tstype:"\"m.text\" | \"m.notice\" | \"m.emote\""`
	ThreadRootEventID string          `json:"threadRootEventId,omitempty"`
	ReplyToEventID    string          `json:"replyToEventId,omitempty"`
}

type MatrixMentions struct {
	Room    bool     `json:"room,omitempty"`
	UserIDs []string `json:"userIds,omitempty"`
}

type MatrixRawMessage struct {
	EventID string `json:"eventId"`
	RoomID  string `json:"roomId"`
	Raw     any    `json:"raw"`
}

type MatrixCreateBeeperStreamResult struct {
	Descriptor any `json:"descriptor" tstype:"{ [key: string]: unknown }"`
}

func (c *Core) handlePostMessage(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixSendMessageOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	content := messageContent(req.Body, req.FormattedBody, req.MsgType, req.Mentions)
	contentMap := messageContentMap(content, req.Content)
	if req.ThreadRootEventID != "" {
		content.RelatesTo = (&event.RelatesTo{}).SetThread(id.EventID(req.ThreadRootEventID), "")
		contentMap["m.relates_to"] = content.RelatesTo
	} else if req.ReplyToEventID != "" {
		content.RelatesTo = (&event.RelatesTo{}).SetReplyTo(id.EventID(req.ReplyToEventID))
		contentMap["m.relates_to"] = content.RelatesTo
	}
	resp, err := retryMatrix(ctx, func() (*mautrix.RespSendEvent, error) {
		if err := c.prepareOutboundMegolm(ctx, cli, id.RoomID(req.RoomID)); err != nil {
			return nil, err
		}
		return cli.SendMessageEvent(ctx, id.RoomID(req.RoomID), event.EventMessage, contentMap)
	})
	if err != nil {
		return nil, err
	}
	return json.Marshal(MatrixRawMessage{EventID: resp.EventID.String(), RoomID: req.RoomID, Raw: resp})
}

type MatrixCreateBeeperStreamOptions struct {
	RoomID     string `json:"roomId"`
	StreamType string `json:"streamType,omitempty"`
}

func (c *Core) handleCreateBeeperStream(ctx context.Context, payload []byte) ([]byte, error) {
	if c.beeperStream == nil {
		return nil, errors.New("beeper stream helper is not initialized")
	}
	var req MatrixCreateBeeperStreamOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.StreamType == "" {
		req.StreamType = "com.beeper.ai.stream_event"
	}
	descriptor, err := c.beeperStream.NewDescriptor(ctx, id.RoomID(req.RoomID), req.StreamType)
	if err != nil {
		return nil, err
	}
	c.client.Log.Debug().
		Str("stream_type", descriptor.Type).
		Stringer("room_id", id.RoomID(req.RoomID)).
		Stringer("user_id", descriptor.UserID).
		Stringer("device_id", descriptor.DeviceID).
		Bool("encrypted", descriptor.Encryption != nil).
		Msg("Created beeper stream descriptor")
	return json.Marshal(MatrixCreateBeeperStreamResult{Descriptor: descriptor})
}

type MatrixBeeperStreamOptions struct {
	Content map[string]any `json:"content,omitempty"`
	EventID string         `json:"eventId"`
	RoomID  string         `json:"roomId"`
}

type MatrixRegisterBeeperStreamOptions struct {
	Descriptor  json.RawMessage                `json:"descriptor" tstype:"{ [key: string]: unknown }"`
	EventID     string                         `json:"eventId"`
	RoomID      string                         `json:"roomId"`
	Subscribers []MatrixBeeperStreamSubscriber `json:"subscribers,omitempty"`
}

type MatrixBeeperStreamSubscriber struct {
	DeviceID string `json:"deviceId"`
	UserID   string `json:"userId"`
}

func (c *Core) handleRegisterBeeperStream(ctx context.Context, payload []byte) ([]byte, error) {
	if c.beeperStream == nil {
		return nil, errors.New("beeper stream helper is not initialized")
	}
	var req MatrixRegisterBeeperStreamOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.RoomID == "" || req.EventID == "" || len(req.Descriptor) == 0 {
		return nil, errors.New("missing beeper stream registration fields")
	}
	var descriptor event.BeeperStreamInfo
	if err := json.Unmarshal(req.Descriptor, &descriptor); err != nil {
		return nil, err
	}
	if err := c.beeperStream.Register(ctx, id.RoomID(req.RoomID), id.EventID(req.EventID), &descriptor); err != nil {
		return nil, err
	}
	c.addBeeperStreamSubscribers(ctx, id.RoomID(req.RoomID), id.EventID(req.EventID), req.Subscribers)
	c.client.Log.Debug().
		Str("stream_type", descriptor.Type).
		Stringer("room_id", id.RoomID(req.RoomID)).
		Stringer("event_id", id.EventID(req.EventID)).
		Stringer("user_id", descriptor.UserID).
		Stringer("device_id", descriptor.DeviceID).
		Int("direct_subscribers", len(req.Subscribers)).
		Msg("Registered beeper stream")
	return c.empty()
}

func (c *Core) addBeeperStreamSubscribers(ctx context.Context, roomID id.RoomID, eventID id.EventID, subscribers []MatrixBeeperStreamSubscriber) {
	if c.beeperStream == nil || c.client == nil || len(subscribers) == 0 {
		return
	}
	events := make([]*event.Event, 0, len(subscribers))
	for _, sub := range subscribers {
		if sub.UserID == "" || sub.DeviceID == "" {
			continue
		}
		events = append(events, &event.Event{
			Content: event.Content{Parsed: &event.BeeperStreamSubscribeEventContent{
				DeviceID: id.DeviceID(sub.DeviceID),
				EventID:  eventID,
				ExpiryMS: mautrixbeeperstream.DefaultSubscribeExpiry.Milliseconds(),
				RoomID:   roomID,
			}},
			Sender:     id.UserID(sub.UserID),
			ToDeviceID: c.client.DeviceID,
			ToUserID:   c.client.UserID,
			Type:       event.ToDeviceBeeperStreamSubscribe,
		})
	}
	if len(events) == 0 {
		return
	}
	c.beeperStream.HandleSyncResponse(ctx, &mautrix.RespSync{
		ToDevice: mautrix.SyncEventsList{Events: events},
	})
}

func (c *Core) handlePublishBeeperStream(ctx context.Context, payload []byte) ([]byte, error) {
	if c.beeperStream == nil {
		return nil, errors.New("beeper stream helper is not initialized")
	}
	var req MatrixBeeperStreamOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if err := c.beeperStream.Publish(ctx, id.RoomID(req.RoomID), id.EventID(req.EventID), req.Content); err != nil {
		return nil, err
	}
	trace := beeperStreamUpdateTrace(req.Content)
	c.client.Log.Debug().
		Int("delta_count", trace.DeltaCount).
		Interface("first_seq", trace.FirstSeq).
		Str("first_part_type", trace.FirstPartType).
		Str("first_target_event", trace.FirstTargetEvent).
		Str("first_turn_id", trace.FirstTurnID).
		Int("keys", len(req.Content)).
		Stringer("room_id", id.RoomID(req.RoomID)).
		Stringer("event_id", id.EventID(req.EventID)).
		Msg("Published beeper stream update")
	return c.empty()
}

func (c *Core) handleUnsubscribeBeeperStream(payload []byte) ([]byte, error) {
	if c.beeperStream == nil {
		return c.empty()
	}
	var req MatrixBeeperStreamOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	c.beeperStream.Unregister(id.RoomID(req.RoomID), id.EventID(req.EventID))
	c.beeperStream.Unsubscribe(id.RoomID(req.RoomID), id.EventID(req.EventID))
	return c.empty()
}

type beeperStreamUpdateTraceData struct {
	DeltaCount       int
	FirstPartType    string
	FirstSeq         any
	FirstTargetEvent string
	FirstTurnID      string
}

func beeperStreamUpdateTrace(content map[string]any) beeperStreamUpdateTraceData {
	trace := beeperStreamUpdateTraceData{}
	if updates, ok := content["updates"].([]any); ok {
		for _, update := range updates {
			updateMap, ok := update.(map[string]any)
			if !ok {
				continue
			}
			trace.merge(beeperStreamUpdateTrace(updateMap))
		}
		return trace
	}
	for key, value := range content {
		if len(key) < len(".deltas") || key[len(key)-len(".deltas"):] != ".deltas" {
			continue
		}
		deltas, ok := value.([]any)
		if !ok {
			continue
		}
		trace.DeltaCount += len(deltas)
		if trace.FirstSeq != nil || len(deltas) == 0 {
			continue
		}
		delta, ok := deltas[0].(map[string]any)
		if !ok {
			continue
		}
		trace.FirstSeq = delta["seq"]
		if turnID, ok := delta["turn_id"].(string); ok {
			trace.FirstTurnID = turnID
		}
		if targetEvent, ok := delta["target_event"].(string); ok {
			trace.FirstTargetEvent = targetEvent
		}
		if part, ok := delta["part"].(map[string]any); ok {
			if partType, ok := part["type"].(string); ok {
				trace.FirstPartType = partType
			}
		}
	}
	return trace
}

func (trace *beeperStreamUpdateTraceData) merge(next beeperStreamUpdateTraceData) {
	trace.DeltaCount += next.DeltaCount
	if trace.FirstSeq != nil {
		return
	}
	trace.FirstSeq = next.FirstSeq
	trace.FirstPartType = next.FirstPartType
	trace.FirstTargetEvent = next.FirstTargetEvent
	trace.FirstTurnID = next.FirstTurnID
}

type MatrixEditMessageOptions struct {
	RoomID          string          `json:"roomId"`
	MessageID       string          `json:"messageId"`
	Body            string          `json:"body"`
	Content         OutboundEvent   `json:"content,omitempty" tstype:"{ [key: string]: unknown }"`
	TopLevelContent OutboundEvent   `json:"topLevelContent,omitempty" tstype:"{ [key: string]: unknown }"`
	FormattedBody   string          `json:"formattedBody,omitempty"`
	Mentions        *MatrixMentions `json:"mentions,omitempty"`
	MsgType         string          `json:"msgtype,omitempty" tstype:"\"m.text\" | \"m.notice\" | \"m.emote\""`
}

func (c *Core) handleEditMessage(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixEditMessageOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	newContent := messageContent(req.Body, req.FormattedBody, req.MsgType, req.Mentions)
	newContentMap := messageContentMap(newContent, req.Content)
	content := messageContentMap(&event.MessageEventContent{
		Body:       "",
		MsgType:    newContent.MsgType,
		NewContent: newContent,
		RelatesTo:  (&event.RelatesTo{}).SetReplace(id.EventID(req.MessageID)),
	}, req.TopLevelContent)
	content["m.new_content"] = newContentMap
	resp, err := retryMatrix(ctx, func() (*mautrix.RespSendEvent, error) {
		if err := c.prepareOutboundMegolm(ctx, cli, id.RoomID(req.RoomID)); err != nil {
			return nil, err
		}
		return cli.SendMessageEvent(ctx, id.RoomID(req.RoomID), event.EventMessage, content)
	})
	if err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	isMe := true
	isEdited := true
	replaces := req.MessageID
	c.rememberEdit(&MatrixMessageEvent{
		MatrixRawEvent: MatrixRawEvent{
			Content:        newContentMap,
			EventID:        req.MessageID,
			IsMe:           &isMe,
			OriginServerTS: &now,
			Raw:            resp,
			RoomID:         req.RoomID,
			Sender:         c.userID.String(),
			Type:           event.EventMessage.Type,
		},
		Attachments:   messageAttachments(newContent),
		Body:          newContent.Body,
		FormattedBody: optionalString(newContent.FormattedBody),
		IsEdited:      &isEdited,
		Mentions:      matrixMentions(newContent.Mentions),
		Msgtype:       string(newContent.MsgType),
		Relation:      &MatrixRelation{EventID: req.MessageID, Type: string(event.RelReplace)},
		Replaces:      &replaces,
	})
	return json.Marshal(MatrixRawMessage{EventID: resp.EventID.String(), RoomID: req.RoomID, Raw: resp})
}

type MatrixSendEphemeralEventOptions struct {
	Content       OutboundEvent `json:"content" tstype:"{ [key: string]: unknown }"`
	EventType     string        `json:"eventType"`
	RoomID        string        `json:"roomId"`
	TransactionID string        `json:"transactionId,omitempty"`
}

func (c *Core) handleSendEphemeralEvent(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixSendEphemeralEventOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.EventType == "" {
		return nil, errors.New("eventType is required")
	}
	resp, err := retryMatrix(ctx, func() (*mautrix.RespSendEvent, error) {
		if err := c.prepareOutboundMegolm(ctx, cli, id.RoomID(req.RoomID)); err != nil {
			return nil, err
		}
		return beeperSendEphemeralEvent(ctx, cli, id.RoomID(req.RoomID), event.Type{Type: req.EventType, Class: event.EphemeralEventType}, req.Content, req.TransactionID)
	})
	if err != nil {
		return nil, err
	}
	return json.Marshal(MatrixRawMessage{EventID: resp.EventID.String(), RoomID: req.RoomID, Raw: resp})
}

func beeperSendEphemeralEvent(ctx context.Context, cli *mautrix.Client, roomID id.RoomID, eventType event.Type, content any, txnID string) (resp *mautrix.RespSendEvent, err error) {
	if txnID == "" {
		txnID = cli.TxnID()
	}
	if cli.Crypto != nil && eventType != event.EventEncrypted {
		encrypted, err := cli.StateStore.IsEncrypted(ctx, roomID)
		if err != nil {
			return nil, fmt.Errorf("failed to check if room is encrypted: %w", err)
		}
		if encrypted {
			if err := ensureMegolmRecipients(ctx, cli, roomID); err != nil {
				return nil, err
			}
			content, err = cli.Crypto.Encrypt(ctx, roomID, eventType, content)
			if err != nil {
				return nil, fmt.Errorf("failed to encrypt event: %w", err)
			}
			eventType = event.EventEncrypted
		}
	}
	query := map[string]string{"ts": strconv.FormatInt(time.Now().UnixMilli(), 10)}
	urlPath := cli.BuildURLWithQuery(mautrix.ClientURLPath{"unstable", "com.beeper.ephemeral", "rooms", roomID, "ephemeral", eventType.String(), txnID}, query)
	_, err = cli.MakeRequest(ctx, http.MethodPut, urlPath, content, &resp)
	return resp, err
}

func ensureMegolmRecipients(ctx context.Context, cli *mautrix.Client, roomID id.RoomID) error {
	if cli == nil || cli.Crypto == nil || cli.StateStore == nil {
		return nil
	}
	encrypted, err := cli.StateStore.IsEncrypted(ctx, roomID)
	if err != nil {
		return err
	}
	if !encrypted {
		var encryption event.EncryptionEventContent
		err = retryMatrixVoid(ctx, func() error {
			return cli.StateEvent(ctx, roomID, event.StateEncryption, "", &encryption)
		})
		if errors.Is(err, mautrix.MNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		if encryption.Algorithm != id.AlgorithmMegolmV1 {
			return nil
		}
		if err := cli.StateStore.SetEncryptionEvent(ctx, roomID, &encryption); err != nil {
			return err
		}
	}
	members, err := retryMatrix(ctx, func() (*mautrix.RespJoinedMembers, error) {
		return cli.JoinedMembers(ctx, roomID)
	})
	if err != nil {
		return err
	}
	for userID, member := range members.Joined {
		if err := cli.StateStore.SetMember(ctx, roomID, userID, &event.MemberEventContent{
			AvatarURL:   id.ContentURIString(member.AvatarURL),
			Displayname: member.DisplayName,
			Membership:  event.MembershipJoin,
		}); err != nil {
			return err
		}
	}
	return nil
}

type MatrixDeleteMessageOptions struct {
	RoomID    string `json:"roomId"`
	MessageID string `json:"messageId"`
	Reason    string `json:"reason,omitempty"`
}

func (c *Core) handleDeleteMessage(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixDeleteMessageOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	err = retryMatrixVoid(ctx, func() error {
		_, err := cli.RedactEvent(ctx, id.RoomID(req.RoomID), id.EventID(req.MessageID), mautrix.ReqRedact{Reason: req.Reason})
		return err
	})
	if err != nil {
		return nil, err
	}
	return c.empty()
}

type MatrixTypingOptions struct {
	RoomID    string `json:"roomId"`
	Typing    bool   `json:"typing"`
	TimeoutMS int    `json:"timeoutMs,omitempty"`
}

func (c *Core) handleSetTyping(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixTypingOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	err = retryMatrixVoid(ctx, func() error {
		_, err := cli.UserTyping(ctx, id.RoomID(req.RoomID), req.Typing, time.Duration(req.TimeoutMS)*time.Millisecond)
		return err
	})
	if err != nil {
		return nil, err
	}
	return c.empty()
}

type MatrixFetchMessageOptions struct {
	RoomID    string `json:"roomId"`
	MessageID string `json:"messageId"`
}

func (c *Core) handleFetchMessage(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixFetchMessageOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	evt, err := retryMatrix(ctx, func() (*event.Event, error) {
		return cli.GetEvent(ctx, id.RoomID(req.RoomID), id.EventID(req.MessageID))
	})
	if err != nil {
		return nil, err
	}
	if evt.RoomID == "" {
		evt.RoomID = id.RoomID(req.RoomID)
	}
	converted := c.convertMaybeEncryptedMessageEvent(ctx, evt)
	converted = c.applyLatestReplacement(ctx, cli, id.RoomID(req.RoomID), converted)
	if converted == nil {
		return json.Marshal(OutboundEvent{"message": nil})
	}
	return json.Marshal(OutboundEvent{"message": converted})
}

type MatrixFetchMessagesOptions struct {
	RoomID            string `json:"roomId"`
	Cursor            string `json:"cursor,omitempty"`
	Direction         string `json:"direction,omitempty" tstype:"\"backward\" | \"forward\""`
	Limit             int    `json:"limit,omitempty"`
	ThreadRootEventID string `json:"threadRootEventId,omitempty"`
}

func (c *Core) handleFetchMessages(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixFetchMessagesOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.Limit <= 0 {
		req.Limit = 50
	}
	dir := mautrix.DirectionBackward
	if req.Direction == "forward" {
		dir = mautrix.DirectionForward
	}
	if req.ThreadRootEventID != "" {
		return c.handleFetchThreadMessages(ctx, cli, req, dir)
	}
	resp, err := retryMatrix(ctx, func() (*mautrix.RespMessages, error) {
		return cli.Messages(ctx, id.RoomID(req.RoomID), req.Cursor, "", dir, nil, req.Limit)
	})
	if err != nil {
		return nil, err
	}
	messages := make([]*MatrixMessageEvent, 0, len(resp.Chunk))
	for _, evt := range resp.Chunk {
		if evt != nil && evt.RoomID == "" {
			evt.RoomID = id.RoomID(req.RoomID)
		}
		if converted := c.convertMaybeEncryptedMessageEvent(ctx, evt); converted != nil {
			if converted.ThreadRootEventID != nil {
				continue
			}
			messages = upsertMessage(messages, c.applyLatestReplacement(ctx, cli, id.RoomID(req.RoomID), converted))
		}
	}
	sort.SliceStable(messages, func(i, j int) bool {
		return int64Value(messages[i].OriginServerTS) < int64Value(messages[j].OriginServerTS)
	})
	return json.Marshal(OutboundEvent{"messages": messages, "nextCursor": resp.End})
}

func (c *Core) handleFetchThreadMessages(ctx context.Context, cli *mautrix.Client, req MatrixFetchMessagesOptions, dir mautrix.Direction) ([]byte, error) {
	limit := req.Limit
	includeRoot := req.Cursor == ""
	if includeRoot && limit > 1 {
		limit--
	}
	resp, err := retryMatrix(ctx, func() (*mautrix.RespGetRelations, error) {
		return cli.GetRelations(ctx, id.RoomID(req.RoomID), id.EventID(req.ThreadRootEventID), &mautrix.ReqGetRelations{
			RelationType: event.RelThread,
			Dir:          dir,
			From:         req.Cursor,
			Limit:        limit,
			Recurse:      true,
		})
	})
	if err != nil {
		return nil, err
	}
	messages := make([]*MatrixMessageEvent, 0, len(resp.Chunk)+1)
	if includeRoot {
		root, err := retryMatrix(ctx, func() (*event.Event, error) {
			return cli.GetEvent(ctx, id.RoomID(req.RoomID), id.EventID(req.ThreadRootEventID))
		})
		if err == nil {
			if root.RoomID == "" {
				root.RoomID = id.RoomID(req.RoomID)
			}
			if converted := c.convertMaybeEncryptedMessageEvent(ctx, root); converted != nil {
				messages = upsertMessage(messages, c.applyLatestReplacement(ctx, cli, id.RoomID(req.RoomID), converted))
			}
		} else if !errors.Is(err, mautrix.MNotFound) {
			return nil, err
		}
	}
	for _, evt := range resp.Chunk {
		if evt != nil && evt.RoomID == "" {
			evt.RoomID = id.RoomID(req.RoomID)
		}
		if converted := c.convertMaybeEncryptedMessageEvent(ctx, evt); converted != nil {
			if stringValue(converted.ThreadRootEventID) == req.ThreadRootEventID {
				messages = upsertMessage(messages, c.applyLatestReplacement(ctx, cli, id.RoomID(req.RoomID), converted))
			}
		}
	}
	sort.SliceStable(messages, func(i, j int) bool {
		return int64Value(messages[i].OriginServerTS) < int64Value(messages[j].OriginServerTS)
	})
	nextCursor := resp.NextBatch
	if dir == mautrix.DirectionForward {
		nextCursor = resp.PrevBatch
	}
	return json.Marshal(OutboundEvent{"messages": messages, "nextCursor": nextCursor})
}

func (c *Core) applyLatestReplacement(ctx context.Context, cli *mautrix.Client, roomID id.RoomID, msg *MatrixMessageEvent) *MatrixMessageEvent {
	if msg == nil || boolValue(msg.IsEdited) {
		return msg
	}
	eventID := msg.EventID
	if eventID == "" {
		return msg
	}
	if cached := c.messageEdits[id.EventID(eventID)]; cached != nil {
		cached.setThreadRoot(stringValue(msg.ThreadRootEventID))
		return cached
	}
	resp, err := retryMatrix(ctx, func() (*mautrix.RespGetRelations, error) {
		return cli.GetRelations(ctx, roomID, id.EventID(eventID), &mautrix.ReqGetRelations{
			RelationType: event.RelReplace,
			EventType:    event.EventMessage,
			Dir:          mautrix.DirectionBackward,
			Limit:        20,
		})
	})
	if err != nil {
		return msg
	}
	var latest *MatrixMessageEvent
	for _, evt := range resp.Chunk {
		if evt != nil && evt.RoomID == "" {
			evt.RoomID = roomID
		}
		converted := c.convertMaybeEncryptedMessageEvent(ctx, evt)
		if converted == nil || converted.EventID != eventID {
			continue
		}
		if latest == nil {
			latest = converted
			continue
		}
		if int64Value(converted.OriginServerTS) > int64Value(latest.OriginServerTS) {
			latest = converted
		}
	}
	if latest == nil {
		return msg
	}
	latest.setThreadRoot(stringValue(msg.ThreadRootEventID))
	return latest
}

func upsertMessage(messages []*MatrixMessageEvent, next *MatrixMessageEvent) []*MatrixMessageEvent {
	if next == nil {
		return messages
	}
	eventID := next.EventID
	if eventID == "" {
		return append(messages, next)
	}
	for i, existing := range messages {
		if existing.EventID != eventID {
			continue
		}
		nextTs := int64Value(next.OriginServerTS)
		if boolValue(next.IsEdited) || nextTs >= int64Value(existing.OriginServerTS) {
			messages[i] = next
		}
		return messages
	}
	return append(messages, next)
}

func (c *Core) rememberEdit(msg *MatrixMessageEvent) {
	if msg == nil {
		return
	}
	eventID := msg.EventID
	if eventID == "" {
		return
	}
	existing := c.messageEdits[id.EventID(eventID)]
	if existing == nil {
		c.messageEdits[id.EventID(eventID)] = msg
		return
	}
	if int64Value(msg.OriginServerTS) >= int64Value(existing.OriginServerTS) {
		c.messageEdits[id.EventID(eventID)] = msg
	}
}

type MatrixMarkReadOptions struct {
	EventID string `json:"eventId"`
	RoomID  string `json:"roomId"`
}

func (c *Core) handleMarkRead(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixMarkReadOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	err = retryMatrixVoid(ctx, func() error {
		return cli.MarkRead(ctx, id.RoomID(req.RoomID), id.EventID(req.EventID))
	})
	return c.emptyIfNil(err)
}

func (c *Core) convertMessageEvent(evt *event.Event) *MatrixMessageEvent {
	if evt == nil {
		return nil
	}
	_ = evt.Content.ParseRaw(evt.Type)
	content := evt.Content.AsMessage()
	if content.RelatesTo.GetReplaceID() != "" {
		return c.convertEditEvent(evt, content)
	}
	content.RemoveReplyFallback()
	relation := matrixRelation(content.RelatesTo)
	replyTo := optionalEventID(content.RelatesTo.GetNonFallbackReplyTo())
	threadRoot := optionalEventID(content.RelatesTo.GetThreadParent())
	isEdited := false
	if evt.Unsigned.Relations != nil && len(evt.Unsigned.Relations.Replaces.List) > 0 {
		isEdited = true
	}
	isMe := evt.Sender == c.userID
	isEncrypted := evt.Mautrix.EventSource&event.SourceDecrypted != 0 || evt.Mautrix.WasEncrypted
	return &MatrixMessageEvent{
		MatrixRawEvent: MatrixRawEvent{
			Content:        evt.Content.Raw,
			EventID:        evt.ID.String(),
			IsMe:           &isMe,
			OriginServerTS: &evt.Timestamp,
			Raw:            evt,
			RoomID:         evt.RoomID.String(),
			Sender:         evt.Sender.String(),
			Type:           evt.Type.Type,
		},
		Attachments:       messageAttachments(content),
		Body:              content.Body,
		FormattedBody:     optionalString(content.FormattedBody),
		IsEncrypted:       &isEncrypted,
		IsEdited:          &isEdited,
		Mentions:          matrixMentions(content.Mentions),
		Msgtype:           string(content.MsgType),
		Relation:          relation,
		ReplyTo:           replyTo,
		ThreadRootEventID: threadRoot,
	}
}

func (c *Core) convertEditEvent(evt *event.Event, content *event.MessageEventContent) *MatrixMessageEvent {
	if evt == nil || content == nil || content.NewContent == nil {
		return nil
	}
	newContent := content.NewContent
	newContent.RemoveReplyFallback()
	replaces := optionalEventID(content.RelatesTo.GetReplaceID())
	relation := matrixRelation(content.RelatesTo)
	threadRoot := optionalEventID(newContent.RelatesTo.GetThreadParent())
	replyTo := optionalEventID(newContent.RelatesTo.GetNonFallbackReplyTo())
	isMe := evt.Sender == c.userID
	isEncrypted := evt.Mautrix.EventSource&event.SourceDecrypted != 0 || evt.Mautrix.WasEncrypted
	isEdited := true
	converted := &MatrixMessageEvent{
		MatrixRawEvent: MatrixRawEvent{
			Content:        evt.Content.Raw,
			EventID:        content.RelatesTo.GetReplaceID().String(),
			IsMe:           &isMe,
			OriginServerTS: &evt.Timestamp,
			Raw:            evt,
			RoomID:         evt.RoomID.String(),
			Sender:         evt.Sender.String(),
			Type:           evt.Type.Type,
		},
		Attachments:       messageAttachments(newContent),
		Body:              newContent.Body,
		FormattedBody:     optionalString(newContent.FormattedBody),
		IsEncrypted:       &isEncrypted,
		IsEdited:          &isEdited,
		Mentions:          matrixMentions(newContent.Mentions),
		Msgtype:           string(newContent.MsgType),
		Relation:          relation,
		Replaces:          replaces,
		ReplyTo:           replyTo,
		ThreadRootEventID: threadRoot,
	}
	c.rememberEdit(converted)
	return converted
}

func matrixMentions(mentions *event.Mentions) *MatrixMentions {
	if mentions == nil || (!mentions.Room && len(mentions.UserIDs) == 0) {
		return nil
	}
	result := &MatrixMentions{Room: mentions.Room}
	for _, userID := range mentions.UserIDs {
		result.UserIDs = append(result.UserIDs, userID.String())
	}
	return result
}

func matrixRelation(rel *event.RelatesTo) *MatrixRelation {
	if rel == nil {
		return nil
	}
	switch rel.Type {
	case event.RelReplace:
		if rel.EventID == "" {
			return nil
		}
		return &MatrixRelation{EventID: rel.EventID.String(), Type: string(event.RelReplace)}
	case event.RelAnnotation:
		if rel.EventID == "" {
			return nil
		}
		key := rel.Key
		return &MatrixRelation{EventID: rel.EventID.String(), Key: optionalString(key), Type: string(event.RelAnnotation)}
	case event.RelThread:
		if rel.EventID == "" {
			return nil
		}
		isFallback := rel.IsFallingBack
		return &MatrixRelation{
			EventID:    rel.EventID.String(),
			IsFallback: &isFallback,
			ReplyTo:    optionalEventID(rel.GetReplyTo()),
			Type:       string(event.RelThread),
		}
	case event.RelReference:
		if rel.EventID == "" {
			return nil
		}
		return &MatrixRelation{EventID: rel.EventID.String(), Type: string(event.RelReference)}
	default:
		replyTo := rel.GetNonFallbackReplyTo()
		if replyTo != "" {
			return &MatrixRelation{EventID: replyTo.String(), Type: "m.in_reply_to"}
		}
		return nil
	}
}

func optionalEventID(eventID id.EventID) *string {
	if eventID == "" {
		return nil
	}
	value := eventID.String()
	return &value
}

func messageContent(body, formattedBody, msgType string, mentions *MatrixMentions) *event.MessageEventContent {
	if msgType == "" {
		msgType = string(event.MsgText)
	}
	content := &event.MessageEventContent{
		Body:    body,
		MsgType: event.MessageType(msgType),
	}
	if formattedBody != "" && formattedBody != body {
		content.Format = event.FormatHTML
		content.FormattedBody = formattedBody
	}
	if mentions != nil && (mentions.Room || len(mentions.UserIDs) > 0) {
		content.Mentions = &event.Mentions{Room: mentions.Room}
		for _, userID := range mentions.UserIDs {
			content.Mentions.Add(id.UserID(userID))
		}
	}
	return content
}

func messageContentMap(target any, extra OutboundEvent) map[string]any {
	if len(extra) == 0 {
		extra = nil
	}
	data, err := json.Marshal(target)
	if err != nil {
		return map[string]any{}
	}
	var merged map[string]any
	if err := json.Unmarshal(data, &merged); err != nil {
		return map[string]any{}
	}
	for key, value := range extra {
		merged[key] = value
	}
	return merged
}
