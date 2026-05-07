package core

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/beeperstream"
	"maunium.net/go/mautrix/crypto"
	"maunium.net/go/mautrix/crypto/backup"
	"maunium.net/go/mautrix/crypto/cryptohelper"
	"maunium.net/go/mautrix/id"
)

type Core struct {
	client             *mautrix.Client
	appservice         *matrixAppservice
	crypto             *cryptohelper.CryptoHelper
	cryptoStore        crypto.Store
	backupKey          *backup.MegolmBackupKey
	backupVersion      id.KeyBackupVersion
	beeperStream       *beeperstream.Helper
	emit               func(OutboundEvent)
	host               RuntimeHost
	nextBatch          string
	pickleKey          []byte
	pendingDecryptions []pendingDecryption
	skipNextSync       bool
	emittedTimelineIDs map[id.EventID]struct{}
	messageEdits       map[id.EventID]*MatrixMessageEvent
	reactions          map[id.EventID]reactionSnapshot
	stores             *storeBundle
	userID             id.UserID
	deviceID           id.DeviceID
	cryptoStatus       string
	mu                 sync.Mutex
	syncMu             sync.Mutex
	syncLoopMu         sync.Mutex
	syncLoopCancel     context.CancelFunc
	syncLoopDone       chan struct{}
}

type OutboundEvent map[string]any

func New(emit func(OutboundEvent), host ...RuntimeHost) *Core {
	runtimeHost := DefaultRuntimeHost()
	if len(host) > 0 {
		runtimeHost = host[0]
	}
	return &Core{
		emit:               emit,
		host:               runtimeHost,
		emittedTimelineIDs: make(map[id.EventID]struct{}),
		messageEdits:       make(map[id.EventID]*MatrixMessageEvent),
		reactions:          make(map[id.EventID]reactionSnapshot),
	}
}

func (c *Core) Handle(ctx context.Context, op string, payload []byte) ([]byte, error) {
	if op == opSyncOnce {
		return c.handleSyncOnce(ctx, payload)
	}
	if op == opStartSync {
		return c.handleStartSync(payload)
	}
	if op == opStopSync {
		return c.handleStopSync()
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	switch op {
	case opInit:
		return c.handleInit(ctx, payload)
	case opWhoami:
		return c.handleWhoami(ctx)
	case opLogout:
		return c.handleLogout(ctx)
	case opGetCryptoStatus:
		return c.handleGetCryptoStatus()
	case opRawRequest:
		return c.handleRawRequest(ctx, payload)
	case opInitAppservice:
		return c.handleInitAppservice(ctx, payload)
	case opAppserviceEnsureRegistered:
		return c.handleAppserviceEnsureRegistered(ctx, payload)
	case opAppserviceEnsureJoined:
		return c.handleAppserviceEnsureJoined(ctx, payload)
	case opAppserviceCreateRoom:
		return c.handleAppserviceCreateRoom(ctx, payload)
	case opAppserviceCreatePortalRoom:
		return c.handleAppserviceCreatePortalRoom(ctx, payload)
	case opAppserviceCreateManagementRoom:
		return c.handleAppserviceCreateManagementRoom(ctx, payload)
	case opAppserviceSendMessage:
		return c.handleAppserviceSendMessage(ctx, payload)
	case opAppserviceBatchSend:
		return c.handleAppserviceBatchSend(ctx, payload)
	case opApplySyncResponse:
		return c.handleApplySyncResponse(ctx, payload)
	case opGetAccountData:
		return c.handleGetAccountData(ctx, payload)
	case opSetAccountData:
		return c.handleSetAccountData(ctx, payload)
	case opGetRoomAccountData:
		return c.handleGetRoomAccountData(ctx, payload)
	case opSetRoomAccountData:
		return c.handleSetRoomAccountData(ctx, payload)
	case opSendToDevice:
		return c.handleSendToDevice(ctx, payload)
	case opSendReceipt:
		return c.handleSendReceipt(ctx, payload)
	case opPostMessage:
		return c.handlePostMessage(ctx, payload)
	case opPostMediaMessage:
		return c.handlePostMediaMessage(ctx, payload)
	case opEditMessage:
		return c.handleEditMessage(ctx, payload)
	case opDeleteMessage:
		return c.handleDeleteMessage(ctx, payload)
	case opAddReaction:
		return c.handleAddReaction(ctx, payload)
	case opRemoveReaction:
		return c.handleRemoveReaction(ctx, payload)
	case opSendEphemeralEvent:
		return c.handleSendEphemeralEvent(ctx, payload)
	case opCreateBeeperStream:
		return c.handleCreateBeeperStream(ctx, payload)
	case opRegisterBeeperStream:
		return c.handleRegisterBeeperStream(ctx, payload)
	case opPublishBeeperStream:
		return c.handlePublishBeeperStream(ctx, payload)
	case opUnsubscribeBeeperStream:
		return c.handleUnsubscribeBeeperStream(payload)
	case opSetTyping:
		return c.handleSetTyping(ctx, payload)
	case opFetchMessage:
		return c.handleFetchMessage(ctx, payload)
	case opFetchMessages:
		return c.handleFetchMessages(ctx, payload)
	case opMarkRead:
		return c.handleMarkRead(ctx, payload)
	case opUploadMedia:
		return c.handleUploadMedia(ctx, payload)
	case opDownloadMedia:
		return c.handleDownloadMedia(ctx, payload)
	case opDownloadMediaThumbnail:
		return c.handleDownloadMediaThumbnail(ctx, payload)
	case opUploadEncryptedMedia:
		return c.handleUploadEncryptedMedia(ctx, payload)
	case opDownloadEncryptedMedia:
		return c.handleDownloadEncryptedMedia(ctx, payload)
	case opCreateRoom:
		return c.handleCreateRoom(ctx, payload)
	case opFetchRoom:
		return c.handleFetchRoom(ctx, payload)
	case opFetchRoomState:
		return c.handleFetchRoomState(ctx, payload)
	case opFetchRoomStateEvent:
		return c.handleFetchRoomStateEvent(ctx, payload)
	case opSendRoomStateEvent:
		return c.handleSendRoomStateEvent(ctx, payload)
	case opResolveRoomAlias:
		return c.handleResolveRoomAlias(ctx, payload)
	case opListPublicRooms:
		return c.handleListPublicRooms(ctx, payload)
	case opOpenDM:
		return c.handleOpenDM(ctx, payload)
	case opJoinRoom:
		return c.handleJoinRoom(ctx, payload)
	case opLeaveRoom:
		return c.handleLeaveRoom(ctx, payload)
	case opInviteUser:
		return c.handleInviteUser(ctx, payload)
	case opFetchRoomMembers:
		return c.handleFetchRoomMembers(ctx, payload)
	case opKickUser:
		return c.handleKickUser(ctx, payload)
	case opBanUser:
		return c.handleBanUser(ctx, payload)
	case opUnbanUser:
		return c.handleUnbanUser(ctx, payload)
	case opFetchJoinedRooms:
		return c.handleFetchJoinedRooms(ctx)
	case opGetUser:
		return c.handleGetUser(ctx, payload)
	case opGetOwnDisplayName:
		return c.handleGetOwnDisplayName(ctx)
	case opSetOwnDisplayName:
		return c.handleSetOwnDisplayName(ctx, payload)
	case opGetOwnAvatarURL:
		return c.handleGetOwnAvatarURL(ctx)
	case opSetOwnAvatarURL:
		return c.handleSetOwnAvatarURL(ctx, payload)
	case opListRoomThreads:
		return c.handleListRoomThreads(ctx, payload)
	case opClose:
		return c.handleClose()
	default:
		return nil, fmt.Errorf("unknown matrix core operation %q", op)
	}
}

func (c *Core) HandleBytes(ctx context.Context, op string, payload []byte, data []byte) (any, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	switch op {
	case "post_media_message_bytes":
		resp, err := c.handlePostMediaMessageBytes(ctx, payload, data)
		return string(resp), err
	case "upload_media_bytes":
		resp, err := c.handleUploadMediaBytes(ctx, payload, data)
		return string(resp), err
	case "download_media_bytes":
		return c.handleDownloadMediaBytes(ctx, payload)
	case "download_media_thumbnail_bytes":
		return c.handleDownloadMediaThumbnailBytes(ctx, payload)
	case "upload_encrypted_media_bytes":
		resp, err := c.handleUploadEncryptedMediaBytes(ctx, payload, data)
		return string(resp), err
	case "download_encrypted_media_bytes":
		return c.handleDownloadEncryptedMediaBytes(ctx, payload)
	default:
		return nil, fmt.Errorf("unknown matrix core byte operation %q", op)
	}
}

func (c *Core) requireClient() (*mautrix.Client, error) {
	if c.client == nil {
		return nil, errors.New("matrix core is not initialized")
	}
	return c.client, nil
}

func (c *Core) handleClose() ([]byte, error) {
	if _, err := c.handleStopSync(); err != nil {
		return nil, err
	}
	var err error
	if c.crypto != nil {
		err = c.crypto.Close()
	}
	c.client = nil
	c.crypto = nil
	c.cryptoStore = nil
	c.backupKey = nil
	c.backupVersion = ""
	if c.beeperStream != nil {
		_ = c.beeperStream.Close()
	}
	c.beeperStream = nil
	c.nextBatch = ""
	c.pendingDecryptions = nil
	c.skipNextSync = false
	c.emittedTimelineIDs = make(map[id.EventID]struct{})
	c.messageEdits = make(map[id.EventID]*MatrixMessageEvent)
	c.reactions = make(map[id.EventID]reactionSnapshot)
	c.stores = nil
	c.userID = ""
	c.deviceID = ""
	c.cryptoStatus = "disabled"
	c.pickleKey = nil
	return c.emptyIfNil(err)
}

func (c *Core) emptyIfNil(err error) ([]byte, error) {
	if err != nil {
		return nil, err
	}
	return c.empty()
}

func (c *Core) empty() ([]byte, error) {
	return []byte("{}"), nil
}
