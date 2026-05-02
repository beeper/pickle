package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

type MatrixFetchRoomOptions struct {
	RoomID string `json:"roomId"`
}

type MatrixRoomInfo struct {
	Encrypted   bool           `json:"encrypted"`
	ID          string         `json:"id"`
	IsDM        bool           `json:"isDM,omitempty"`
	JoinRule    string         `json:"joinRule,omitempty"`
	MemberCount int            `json:"memberCount,omitempty"`
	Name        string         `json:"name,omitempty"`
	Topic       string         `json:"topic,omitempty"`
	Raw         map[string]any `json:"raw,omitempty"`
	Visibility  string         `json:"visibility,omitempty" tstype:"\"private\" | \"workspace\" | \"external\" | \"unknown\""`
}

func (c *Core) handleFetchRoom(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixFetchRoomOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	info := MatrixRoomInfo{ID: req.RoomID, Raw: map[string]any{}}
	if cli.StateStore != nil {
		if encrypted, err := cli.StateStore.IsEncrypted(ctx, id.RoomID(req.RoomID)); err == nil {
			info.Encrypted = encrypted
		}
	}
	var name map[string]any
	if err := retryMatrixVoid(ctx, func() error {
		return cli.StateEvent(ctx, id.RoomID(req.RoomID), event.StateRoomName, "", &name)
	}); err == nil {
		info.Raw["name"] = name
		if rawName, ok := name["name"].(string); ok {
			info.Name = rawName
		}
	} else if !errors.Is(err, mautrix.MNotFound) {
		return nil, err
	}
	var topic map[string]any
	if err := retryMatrixVoid(ctx, func() error {
		return cli.StateEvent(ctx, id.RoomID(req.RoomID), event.StateTopic, "", &topic)
	}); err == nil {
		info.Raw["topic"] = topic
		if rawTopic, ok := topic["topic"].(string); ok {
			info.Topic = rawTopic
		}
	} else if !errors.Is(err, mautrix.MNotFound) {
		return nil, err
	}
	var joinRules map[string]any
	if err := retryMatrixVoid(ctx, func() error {
		return cli.StateEvent(ctx, id.RoomID(req.RoomID), event.StateJoinRules, "", &joinRules)
	}); err == nil {
		info.Raw["joinRules"] = joinRules
		if joinRule, ok := joinRules["join_rule"].(string); ok {
			info.JoinRule = joinRule
			if joinRule == "public" {
				info.Visibility = "workspace"
			} else {
				info.Visibility = "private"
			}
		}
	} else if !errors.Is(err, mautrix.MNotFound) {
		return nil, err
	}
	members, err := retryMatrix(ctx, func() (*mautrix.RespJoinedMembers, error) {
		return cli.JoinedMembers(ctx, id.RoomID(req.RoomID))
	})
	if err == nil {
		info.MemberCount = len(members.Joined)
		info.IsDM = info.MemberCount == 2
		info.Raw["joinedMembers"] = members.Joined
	} else if !errors.Is(err, mautrix.MNotFound) && !errors.Is(err, mautrix.MForbidden) {
		return nil, err
	}
	return json.Marshal(info)
}

type MatrixOpenDMOptions struct {
	UserID string `json:"userId"`
}

func (c *Core) handleOpenDM(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixOpenDMOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	stateKey := ""
	resp, err := retryMatrix(ctx, func() (*mautrix.RespCreateRoom, error) {
		return cli.CreateRoom(ctx, &mautrix.ReqCreateRoom{
			IsDirect: true,
			Preset:   "private_chat",
			InitialState: []*event.Event{{
				Type:     event.StateEncryption,
				StateKey: &stateKey,
				Content: event.Content{Parsed: &event.EncryptionEventContent{
					Algorithm:              id.AlgorithmMegolmV1,
					RotationPeriodMillis:   int64((7 * 24 * time.Hour).Milliseconds()),
					RotationPeriodMessages: 100,
				}},
			}},
		})
	})
	if err != nil {
		return nil, err
	}
	err = retryMatrixVoid(ctx, func() error {
		_, err := cli.InviteUser(ctx, resp.RoomID, &mautrix.ReqInviteUser{UserID: id.UserID(req.UserID)})
		return err
	})
	if err != nil && !strings.Contains(err.Error(), "already in the room") {
		return nil, err
	}
	c.updateDirectChats(ctx, cli, id.UserID(req.UserID), resp.RoomID)
	return json.Marshal(OutboundEvent{"roomId": resp.RoomID.String(), "raw": resp})
}

type MatrixJoinRoomOptions struct {
	RoomIDOrAlias string `json:"roomIdOrAlias"`
}

func (c *Core) handleJoinRoom(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixJoinRoomOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	resp, err := retryMatrix(ctx, func() (*mautrix.RespJoinRoom, error) {
		return cli.JoinRoom(ctx, req.RoomIDOrAlias, nil)
	})
	if err != nil {
		return nil, err
	}
	return json.Marshal(OutboundEvent{"roomId": resp.RoomID.String(), "raw": resp})
}

type MatrixLeaveRoomOptions struct {
	Reason string `json:"reason,omitempty"`
	RoomID string `json:"roomId"`
}

func (c *Core) handleLeaveRoom(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixLeaveRoomOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	var leaveReq *mautrix.ReqLeave
	if req.Reason != "" {
		leaveReq = &mautrix.ReqLeave{Reason: req.Reason}
	}
	resp, err := retryMatrix(ctx, func() (*mautrix.RespLeaveRoom, error) {
		return cli.LeaveRoom(ctx, id.RoomID(req.RoomID), leaveReq)
	})
	if err != nil {
		return nil, err
	}
	return json.Marshal(OutboundEvent{"raw": resp})
}

type MatrixInviteUserOptions struct {
	Reason string `json:"reason,omitempty"`
	RoomID string `json:"roomId"`
	UserID string `json:"userId"`
}

func (c *Core) handleInviteUser(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixInviteUserOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	resp, err := retryMatrix(ctx, func() (*mautrix.RespInviteUser, error) {
		return cli.InviteUser(ctx, id.RoomID(req.RoomID), &mautrix.ReqInviteUser{
			Reason: req.Reason,
			UserID: id.UserID(req.UserID),
		})
	})
	if err != nil {
		return nil, err
	}
	return json.Marshal(OutboundEvent{"raw": resp})
}

func (c *Core) handleFetchJoinedRooms(ctx context.Context) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	resp, err := retryMatrix(ctx, func() (*mautrix.RespJoinedRooms, error) {
		return cli.JoinedRooms(ctx)
	})
	if err != nil {
		return nil, err
	}
	rooms := make([]string, 0, len(resp.JoinedRooms))
	for _, roomID := range resp.JoinedRooms {
		rooms = append(rooms, roomID.String())
	}
	return json.Marshal(OutboundEvent{"roomIds": rooms, "raw": resp})
}

func (c *Core) updateDirectChats(ctx context.Context, cli *mautrix.Client, userID id.UserID, roomID id.RoomID) {
	directChats := event.DirectChatsEventContent{}
	if err := retryMatrixVoid(ctx, func() error {
		return cli.GetAccountData(ctx, event.AccountDataDirectChats.Type, &directChats)
	}); err != nil && !errors.Is(err, mautrix.MNotFound) {
		c.emit(OutboundEvent{"type": "error", "error": fmt.Sprintf("failed to fetch m.direct account data: %v", err)})
		return
	}
	for _, existingRoomID := range directChats[userID] {
		if existingRoomID == roomID {
			return
		}
	}
	directChats[userID] = append(directChats[userID], roomID)
	if err := retryMatrixVoid(ctx, func() error {
		return cli.SetAccountData(ctx, event.AccountDataDirectChats.Type, directChats)
	}); err != nil {
		c.emit(OutboundEvent{"type": "error", "error": fmt.Sprintf("failed to update m.direct account data: %v", err)})
	}
}
