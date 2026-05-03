package core

import (
	"context"
	"encoding/json"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

type reactionSnapshot struct {
	EventID          id.EventID `json:"eventId"`
	Key              string     `json:"key"`
	Raw              any        `json:"raw,omitempty"`
	RelatesToEventID id.EventID `json:"relatesToEventId"`
	RoomID           id.RoomID  `json:"roomId"`
	Sender           id.UserID  `json:"sender"`
}

type MatrixReactionOptions struct {
	RoomID    string `json:"roomId"`
	MessageID string `json:"messageId"`
	Emoji     string `json:"emoji"`
}

func (c *Core) handleAddReaction(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixReactionOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	content := &event.ReactionEventContent{
		RelatesTo: *(&event.RelatesTo{}).SetAnnotation(id.EventID(req.MessageID), req.Emoji),
	}
	resp, err := retryMatrix(ctx, func() (*mautrix.RespSendEvent, error) {
		if err := c.prepareOutboundMegolm(ctx, cli, id.RoomID(req.RoomID)); err != nil {
			return nil, err
		}
		return cli.SendMessageEvent(ctx, id.RoomID(req.RoomID), event.EventReaction, content)
	})
	if err != nil {
		return nil, err
	}
	return json.Marshal(MatrixRawMessage{EventID: resp.EventID.String(), RoomID: req.RoomID, Raw: resp})
}

func (c *Core) handleRemoveReaction(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixReactionOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	relations, err := retryMatrix(ctx, func() (*mautrix.RespGetRelations, error) {
		return cli.GetRelations(ctx, id.RoomID(req.RoomID), id.EventID(req.MessageID), &mautrix.ReqGetRelations{
			RelationType: event.RelAnnotation,
			EventType:    event.EventReaction,
			Dir:          mautrix.DirectionBackward,
			Limit:        100,
		})
	})
	if err != nil {
		return nil, err
	}
	for _, relEvt := range relations.Chunk {
		if relEvt == nil || relEvt.Sender != c.userID {
			continue
		}
		_ = relEvt.Content.ParseRaw(relEvt.Type)
		content := relEvt.Content.AsReaction()
		if content.RelatesTo.EventID == id.EventID(req.MessageID) && content.RelatesTo.Key == req.Emoji {
			err = retryMatrixVoid(ctx, func() error {
				_, err := cli.RedactEvent(ctx, id.RoomID(req.RoomID), relEvt.ID)
				return err
			})
			return c.emptyIfNil(err)
		}
	}
	return c.empty()
}

func (c *Core) processRedaction(ctx context.Context, evt *event.Event) {
	redacts := evt.Redacts
	if redacts == "" {
		_ = evt.Content.ParseRaw(evt.Type)
		if content, ok := evt.Content.Parsed.(*event.RedactionEventContent); ok {
			redacts = content.Redacts
		}
	}
	if redacts == "" {
		return
	}
	snapshot, ok := c.reactions[redacts]
	if !ok {
		return
	}
	delete(c.reactions, redacts)
	_ = c.stores.DeleteReactionSnapshot(ctx, redacts)
	c.emitReaction(snapshot, false)
}

func (c *Core) rememberReaction(ctx context.Context, snapshot reactionSnapshot) {
	if snapshot.EventID == "" {
		return
	}
	c.reactions[snapshot.EventID] = snapshot
	_ = c.stores.SaveReactionSnapshot(ctx, snapshot)
}

func (c *Core) loadReactionSnapshots(ctx context.Context) error {
	reactions, err := c.stores.LoadReactionSnapshots(ctx)
	if err != nil {
		return err
	}
	for _, snapshot := range reactions {
		if snapshot.EventID != "" {
			c.reactions[snapshot.EventID] = snapshot
		}
	}
	return nil
}

func (c *Core) emitReaction(snapshot reactionSnapshot, added bool) {
	isMe := snapshot.Sender == c.userID
	content := map[string]any{}
	c.emit(OutboundEvent{
		"type": "reaction",
		"event": MatrixReactionEvent{
			MatrixRawEvent: MatrixRawEvent{
				Content: content,
				EventID: snapshot.EventID.String(),
				IsMe:    &isMe,
				Raw:     snapshot.Raw,
				RoomID:  snapshot.RoomID.String(),
				Sender:  snapshot.Sender.String(),
				Type:    event.EventReaction.Type,
			},
			Added:            &added,
			Key:              snapshot.Key,
			RelatesToEventID: snapshot.RelatesToEventID.String(),
		},
	})
}
