package core

import (
	"context"
	"encoding/json"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

type reactionSnapshot struct {
	EventID          id.EventID
	RelatesToEventID id.EventID
	RoomID           id.RoomID
	Sender           id.UserID
	Key              string
	Raw              any
}

type reactionReq struct {
	RoomID    string `json:"roomId"`
	MessageID string `json:"messageId"`
	Emoji     string `json:"emoji"`
}

func (c *Core) handleAddReaction(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req reactionReq
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	content := &event.ReactionEventContent{
		RelatesTo: *(&event.RelatesTo{}).SetAnnotation(id.EventID(req.MessageID), req.Emoji),
	}
	resp, err := retryMatrix(ctx, func() (*mautrix.RespSendEvent, error) {
		return cli.SendMessageEvent(ctx, id.RoomID(req.RoomID), event.EventReaction, content)
	})
	if err != nil {
		return nil, err
	}
	return json.Marshal(rawMessageResp{EventID: resp.EventID.String(), RoomID: req.RoomID, Raw: resp})
}

func (c *Core) handleRemoveReaction(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req reactionReq
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

func (c *Core) processRedaction(evt *event.Event) {
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
	c.emitReaction(snapshot, false)
}

func (c *Core) emitReaction(snapshot reactionSnapshot, added bool) {
	c.emit(OutboundEvent{
		"type": "reaction",
		"event": OutboundEvent{
			"added":            added,
			"content":          map[string]any{},
			"eventId":          snapshot.EventID.String(),
			"isMe":             snapshot.Sender == c.userID,
			"key":              snapshot.Key,
			"raw":              snapshot.Raw,
			"relatesToEventId": snapshot.RelatesToEventID.String(),
			"roomId":           snapshot.RoomID.String(),
			"sender":           snapshot.Sender.String(),
			"type":             event.EventReaction.Type,
		},
	})
}
