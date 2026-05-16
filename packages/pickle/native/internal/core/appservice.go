package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

type matrixAppservice struct {
	appToken         string
	botUserID        id.UserID
	host             RuntimeHost
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
	HomeserverDomain string                       `json:"homeserverDomain,omitempty"`
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
	UserID string `json:"userId,omitempty"`
}

type MatrixAppservicePortalKey struct {
	ID       string `json:"id"`
	Receiver string `json:"receiver,omitempty"`
}

type MatrixAppserviceBridgeName struct {
	BeeperBridgeType     string `json:"beeperBridgeType,omitempty"`
	DefaultCommandPrefix string `json:"defaultCommandPrefix,omitempty"`
	DefaultPort          int    `json:"defaultPort,omitempty"`
	DisplayName          string `json:"displayName"`
	NetworkIcon          string `json:"networkIcon,omitempty"`
	NetworkID            string `json:"networkId"`
	NetworkURL           string `json:"networkUrl,omitempty"`
}

type MatrixAppserviceCreatePortalRoomOptions struct {
	AvatarURL       string                     `json:"avatarUrl,omitempty"`
	AutoJoinInvites bool                       `json:"autoJoinInvites,omitempty"`
	Bridge          MatrixAppserviceBridgeName `json:"bridge"`
	BridgeName      string                     `json:"bridgeName,omitempty"`
	InitialState    []MatrixRoomStateInput     `json:"initialState,omitempty"`
	InitialMembers  []string                   `json:"initialMembers,omitempty"`
	Invite          []string                   `json:"invite,omitempty"`
	IsDirect        bool                       `json:"isDirect,omitempty"`
	MessageRequest  bool                       `json:"messageRequest,omitempty"`
	Name            string                     `json:"name,omitempty"`
	PortalKey       MatrixAppservicePortalKey  `json:"portalKey"`
	RoomType        string                     `json:"roomType,omitempty"`
	Topic           string                     `json:"topic,omitempty"`
	UserID          string                     `json:"userId,omitempty"`
}

type MatrixAppserviceCreateManagementRoomOptions struct {
	AutoJoinInvites bool     `json:"autoJoinInvites,omitempty"`
	InitialMembers  []string `json:"initialMembers,omitempty"`
	Invite          []string `json:"invite,omitempty"`
	Name            string   `json:"name,omitempty"`
	Topic           string   `json:"topic,omitempty"`
	UserID          string   `json:"userId,omitempty"`
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

type MatrixAppserviceTransactionOptions struct {
	Transaction json.RawMessage `json:"transaction" tstype:"{ [key: string]: unknown }"`
}

type matrixAppserviceTransaction struct {
	Events         []*event.Event `json:"events"`
	ToDeviceEvents []*event.Event `json:"to_device,omitempty"`
}

type beeperStreamEventProcessor struct {
	handlers map[event.Type][]mautrix.EventHandler
}

func newBeeperStreamEventProcessor() *beeperStreamEventProcessor {
	return &beeperStreamEventProcessor{handlers: make(map[event.Type][]mautrix.EventHandler)}
}

func (ep *beeperStreamEventProcessor) On(evtType event.Type, handler mautrix.EventHandler) {
	ep.handlers[evtType] = append(ep.handlers[evtType], handler)
}

func (ep *beeperStreamEventProcessor) Dispatch(ctx context.Context, evt *event.Event) {
	if ep == nil || evt == nil {
		return
	}
	for _, handler := range ep.handlers[evt.Type] {
		handler(ctx, evt)
	}
}

func (c *Core) handleInitAppservice(ctx context.Context, payload []byte) ([]byte, error) {
	var req MatrixAppserviceInitOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.Homeserver == "" {
		return nil, errors.New("homeserver is required")
	}
	if req.Registration.AppToken == "" || req.Registration.SenderLocalpart == "" || req.Registration.ID == "" {
		return nil, errors.New("registration id, asToken and senderLocalpart are required")
	}
	homeserverDomain := req.HomeserverDomain
	if homeserverDomain == "" {
		var err error
		homeserverDomain, err = homeserverDomainFromURL(req.Homeserver)
		if err != nil {
			return nil, err
		}
	}
	as := &matrixAppservice{
		appToken:         req.Registration.AppToken,
		botUserID:        id.NewUserID(req.Registration.SenderLocalpart, homeserverDomain),
		host:             c.host,
		homeserver:       req.Homeserver,
		homeserverDomain: homeserverDomain,
		stateStore:       mautrix.NewMemoryStateStore(),
	}
	c.appservice = as
	return json.Marshal(MatrixAppserviceInfo{BotUserID: as.botUserID.String(), ID: req.Registration.ID})
}

func (c *Core) handleAppserviceApplyTransaction(ctx context.Context, payload []byte) ([]byte, error) {
	if c.appserviceProcessor == nil {
		return nil, errors.New("appservice transaction pipeline unavailable")
	}
	var req MatrixAppserviceTransactionOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if len(req.Transaction) == 0 {
		return nil, errors.New("missing appservice transaction")
	}
	var txn matrixAppserviceTransaction
	if err := json.Unmarshal(req.Transaction, &txn); err != nil {
		return nil, err
	}
	if c.client != nil && len(txn.ToDeviceEvents) > 0 {
		c.client.Log.Debug().
			Int("events", len(txn.Events)).
			Int("to_device_events", len(txn.ToDeviceEvents)).
			Msg("Applying appservice transaction")
	}
	c.dispatchAppserviceEvents(ctx, txn.Events, event.MessageEventType)
	c.dispatchAppserviceEvents(ctx, txn.ToDeviceEvents, event.ToDeviceEventType)
	return c.empty()
}

func (c *Core) dispatchAppserviceEvents(ctx context.Context, events []*event.Event, class event.TypeClass) {
	for _, evt := range events {
		if evt == nil {
			continue
		}
		evt.Type.Class = class
		if err := evt.Content.ParseRaw(evt.Type); err != nil && c.client != nil && (evt.Type == event.ToDeviceBeeperStreamSubscribe || evt.Type == event.ToDeviceEncrypted || evt.Type == event.ToDeviceBeeperStreamUpdate) {
			c.client.Log.Debug().Err(err).Str("event_type", evt.Type.Type).Msg("Failed to parse appservice stream event content")
		}
		if c.client != nil && class == event.ToDeviceEventType && (evt.Type == event.ToDeviceBeeperStreamSubscribe || evt.Type == event.ToDeviceEncrypted || evt.Type == event.ToDeviceBeeperStreamUpdate) {
			subscribe := evt.Content.AsBeeperStreamSubscribe()
			encrypted := evt.Content.AsEncrypted()
			c.client.Log.Debug().
				Str("event_type", evt.Type.Type).
				Str("sender", evt.Sender.String()).
				Str("to_user_id", evt.ToUserID.String()).
				Str("to_device_id", evt.ToDeviceID.String()).
				Str("room_id", subscribe.RoomID.String()).
				Str("event_id", subscribe.EventID.String()).
				Str("subscriber_device_id", subscribe.DeviceID.String()).
				Str("encrypted_stream_id", encrypted.StreamID).
				Msg("Dispatching appservice stream to-device event")
		}
		c.appserviceProcessor.Dispatch(ctx, evt)
	}
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
	resp, err := intent.CreateRoom(ctx, createReq)
	if err != nil {
		return nil, err
	}
	return json.Marshal(MatrixCreateRoomResult{Raw: resp, RoomID: resp.RoomID.String()})
}

func (c *Core) handleAppserviceCreatePortalRoom(ctx context.Context, payload []byte) ([]byte, error) {
	var req MatrixAppserviceCreatePortalRoomOptions
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
	createReq := c.appservice.makePortalCreateRoomRequest(req, intent.UserID)
	resp, err := intent.CreateRoom(ctx, createReq)
	if err != nil {
		return nil, err
	}
	return json.Marshal(MatrixCreateRoomResult{Raw: resp, RoomID: resp.RoomID.String()})
}

func (c *Core) handleAppserviceCreateManagementRoom(ctx context.Context, payload []byte) ([]byte, error) {
	var req MatrixAppserviceCreateManagementRoomOptions
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
	createReq := c.appservice.makeManagementCreateRoomRequest(req)
	resp, err := intent.CreateRoom(ctx, createReq)
	if err != nil {
		return nil, err
	}
	return json.Marshal(MatrixCreateRoomResult{Raw: resp, RoomID: resp.RoomID.String()})
}

func (as *matrixAppservice) makePortalCreateRoomRequest(req MatrixAppserviceCreatePortalRoomOptions, _ id.UserID) *mautrix.ReqCreateRoom {
	bridgeBot := as.botUserID
	roomType := req.RoomType
	if roomType == "" && req.IsDirect {
		roomType = "dm"
	} else if roomType == "" {
		roomType = "default"
	}
	localRoomID := as.deterministicPortalRoomID(req.PortalKey)
	bridgeName := req.BridgeName
	if bridgeName == "" {
		bridgeName = req.Bridge.NetworkID
	}
	createReq := &mautrix.ReqCreateRoom{
		BeeperBridgeAccountID: req.PortalKey.Receiver,
		BeeperBridgeName:      bridgeName,
		BeeperLocalRoomID:     localRoomID,
		CreationContent:       map[string]any{},
		InitialState:          make([]*event.Event, 0, 5),
		Invite:                toUserIDs(req.Invite),
		IsDirect:              req.IsDirect,
		MeowRoomID:            localRoomID,
		Name:                  req.Name,
		PowerLevelOverride:    defaultBridgePowerLevels(bridgeBot),
		Preset:                "private_chat",
		Topic:                 req.Topic,
		Visibility:            "private",
	}
	if req.AutoJoinInvites {
		createReq.BeeperAutoJoinInvites = true
		createReq.BeeperInitialMembers = toUserIDs(req.InitialMembers)
		createReq.Invite = appendMissingUserIDs(createReq.Invite, createReq.BeeperInitialMembers...)
	}
	if roomType == "space" {
		createReq.CreationContent["type"] = event.RoomTypeSpace
	}
	bridgeInfoStateKey := bridgeName
	if bridgeInfoStateKey == "" {
		bridgeInfoStateKey = req.Bridge.NetworkID
	}
	bridgeInfo := bridgeInfoContent(req, bridgeBot, roomType)
	for _, state := range req.InitialState {
		stateKey := state.StateKey
		createReq.InitialState = append(createReq.InitialState, &event.Event{
			Type:     event.NewEventType(state.Type),
			StateKey: &stateKey,
			Content:  event.Content{Raw: state.Content},
		})
	}
	createReq.InitialState = append(createReq.InitialState,
		bridgeStateEvent(event.StateHalfShotBridge, bridgeInfoStateKey, bridgeInfo),
		bridgeStateEvent(event.StateBridge, bridgeInfoStateKey, bridgeInfo),
		functionalMembersStateEvent(bridgeBot),
	)
	return createReq
}

func (as *matrixAppservice) makeManagementCreateRoomRequest(req MatrixAppserviceCreateManagementRoomOptions) *mautrix.ReqCreateRoom {
	createReq := &mautrix.ReqCreateRoom{
		Invite:     toUserIDs(req.Invite),
		IsDirect:   false,
		Name:       req.Name,
		Preset:     "private_chat",
		Topic:      req.Topic,
		Visibility: "private",
	}
	if req.AutoJoinInvites {
		createReq.BeeperAutoJoinInvites = true
		createReq.BeeperInitialMembers = toUserIDs(req.InitialMembers)
		createReq.Invite = appendMissingUserIDs(createReq.Invite, createReq.BeeperInitialMembers...)
	}
	return createReq
}

func (as *matrixAppservice) deterministicPortalRoomID(portalKey MatrixAppservicePortalKey) id.RoomID {
	return id.RoomID(fmt.Sprintf("!%s.%s:%s", portalKey.ID, portalKey.Receiver, as.homeserverDomain))
}

func defaultBridgePowerLevels(bridgeBot id.UserID) *event.PowerLevelsEventContent {
	return &event.PowerLevelsEventContent{
		Events: map[string]int{
			event.StateBridge.Type:         100,
			event.StateHalfShotBridge.Type: 100,
			event.StateTombstone.Type:      100,
			event.StateServerACL.Type:      100,
			event.StateEncryption.Type:     100,
		},
		Users: map[id.UserID]int{
			bridgeBot: 9001,
		},
	}
}

func bridgeInfoContent(req MatrixAppserviceCreatePortalRoomOptions, bridgeBot id.UserID, roomType string) event.BridgeEventContent {
	bridgeType := req.Bridge.BeeperBridgeType
	if bridgeType == "" {
		bridgeType = req.Bridge.NetworkID
	}
	content := event.BridgeEventContent{
		BridgeBot: bridgeBot,
		Creator:   bridgeBot,
		Protocol: event.BridgeInfoSection{
			ID:          bridgeType,
			DisplayName: req.Bridge.DisplayName,
			AvatarURL:   id.ContentURIString(req.Bridge.NetworkIcon),
			ExternalURL: req.Bridge.NetworkURL,
		},
		Channel: event.BridgeInfoSection{
			ID:             req.PortalKey.ID,
			DisplayName:    req.Name,
			AvatarURL:      id.ContentURIString(req.AvatarURL),
			Receiver:       req.PortalKey.Receiver,
			MessageRequest: req.MessageRequest,
		},
		BeeperRoomTypeV2: roomType,
	}
	if req.IsDirect || roomType == "dm" || roomType == "group_dm" {
		content.BeeperRoomType = "dm"
	}
	return content
}

func bridgeStateEvent(eventType event.Type, stateKey string, content event.BridgeEventContent) *event.Event {
	return &event.Event{
		Type:     eventType,
		StateKey: &stateKey,
		Content:  event.Content{Parsed: &content},
	}
}

func functionalMembersStateEvent(bridgeBot id.UserID) *event.Event {
	stateKey := ""
	return &event.Event{
		Type:     event.StateElementFunctionalMembers,
		StateKey: &stateKey,
		Content: event.Content{Parsed: &event.ElementFunctionalMembersContent{
			ServiceMembers: []id.UserID{bridgeBot},
		}},
	}
}

func appendMissingUserIDs(input []id.UserID, userIDs ...id.UserID) []id.UserID {
	for _, userID := range userIDs {
		if userID == "" {
			continue
		}
		found := false
		for _, existing := range input {
			if existing == userID {
				found = true
				break
			}
		}
		if !found {
			input = append(input, userID)
		}
	}
	return input
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
	configureHTTPClient(cli, as.host)
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
			return botErr
		}
		if _, inviteErr := bot.InviteUser(ctx, roomID, &mautrix.ReqInviteUser{UserID: cli.UserID}); inviteErr != nil {
			return inviteErr
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

func homeserverDomainFromURL(rawURL string) (string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}
	hostname := parsed.Hostname()
	if hostname == "" {
		return "", fmt.Errorf("failed to derive homeserverDomain from %q", rawURL)
	}
	return hostname, nil
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
