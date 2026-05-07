package core

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

type matrixAppservice struct {
	appToken         string
	botUserID        id.UserID
	homeserver       string
	homeserverDomain string
	stateStore       mautrix.StateStore
}

type MatrixAppserviceNamespace struct {
	Exclusive bool   `json:"exclusive"`
	Regex     string `json:"regex"`
}

type MatrixAppserviceNamespaces struct {
	Aliases []MatrixAppserviceNamespace `json:"aliases,omitempty"`
	Rooms   []MatrixAppserviceNamespace `json:"rooms,omitempty"`
	Users   []MatrixAppserviceNamespace `json:"users,omitempty"`
}

type MatrixAppserviceRegistration struct {
	AppToken        string                     `json:"asToken"`
	EphemeralEvents bool                       `json:"ephemeralEvents,omitempty"`
	HSToken         string                     `json:"hsToken"`
	ID              string                     `json:"id"`
	MSC3202         bool                       `json:"msc3202,omitempty"`
	MSC4190         bool                       `json:"msc4190,omitempty"`
	Namespaces      MatrixAppserviceNamespaces `json:"namespaces"`
	Protocols       []string                   `json:"protocols,omitempty"`
	RateLimited     *bool                      `json:"rateLimited,omitempty"`
	SenderLocalpart string                     `json:"senderLocalpart"`
	URL             string                     `json:"url"`
}

type MatrixAppserviceInitOptions struct {
	Homeserver       string                       `json:"homeserver"`
	HomeserverDomain string                       `json:"homeserverDomain"`
	Registration     MatrixAppserviceRegistration `json:"registration"`
}

type MatrixAppserviceInfo struct {
	BotUserID string `json:"botUserId"`
	ID        string `json:"id"`
}

type MatrixAppserviceUserOptions struct {
	UserID string `json:"userId"`
}

type MatrixAppserviceRoomUserOptions struct {
	RoomID string `json:"roomId"`
	UserID string `json:"userId"`
}

type MatrixAppserviceCreateRoomOptions struct {
	MatrixCreateRoomOptions
	BeeperAutoJoinInvites bool     `json:"beeperAutoJoinInvites,omitempty"`
	BeeperBridgeAccountID string   `json:"beeperBridgeAccountId,omitempty"`
	BeeperBridgeName      string   `json:"beeperBridgeName,omitempty"`
	BeeperInitialMembers  []string `json:"beeperInitialMembers,omitempty"`
	BeeperLocalRoomID     string   `json:"beeperLocalRoomId,omitempty"`
	MeowCreateTS          int64    `json:"meowCreateTs,omitempty"`
	MeowRoomID            string   `json:"meowRoomId,omitempty"`
	UserID                string   `json:"userId,omitempty"`
}

type MatrixAppserviceSendMessageOptions struct {
	Content       OutboundEvent `json:"content" tstype:"{ [key: string]: unknown }"`
	EventType     string        `json:"eventType,omitempty"`
	RoomID        string        `json:"roomId"`
	Timestamp     int64         `json:"timestamp,omitempty"`
	TransactionID string        `json:"transactionId,omitempty"`
	UserID        string        `json:"userId,omitempty"`
}

type MatrixAppserviceBatchEvent struct {
	Content   OutboundEvent `json:"content" tstype:"{ [key: string]: unknown }"`
	EventID   string        `json:"eventId,omitempty"`
	EventType string        `json:"eventType,omitempty"`
	RoomID    string        `json:"roomId,omitempty"`
	Sender    string        `json:"sender"`
	StateKey  *string       `json:"stateKey,omitempty"`
	Timestamp int64         `json:"timestamp,omitempty"`
}

type MatrixAppserviceBatchSendOptions struct {
	Events              []MatrixAppserviceBatchEvent `json:"events"`
	Forward             bool                         `json:"forward,omitempty"`
	ForwardIfNoMessages bool                         `json:"forwardIfNoMessages,omitempty"`
	MarkReadBy          string                       `json:"markReadBy,omitempty"`
	RoomID              string                       `json:"roomId"`
	SendNotification    bool                         `json:"sendNotification,omitempty"`
}

type MatrixAppserviceBatchSendResult struct {
	EventIDs []string `json:"eventIds"`
	Raw      any      `json:"raw"`
}

func (c *Core) handleInitAppservice(ctx context.Context, payload []byte) ([]byte, error) {
	var req MatrixAppserviceInitOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.Homeserver == "" || req.HomeserverDomain == "" {
		return nil, errors.New("homeserver and homeserverDomain are required")
	}
	if req.Registration.AppToken == "" || req.Registration.SenderLocalpart == "" || req.Registration.ID == "" {
		return nil, errors.New("registration id, asToken and senderLocalpart are required")
	}
	as := &matrixAppservice{
		appToken:         req.Registration.AppToken,
		botUserID:        id.NewUserID(req.Registration.SenderLocalpart, req.HomeserverDomain),
		homeserver:       req.Homeserver,
		homeserverDomain: req.HomeserverDomain,
		stateStore:       mautrix.NewMemoryStateStore(),
	}
	c.appservice = as
	return json.Marshal(MatrixAppserviceInfo{BotUserID: as.botUserID.String(), ID: req.Registration.ID})
}

func (c *Core) handleAppserviceEnsureRegistered(ctx context.Context, payload []byte) ([]byte, error) {
	intent, _, err := c.appserviceIntent(payload)
	if err != nil {
		return nil, err
	}
	return c.emptyIfNil(c.appservice.ensureRegistered(ctx, intent))
}

func (c *Core) handleAppserviceEnsureJoined(ctx context.Context, payload []byte) ([]byte, error) {
	var req MatrixAppserviceRoomUserOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	intent, err := c.requireAppserviceIntent(req.UserID)
	if err != nil {
		return nil, err
	}
	return c.emptyIfNil(c.appservice.ensureJoined(ctx, intent, id.RoomID(req.RoomID)))
}

func (c *Core) handleAppserviceCreateRoom(ctx context.Context, payload []byte) ([]byte, error) {
	var req MatrixAppserviceCreateRoomOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	intent, err := c.requireAppserviceIntent(req.UserID)
	if err != nil {
		return nil, err
	}
	if err := c.appservice.ensureRegistered(ctx, intent); err != nil {
		return nil, err
	}
	createReq := makeCreateRoomRequest(req.MatrixCreateRoomOptions)
	createReq.MeowRoomID = id.RoomID(req.MeowRoomID)
	createReq.MeowCreateTS = req.MeowCreateTS
	createReq.BeeperInitialMembers = toUserIDs(req.BeeperInitialMembers)
	createReq.BeeperAutoJoinInvites = req.BeeperAutoJoinInvites
	createReq.BeeperLocalRoomID = id.RoomID(req.BeeperLocalRoomID)
	createReq.BeeperBridgeName = req.BeeperBridgeName
	createReq.BeeperBridgeAccountID = req.BeeperBridgeAccountID
	resp, err := intent.CreateRoom(ctx, createReq)
	if err != nil {
		return nil, err
	}
	return json.Marshal(MatrixCreateRoomResult{Raw: resp, RoomID: resp.RoomID.String()})
}

func (c *Core) handleAppserviceSendMessage(ctx context.Context, payload []byte) ([]byte, error) {
	var req MatrixAppserviceSendMessageOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	intent, err := c.requireAppserviceIntent(req.UserID)
	if err != nil {
		return nil, err
	}
	if err := c.appservice.ensureJoined(ctx, intent, id.RoomID(req.RoomID)); err != nil {
		return nil, err
	}
	eventType := req.EventType
	if eventType == "" {
		eventType = event.EventMessage.Type
	}
	resp, err := intent.SendMessageEvent(ctx, id.RoomID(req.RoomID), event.NewEventType(eventType), req.Content, mautrix.ReqSendEvent{
		Timestamp:     req.Timestamp,
		TransactionID: req.TransactionID,
	})
	if err != nil {
		return nil, err
	}
	return json.Marshal(MatrixRawMessage{Raw: resp, EventID: resp.EventID.String(), RoomID: req.RoomID})
}

func (c *Core) handleAppserviceBatchSend(ctx context.Context, payload []byte) ([]byte, error) {
	as, err := c.requireAppservice()
	if err != nil {
		return nil, err
	}
	var req MatrixAppserviceBatchSendOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	events := make([]*event.Event, 0, len(req.Events))
	for _, evt := range req.Events {
		eventType := evt.EventType
		if eventType == "" {
			eventType = event.EventMessage.Type
		}
		events = append(events, &event.Event{
			Content:   event.Content{Raw: evt.Content},
			ID:        id.EventID(evt.EventID),
			RoomID:    id.RoomID(evt.RoomID),
			Sender:    id.UserID(evt.Sender),
			StateKey:  evt.StateKey,
			Timestamp: evt.Timestamp,
			Type:      event.NewEventType(eventType),
		})
	}
	bot, err := as.client(as.botUserID)
	if err != nil {
		return nil, err
	}
	resp, err := bot.BeeperBatchSend(ctx, id.RoomID(req.RoomID), &mautrix.ReqBeeperBatchSend{
		Events:              events,
		Forward:             req.Forward,
		ForwardIfNoMessages: req.ForwardIfNoMessages,
		MarkReadBy:          id.UserID(req.MarkReadBy),
		SendNotification:    req.SendNotification,
	})
	if err != nil {
		return nil, err
	}
	eventIDs := make([]string, 0, len(resp.EventIDs))
	for _, eventID := range resp.EventIDs {
		eventIDs = append(eventIDs, eventID.String())
	}
	return json.Marshal(MatrixAppserviceBatchSendResult{EventIDs: eventIDs, Raw: resp})
}

func (c *Core) requireAppservice() (*matrixAppservice, error) {
	if c.appservice == nil {
		return nil, errors.New("appservice is not initialized")
	}
	return c.appservice, nil
}

func (c *Core) requireAppserviceIntent(userID string) (*mautrix.Client, error) {
	as, err := c.requireAppservice()
	if err != nil {
		return nil, err
	}
	if userID == "" {
		userID = as.botUserID.String()
	}
	return as.client(id.UserID(userID))
}

func (c *Core) appserviceIntent(payload []byte) (*mautrix.Client, MatrixAppserviceUserOptions, error) {
	var req MatrixAppserviceUserOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, req, err
	}
	intent, err := c.requireAppserviceIntent(req.UserID)
	return intent, req, err
}

func makeCreateRoomRequest(req MatrixCreateRoomOptions) *mautrix.ReqCreateRoom {
	invitees := toUserIDs(req.Invite)
	initialState := make([]*event.Event, 0, len(req.InitialState))
	for _, state := range req.InitialState {
		stateKey := state.StateKey
		initialState = append(initialState, &event.Event{
			Type:     event.NewEventType(state.Type),
			StateKey: &stateKey,
			Content:  event.Content{Raw: state.Content},
		})
	}
	return &mautrix.ReqCreateRoom{
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
	}
}

func (as *matrixAppservice) client(userID id.UserID) (*mautrix.Client, error) {
	if userID == "" {
		userID = as.botUserID
	}
	cli, err := mautrix.NewClient(as.homeserver, userID, as.appToken)
	if err != nil {
		return nil, err
	}
	cli.SetAppServiceUserID = true
	cli.StateStore = as.stateStore
	return cli, nil
}

func (as *matrixAppservice) ensureRegistered(ctx context.Context, cli *mautrix.Client) error {
	_, err := cli.MakeRequest(ctx, http.MethodPost, cli.BuildClientURL("v3", "register"), &mautrix.ReqRegister[any]{
		Username:     appserviceLocalpart(cli.UserID),
		Type:         mautrix.AuthTypeAppservice,
		InhibitLogin: true,
	}, nil)
	if err != nil && !errors.Is(err, mautrix.MUserInUse) {
		return err
	}
	return nil
}

func (as *matrixAppservice) ensureJoined(ctx context.Context, cli *mautrix.Client, roomID id.RoomID) error {
	if cli.StateStore != nil && cli.StateStore.IsInRoom(ctx, roomID, cli.UserID) {
		return nil
	}
	if err := as.ensureRegistered(ctx, cli); err != nil {
		return err
	}
	resp, err := cli.JoinRoomByID(ctx, roomID)
	if err != nil {
		bot, botErr := as.client(as.botUserID)
		if botErr != nil {
			return err
		}
		if _, inviteErr := bot.InviteUser(ctx, roomID, &mautrix.ReqInviteUser{UserID: cli.UserID}); inviteErr != nil {
			return err
		}
		resp, err = cli.JoinRoomByID(ctx, roomID)
		if err != nil {
			return err
		}
	}
	if cli.StateStore != nil {
		return cli.StateStore.SetMembership(ctx, resp.RoomID, cli.UserID, event.MembershipJoin)
	}
	return nil
}

func appserviceLocalpart(userID id.UserID) string {
	localpart, _, err := userID.Parse()
	if err != nil {
		return string(userID)
	}
	return localpart
}

func toUserIDs(input []string) []id.UserID {
	output := make([]id.UserID, 0, len(input))
	for _, userID := range input {
		if userID != "" {
			output = append(output, id.UserID(userID))
		}
	}
	return output
}
