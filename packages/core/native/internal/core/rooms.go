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

type MatrixRoomStateInput struct {
	Content  OutboundEvent `json:"content" tstype:"{ [key: string]: unknown }"`
	StateKey string        `json:"stateKey"`
	Type     string        `json:"type"`
}

type MatrixCreateRoomOptions struct {
	CreationContent OutboundEvent          `json:"creationContent,omitempty" tstype:"{ [key: string]: unknown }"`
	InitialState    []MatrixRoomStateInput `json:"initialState,omitempty"`
	Invite          []string               `json:"invite,omitempty"`
	IsDirect        bool                   `json:"isDirect,omitempty"`
	Name            string                 `json:"name,omitempty"`
	Preset          string                 `json:"preset,omitempty" tstype:"\"private_chat\" | \"public_chat\" | \"trusted_private_chat\" | string"`
	RoomAliasName   string                 `json:"roomAliasName,omitempty"`
	RoomVersion     string                 `json:"roomVersion,omitempty"`
	Topic           string                 `json:"topic,omitempty"`
	Visibility      string                 `json:"visibility,omitempty" tstype:"\"public\" | \"private\" | string"`
}

type MatrixCreateRoomResult struct {
	Raw    any    `json:"raw"`
	RoomID string `json:"roomId"`
}

type MatrixRoomStateEvent struct {
	Content        map[string]any `json:"content"`
	EventID        string         `json:"eventId,omitempty"`
	OriginServerTS *int64         `json:"originServerTs,omitempty"`
	Raw            any            `json:"raw"`
	RoomID         string         `json:"roomId"`
	Sender         string         `json:"sender,omitempty"`
	StateKey       string         `json:"stateKey"`
	Type           string         `json:"type"`
}

type MatrixFetchRoomStateOptions struct {
	RoomID string `json:"roomId"`
}

type MatrixFetchRoomStateEventOptions struct {
	EventType string `json:"eventType"`
	RoomID    string `json:"roomId"`
	StateKey  string `json:"stateKey,omitempty"`
}

type MatrixFetchRoomStateResult struct {
	Events []MatrixRoomStateEvent `json:"events"`
	Raw    any                    `json:"raw"`
}

type MatrixSendRoomStateEventOptions struct {
	Content   OutboundEvent `json:"content" tstype:"{ [key: string]: unknown }"`
	EventType string        `json:"eventType"`
	RoomID    string        `json:"roomId"`
	StateKey  string        `json:"stateKey,omitempty"`
}

type MatrixResolveRoomAliasOptions struct {
	Alias string `json:"alias"`
}

type MatrixResolveRoomAliasResult struct {
	Raw     any      `json:"raw"`
	RoomID  string   `json:"roomId"`
	Servers []string `json:"servers"`
}

type MatrixListPublicRoomsOptions struct {
	IncludeAllNetworks   bool   `json:"includeAllNetworks,omitempty"`
	Limit                int    `json:"limit,omitempty"`
	Since                string `json:"since,omitempty"`
	ThirdPartyInstanceID string `json:"thirdPartyInstanceId,omitempty"`
}

type MatrixPublicRoom struct {
	AvatarURL        string   `json:"avatarUrl,omitempty"`
	CanonicalAlias   string   `json:"canonicalAlias,omitempty"`
	GuestCanJoin     bool     `json:"guestCanJoin"`
	JoinRule         string   `json:"joinRule,omitempty"`
	Name             string   `json:"name,omitempty"`
	NumJoinedMembers int      `json:"numJoinedMembers"`
	RoomID           string   `json:"roomId"`
	RoomType         string   `json:"roomType,omitempty"`
	Topic            string   `json:"topic,omitempty"`
	WorldReadable    bool     `json:"worldReadable"`
	RoomVersion      string   `json:"roomVersion,omitempty"`
	Encryption       string   `json:"encryption,omitempty"`
	AllowedRoomIDs   []string `json:"allowedRoomIds,omitempty"`
}

type MatrixListPublicRoomsResult struct {
	NextBatch              string             `json:"nextBatch,omitempty"`
	PrevBatch              string             `json:"prevBatch,omitempty"`
	Raw                    any                `json:"raw"`
	Rooms                  []MatrixPublicRoom `json:"rooms"`
	TotalRoomCountEstimate int                `json:"totalRoomCountEstimate"`
}

func (c *Core) handleCreateRoom(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixCreateRoomOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	invitees := make([]id.UserID, 0, len(req.Invite))
	for _, userID := range req.Invite {
		invitees = append(invitees, id.UserID(userID))
	}
	initialState := make([]*event.Event, 0, len(req.InitialState))
	for _, state := range req.InitialState {
		stateKey := state.StateKey
		initialState = append(initialState, &event.Event{
			Type:     event.NewEventType(state.Type),
			StateKey: &stateKey,
			Content:  event.Content{Raw: state.Content},
		})
	}
	resp, err := retryMatrix(ctx, func() (*mautrix.RespCreateRoom, error) {
		return cli.CreateRoom(ctx, &mautrix.ReqCreateRoom{
			CreationContent: req.CreationContent,
			InitialState:    initialState,
			Invite:          invitees,
			IsDirect:        req.IsDirect,
			Name:            req.Name,
			Preset:          req.Preset,
			RoomAliasName:   req.RoomAliasName,
			RoomVersion:     id.RoomVersion(req.RoomVersion),
			Topic:           req.Topic,
			Visibility:      req.Visibility,
		})
	})
	if err != nil {
		return nil, err
	}
	return json.Marshal(MatrixCreateRoomResult{Raw: resp, RoomID: resp.RoomID.String()})
}

type MatrixRoomInfo struct {
	Encrypted    bool           `json:"encrypted"`
	DirectUserID string         `json:"directUserId,omitempty"`
	ID           string         `json:"id"`
	IsDM         bool           `json:"isDM,omitempty"`
	JoinRule     string         `json:"joinRule,omitempty"`
	MemberCount  int            `json:"memberCount,omitempty"`
	Name         string         `json:"name,omitempty"`
	Topic        string         `json:"topic,omitempty"`
	Raw          map[string]any `json:"raw,omitempty"`
	Visibility   string         `json:"visibility,omitempty" tstype:"\"private\" | \"workspace\" | \"external\" | \"unknown\""`
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
	var encryption map[string]any
	if err := retryMatrixVoid(ctx, func() error {
		return cli.StateEvent(ctx, id.RoomID(req.RoomID), event.StateEncryption, "", &encryption)
	}); err == nil {
		info.Encrypted = true
		info.Raw["encryption"] = encryption
	} else if !errors.Is(err, mautrix.MNotFound) {
		return nil, err
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
	if directChats, err := c.fetchDirectChats(ctx, cli); err == nil {
		if userID, ok := directUserForRoom(directChats, id.RoomID(req.RoomID)); ok {
			info.IsDM = true
			info.DirectUserID = userID.String()
		}
	} else if !errors.Is(err, mautrix.MNotFound) && c.emit != nil {
		c.emit(OutboundEvent{"type": "error", "error": fmt.Sprintf("failed to fetch m.direct account data: %v", err)})
	}
	members, err := retryMatrix(ctx, func() (*mautrix.RespJoinedMembers, error) {
		return cli.JoinedMembers(ctx, id.RoomID(req.RoomID))
	})
	if err == nil {
		info.MemberCount = len(members.Joined)
		if !info.IsDM {
			info.IsDM = info.MemberCount == 2
		}
		info.Raw["joinedMembers"] = members.Joined
	} else if !errors.Is(err, mautrix.MNotFound) && !errors.Is(err, mautrix.MForbidden) {
		return nil, err
	}
	return json.Marshal(info)
}

func (c *Core) handleFetchRoomState(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixFetchRoomStateOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	events, err := retryMatrix(ctx, func() ([]*event.Event, error) {
		return cli.StateAsArray(ctx, id.RoomID(req.RoomID))
	})
	if err != nil {
		return nil, err
	}
	converted := make([]MatrixRoomStateEvent, 0, len(events))
	for _, evt := range events {
		converted = append(converted, c.convertRoomStateEvent(req.RoomID, evt))
	}
	return json.Marshal(MatrixFetchRoomStateResult{Events: converted, Raw: events})
}

func (c *Core) handleFetchRoomStateEvent(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixFetchRoomStateEventOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	var content map[string]any
	if err := retryMatrixVoid(ctx, func() error {
		return cli.StateEvent(ctx, id.RoomID(req.RoomID), event.NewEventType(req.EventType), req.StateKey, &content)
	}); err != nil {
		return nil, err
	}
	return json.Marshal(MatrixRoomStateEvent{
		Content:  content,
		Raw:      content,
		RoomID:   req.RoomID,
		StateKey: req.StateKey,
		Type:     req.EventType,
	})
}

func (c *Core) handleSendRoomStateEvent(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixSendRoomStateEventOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	resp, err := retryMatrix(ctx, func() (*mautrix.RespSendEvent, error) {
		return cli.SendStateEvent(ctx, id.RoomID(req.RoomID), event.NewEventType(req.EventType), req.StateKey, req.Content)
	})
	if err != nil {
		return nil, err
	}
	return json.Marshal(MatrixRawMessage{EventID: resp.EventID.String(), RoomID: req.RoomID, Raw: resp})
}

func (c *Core) handleResolveRoomAlias(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixResolveRoomAliasOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	resp, err := retryMatrix(ctx, func() (*mautrix.RespAliasResolve, error) {
		return cli.ResolveAlias(ctx, id.RoomAlias(req.Alias))
	})
	if err != nil {
		return nil, err
	}
	return json.Marshal(MatrixResolveRoomAliasResult{
		Raw:     resp,
		RoomID:  resp.RoomID.String(),
		Servers: resp.Servers,
	})
}

func (c *Core) handleListPublicRooms(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixListPublicRoomsOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	resp, err := retryMatrix(ctx, func() (*mautrix.RespPublicRooms, error) {
		return cli.PublicRooms(ctx, &mautrix.ReqPublicRooms{
			IncludeAllNetworks:   req.IncludeAllNetworks,
			Limit:                req.Limit,
			Since:                req.Since,
			ThirdPartyInstanceID: req.ThirdPartyInstanceID,
		})
	})
	if err != nil {
		return nil, err
	}
	rooms := make([]MatrixPublicRoom, 0, len(resp.Chunk))
	for _, room := range resp.Chunk {
		if room == nil {
			continue
		}
		allowed := make([]string, 0, len(room.AllowedRoomIDs))
		for _, roomID := range room.AllowedRoomIDs {
			allowed = append(allowed, roomID.String())
		}
		rooms = append(rooms, MatrixPublicRoom{
			AllowedRoomIDs:   allowed,
			AvatarURL:        string(room.AvatarURL),
			CanonicalAlias:   room.CanonicalAlias.String(),
			Encryption:       string(room.Encryption),
			GuestCanJoin:     room.GuestCanJoin,
			JoinRule:         string(room.JoinRule),
			Name:             room.Name,
			NumJoinedMembers: room.NumJoinedMembers,
			RoomID:           room.RoomID.String(),
			RoomType:         string(room.RoomType),
			RoomVersion:      string(room.RoomVersion),
			Topic:            room.Topic,
			WorldReadable:    room.WorldReadable,
		})
	}
	return json.Marshal(MatrixListPublicRoomsResult{
		NextBatch:              resp.NextBatch,
		PrevBatch:              resp.PrevBatch,
		Raw:                    resp,
		Rooms:                  rooms,
		TotalRoomCountEstimate: resp.TotalRoomCountEstimate,
	})
}

type MatrixOpenDMOptions struct {
	ForceCreate bool   `json:"forceCreate,omitempty"`
	UserID      string `json:"userId"`
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
	directChats, err := c.fetchDirectChats(ctx, cli)
	if err != nil && !errors.Is(err, mautrix.MNotFound) {
		return nil, err
	}
	if !req.ForceCreate {
		for _, roomID := range directChats[id.UserID(req.UserID)] {
			if roomID != "" {
				return json.Marshal(MatrixOpenDMResult{Raw: OutboundEvent{"reused": true}, RoomID: roomID.String()})
			}
		}
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
	return json.Marshal(MatrixOpenDMResult{Raw: resp, RoomID: resp.RoomID.String()})
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

type MatrixFetchRoomMembersOptions struct {
	At            string `json:"at,omitempty"`
	Membership    string `json:"membership,omitempty" tstype:"\"join\" | \"invite\" | \"leave\" | \"ban\" | \"knock\" | string"`
	NotMembership string `json:"notMembership,omitempty" tstype:"\"join\" | \"invite\" | \"leave\" | \"ban\" | \"knock\" | string"`
	RoomID        string `json:"roomId"`
}

type MatrixRoomMember struct {
	AvatarURL   string `json:"avatarUrl,omitempty"`
	DisplayName string `json:"displayName,omitempty"`
	Membership  string `json:"membership"`
	Raw         any    `json:"raw"`
	Reason      string `json:"reason,omitempty"`
	UserID      string `json:"userId"`
}

type MatrixRoomMembersResult struct {
	Members []MatrixRoomMember `json:"members"`
	Raw     any                `json:"raw"`
}

type MatrixKickUserOptions struct {
	Reason string `json:"reason,omitempty"`
	RoomID string `json:"roomId"`
	UserID string `json:"userId"`
}

type MatrixBanUserOptions struct {
	Reason       string `json:"reason,omitempty"`
	RedactEvents bool   `json:"redactEvents,omitempty"`
	RoomID       string `json:"roomId"`
	UserID       string `json:"userId"`
}

type MatrixUnbanUserOptions struct {
	Reason string `json:"reason,omitempty"`
	RoomID string `json:"roomId"`
	UserID string `json:"userId"`
}

func (c *Core) handleFetchRoomMembers(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixFetchRoomMembersOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	resp, err := retryMatrix(ctx, func() (*mautrix.RespMembers, error) {
		return cli.Members(ctx, id.RoomID(req.RoomID), mautrix.ReqMembers{
			At:            req.At,
			Membership:    event.Membership(req.Membership),
			NotMembership: event.Membership(req.NotMembership),
		})
	})
	if err != nil {
		return nil, err
	}
	members := make([]MatrixRoomMember, 0, len(resp.Chunk))
	for _, evt := range resp.Chunk {
		if evt == nil {
			continue
		}
		content := evt.Content.AsMember()
		userID := ""
		if evt.StateKey != nil {
			userID = *evt.StateKey
		}
		members = append(members, MatrixRoomMember{
			AvatarURL:   string(content.AvatarURL),
			DisplayName: content.Displayname,
			Membership:  string(content.Membership),
			Raw:         evt,
			Reason:      content.Reason,
			UserID:      userID,
		})
	}
	return json.Marshal(MatrixRoomMembersResult{Members: members, Raw: resp})
}

func (c *Core) handleKickUser(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixKickUserOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	_, err = retryMatrix(ctx, func() (*mautrix.RespKickUser, error) {
		return cli.KickUser(ctx, id.RoomID(req.RoomID), &mautrix.ReqKickUser{
			Reason: req.Reason,
			UserID: id.UserID(req.UserID),
		})
	})
	return c.emptyIfNil(err)
}

func (c *Core) handleBanUser(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixBanUserOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	_, err = retryMatrix(ctx, func() (*mautrix.RespBanUser, error) {
		return cli.BanUser(ctx, id.RoomID(req.RoomID), &mautrix.ReqBanUser{
			Reason:              req.Reason,
			UserID:              id.UserID(req.UserID),
			MSC4293RedactEvents: req.RedactEvents,
		})
	})
	return c.emptyIfNil(err)
}

func (c *Core) handleUnbanUser(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixUnbanUserOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	_, err = retryMatrix(ctx, func() (*mautrix.RespUnbanUser, error) {
		return cli.UnbanUser(ctx, id.RoomID(req.RoomID), &mautrix.ReqUnbanUser{
			Reason: req.Reason,
			UserID: id.UserID(req.UserID),
		})
	})
	return c.emptyIfNil(err)
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

func (c *Core) convertRoomStateEvent(roomID string, evt *event.Event) MatrixRoomStateEvent {
	if evt == nil {
		return MatrixRoomStateEvent{RoomID: roomID}
	}
	_ = evt.Content.ParseRaw(evt.Type)
	stateKey := ""
	if evt.StateKey != nil {
		stateKey = *evt.StateKey
	}
	if roomID == "" {
		roomID = evt.RoomID.String()
	}
	return MatrixRoomStateEvent{
		Content:        evt.Content.Raw,
		EventID:        evt.ID.String(),
		OriginServerTS: &evt.Timestamp,
		Raw:            evt,
		RoomID:         roomID,
		Sender:         evt.Sender.String(),
		StateKey:       stateKey,
		Type:           evt.Type.Type,
	}
}

func (c *Core) updateDirectChats(ctx context.Context, cli *mautrix.Client, userID id.UserID, roomID id.RoomID) {
	directChats := event.DirectChatsEventContent{}
	if err := retryMatrixVoid(ctx, func() error {
		return cli.GetAccountData(ctx, event.AccountDataDirectChats.Type, &directChats)
	}); err != nil && !errors.Is(err, mautrix.MNotFound) {
		if c.emit != nil {
			c.emit(OutboundEvent{"type": "error", "error": fmt.Sprintf("failed to fetch m.direct account data: %v", err)})
		}
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
		if c.emit != nil {
			c.emit(OutboundEvent{"type": "error", "error": fmt.Sprintf("failed to update m.direct account data: %v", err)})
		}
	}
}

func (c *Core) fetchDirectChats(ctx context.Context, cli *mautrix.Client) (event.DirectChatsEventContent, error) {
	directChats := event.DirectChatsEventContent{}
	err := retryMatrixVoid(ctx, func() error {
		return cli.GetAccountData(ctx, event.AccountDataDirectChats.Type, &directChats)
	})
	if errors.Is(err, mautrix.MNotFound) {
		return directChats, nil
	}
	return directChats, err
}

func directUserForRoom(directChats event.DirectChatsEventContent, roomID id.RoomID) (id.UserID, bool) {
	for userID, roomIDs := range directChats {
		for _, directRoomID := range roomIDs {
			if directRoomID == roomID {
				return userID, true
			}
		}
	}
	return "", false
}
