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
	messageEdits       map[id.EventID]OutboundEvent
	reactions          map[id.EventID]reactionSnapshot
	stores             *storeBundle
	userID             id.UserID
	deviceID           id.DeviceID
	cryptoStatus       string
	mu                 sync.Mutex
}

type OutboundEvent map[string]any

func New(emit func(OutboundEvent), host ...RuntimeHost) *Core {
	runtimeHost := DefaultRuntimeHost()
	if len(host) > 0 {
		runtimeHost = host[0]
	}
	return &Core{
		emit:         emit,
		host:         runtimeHost,
		messageEdits: make(map[id.EventID]OutboundEvent),
		reactions:    make(map[id.EventID]reactionSnapshot),
	}
}

func (c *Core) Handle(ctx context.Context, op string, payload []byte) ([]byte, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	switch op {
	case "init":
		return c.handleInit(ctx, payload)
	case "whoami":
		return c.handleWhoami(ctx)
	case "sync_once":
		return c.handleSyncOnce(ctx, payload)
	case "apply_sync_response":
		return c.handleApplySyncResponse(ctx, payload)
	case "post_message":
		return c.handlePostMessage(ctx, payload)
	case "post_media_message":
		return c.handlePostMediaMessage(ctx, payload)
	case "edit_message":
		return c.handleEditMessage(ctx, payload)
	case "delete_message":
		return c.handleDeleteMessage(ctx, payload)
	case "add_reaction":
		return c.handleAddReaction(ctx, payload)
	case "remove_reaction":
		return c.handleRemoveReaction(ctx, payload)
	case "send_ephemeral_event":
		return c.handleSendEphemeralEvent(ctx, payload)
	case "create_beeper_stream":
		return c.handleCreateBeeperStream(ctx, payload)
	case "publish_beeper_stream":
		return c.handlePublishBeeperStream(ctx, payload)
	case "unsubscribe_beeper_stream":
		return c.handleUnsubscribeBeeperStream(payload)
	case "set_typing":
		return c.handleSetTyping(ctx, payload)
	case "fetch_message":
		return c.handleFetchMessage(ctx, payload)
	case "fetch_messages":
		return c.handleFetchMessages(ctx, payload)
	case "mark_read":
		return c.handleMarkRead(ctx, payload)
	case "upload_media":
		return c.handleUploadMedia(ctx, payload)
	case "download_media":
		return c.handleDownloadMedia(ctx, payload)
	case "upload_encrypted_media":
		return c.handleUploadEncryptedMedia(ctx, payload)
	case "download_encrypted_media":
		return c.handleDownloadEncryptedMedia(ctx, payload)
	case "fetch_room":
		return c.handleFetchRoom(ctx, payload)
	case "open_dm":
		return c.handleOpenDM(ctx, payload)
	case "join_room":
		return c.handleJoinRoom(ctx, payload)
	case "leave_room":
		return c.handleLeaveRoom(ctx, payload)
	case "invite_user":
		return c.handleInviteUser(ctx, payload)
	case "fetch_joined_rooms":
		return c.handleFetchJoinedRooms(ctx)
	case "get_user":
		return c.handleGetUser(ctx, payload)
	case "list_room_threads":
		return c.handleListRoomThreads(ctx, payload)
	case "close":
		return c.handleClose()
	default:
		return nil, fmt.Errorf("unknown matrix core operation %q", op)
	}
}

func (c *Core) requireClient() (*mautrix.Client, error) {
	if c.client == nil {
		return nil, errors.New("matrix core is not initialized")
	}
	return c.client, nil
}

func (c *Core) handleClose() ([]byte, error) {
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
	c.messageEdits = make(map[id.EventID]OutboundEvent)
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
