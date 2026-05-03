package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/beeperstream"
	"maunium.net/go/mautrix/crypto"
	"maunium.net/go/mautrix/crypto/backup"
	"maunium.net/go/mautrix/crypto/cryptohelper"
	"maunium.net/go/mautrix/crypto/ssss"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

type MatrixCoreInitOptions struct {
	AccessToken           string `json:"accessToken"`
	CatchUpOnStart        *bool  `json:"catchUpOnStart,omitempty"`
	DeviceID              string `json:"deviceId,omitempty"`
	HomeserverURL         string `json:"homeserverUrl"`
	InitialSyncMode       string `json:"initialSyncMode,omitempty" tstype:"\"persisted\" | \"latest\" | \"catch_up\""`
	InitialSyncSince      string `json:"initialSyncSince,omitempty"`
	PickleKey             string `json:"pickleKey,omitempty"`
	RecoveryKey           string `json:"recoveryKey,omitempty"`
	UserID                string `json:"userId,omitempty"`
	VerifyRecoveryOnStart bool   `json:"verifyRecoveryOnStart,omitempty"`
}

type MatrixWhoami struct {
	UserID   string `json:"userId"`
	DeviceID string `json:"deviceId"`
}

func (c *Core) handleInit(ctx context.Context, payload []byte) ([]byte, error) {
	initStarted := time.Now()
	var req MatrixCoreInitOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	c.emitInitStep("start", initStarted)
	cli, err := mautrix.NewClient(req.HomeserverURL, "", req.AccessToken)
	if err != nil {
		return nil, err
	}
	configureHTTPClient(cli, c.host)
	var resp MatrixWhoami
	if req.UserID != "" && req.DeviceID != "" {
		cli.UserID = id.UserID(req.UserID)
		cli.DeviceID = id.DeviceID(req.DeviceID)
		resp = MatrixWhoami{UserID: req.UserID, DeviceID: req.DeviceID}
		c.emitInitStep("whoami_cached", initStarted)
	} else {
		whoami, err := cli.Whoami(ctx)
		if err != nil {
			return nil, err
		}
		c.emitInitStep("whoami", initStarted)
		cli.UserID = whoami.UserID
		cli.DeviceID = whoami.DeviceID
		resp = MatrixWhoami{UserID: whoami.UserID.String(), DeviceID: whoami.DeviceID.String()}
	}

	c.pickleKey = c.resolvePickleKey(req)
	stores, err := loadStoreBundle(ctx, c.host, req.HomeserverURL, cli.UserID, cli.DeviceID, c.pickleKey)
	if err != nil {
		return nil, err
	}
	c.emitInitStep("stores_loaded", initStarted)
	cli.StateStore = stores.StateStore

	c.client = cli
	c.crypto = nil
	c.cryptoStore = stores.CryptoStore
	c.backupKey = nil
	c.backupVersion = ""
	if c.beeperStream != nil {
		_ = c.beeperStream.Close()
	}
	c.beeperStream = nil
	c.nextBatch = ""
	c.pendingDecryptions = nil
	c.emittedTimelineIDs = make(map[id.EventID]struct{})
	c.messageEdits = make(map[id.EventID]*MatrixMessageEvent)
	c.reactions = make(map[id.EventID]reactionSnapshot)
	c.stores = stores
	c.userID = cli.UserID
	c.deviceID = cli.DeviceID
	c.cryptoStatus = "disabled"
	storedNextBatch, err := stores.LoadNextBatch(ctx)
	if err != nil {
		return nil, err
	}
	syncPlan := resolveStartupSyncPlan(req, storedNextBatch)
	c.nextBatch = syncPlan.nextBatch
	c.skipNextSync = syncPlan.skipNextSync
	c.emit(OutboundEvent{
		"type":         "sync_status",
		"status":       "init_step",
		"step":         "sync_cursor",
		"durationMs":   time.Since(initStarted).Milliseconds(),
		"cursorSource": syncPlan.cursorSource,
		"skipTimeline": syncPlan.skipNextSync,
	})
	if syncPlan.loadPendingDecryptions {
		if err := c.loadPendingDecryptions(ctx); err != nil {
			return nil, err
		}
	} else if err := c.savePendingDecryptions(ctx); err != nil {
		return nil, err
	}
	if err := c.loadReactionSnapshots(ctx); err != nil {
		return nil, err
	}

	if err := c.setupCrypto(ctx, req); err != nil {
		return nil, err
	}
	c.emitInitStep("crypto_ready", initStarted)
	if err := c.setupBeeperStream(); err != nil {
		return nil, err
	}
	c.emitInitStep("beeper_stream_ready", initStarted)
	c.emit(OutboundEvent{"type": "sync_status", "status": "initialized", "durationMs": time.Since(initStarted).Milliseconds()})
	return json.Marshal(resp)
}

type startupSyncPlan struct {
	cursorSource           string
	loadPendingDecryptions bool
	nextBatch              string
	skipNextSync           bool
}

func resolveStartupSyncPlan(req MatrixCoreInitOptions, storedNextBatch string) startupSyncPlan {
	if req.InitialSyncSince != "" {
		return startupSyncPlan{
			cursorSource:           "provided",
			loadPendingDecryptions: true,
			nextBatch:              req.InitialSyncSince,
			skipNextSync:           false,
		}
	}

	mode := req.InitialSyncMode
	if mode == "" {
		mode = "latest"
	}
	if req.CatchUpOnStart != nil {
		if *req.CatchUpOnStart {
			mode = "catch_up"
		} else {
			mode = "latest"
		}
	}

	switch mode {
	case "catch_up":
		return startupSyncPlan{
			cursorSource:           cursorSource(storedNextBatch, "stored", "initial"),
			loadPendingDecryptions: true,
			nextBatch:              storedNextBatch,
			skipNextSync:           false,
		}
	case "latest", "boot", "live":
		return startupSyncPlan{
			cursorSource:           cursorSource(storedNextBatch, "stored_latest", "latest"),
			loadPendingDecryptions: false,
			nextBatch:              storedNextBatch,
			skipNextSync:           true,
		}
	default:
		return startupSyncPlan{
			cursorSource:           cursorSource(storedNextBatch, "stored_latest", "latest"),
			loadPendingDecryptions: false,
			nextBatch:              storedNextBatch,
			skipNextSync:           true,
		}
	}
}

func cursorSource(cursor, present, missing string) string {
	if cursor == "" {
		return missing
	}
	return present
}

func (c *Core) emitInitStep(step string, started time.Time) {
	c.emit(OutboundEvent{
		"type":       "sync_status",
		"status":     "init_step",
		"step":       step,
		"durationMs": time.Since(started).Milliseconds(),
	})
}

func (c *Core) setupBeeperStream() error {
	cli, err := c.requireClient()
	if err != nil {
		return err
	}
	helper, err := beeperstream.New(cli)
	if err != nil {
		return err
	}
	if err := helper.Init(); err != nil {
		return err
	}
	c.beeperStream = helper
	return nil
}

func (c *Core) handleWhoami(ctx context.Context) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	if cli.UserID == "" || cli.DeviceID == "" {
		resp, err := cli.Whoami(ctx)
		if err != nil {
			return nil, err
		}
		cli.UserID = resp.UserID
		cli.DeviceID = resp.DeviceID
		c.userID = resp.UserID
		c.deviceID = resp.DeviceID
	}
	return json.Marshal(MatrixWhoami{UserID: cli.UserID.String(), DeviceID: cli.DeviceID.String()})
}

func (c *Core) handleLogout(ctx context.Context) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	_, err = cli.Logout(ctx)
	return c.emptyIfNil(err)
}

func (c *Core) setupCrypto(ctx context.Context, req MatrixCoreInitOptions) error {
	cli, err := c.requireClient()
	if err != nil {
		return err
	}
	syncer, ok := cli.Syncer.(mautrix.ExtensibleSyncer)
	if !ok {
		return fmt.Errorf("matrix client syncer does not implement ExtensibleSyncer")
	}
	syncer.OnEvent(cli.StateStoreSyncHandler)

	helper, err := cryptohelper.NewCryptoHelper(cli, c.pickleKey, c.cryptoStore)
	if err != nil {
		return err
	}
	helper.DecryptErrorCallback = func(evt *event.Event, err error) {
		c.rememberPendingDecryption(ctx, evt)
		if c.retryPendingDecryptionEvent(ctx, evt) {
			return
		}
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
	}
	if err := helper.Init(ctx); err != nil {
		return fmt.Errorf("failed to initialize Matrix E2EE; if this access token belongs to an existing encrypted device, the matching local crypto store is required. Logging in as a fresh device or adding durable crypto storage fixes this: %w", err)
	}
	if err := helper.Machine().ShareKeys(ctx, -1); err != nil {
		return fmt.Errorf("failed to upload Matrix E2EE device keys: %w", err)
	}
	syncer.OnEventType(event.ToDeviceEncrypted, helper.Machine().HandleToDeviceEvent)
	cli.Crypto = helper
	c.crypto = helper
	c.cryptoStatus = "enabled"
	c.emit(OutboundEvent{"type": "crypto_status", "status": "enabled"})

	if req.RecoveryKey != "" {
		backupVersion, backupKey, err := c.loadRecoveryBackup(ctx, helper.Machine(), req.RecoveryKey, req.VerifyRecoveryOnStart)
		if err != nil {
			return err
		}
		c.backupVersion = backupVersion
		c.backupKey = backupKey
		if backupKey != nil {
			status := "recovery_key_loaded"
			if req.VerifyRecoveryOnStart {
				status = "recovery_restored"
			}
			c.cryptoStatus = status
			c.emit(OutboundEvent{
				"type":             "crypto_status",
				"status":           status,
				"keyBackupVersion": backupVersion.String(),
			})
		}
	}

	syncer.OnEventType(event.EventMessage, c.processEvent)
	syncer.OnEventType(event.EventReaction, c.processEvent)
	syncer.OnEventType(event.EventRedaction, c.processEvent)
	return nil
}

func (c *Core) loadRecoveryBackup(ctx context.Context, mach *crypto.OlmMachine, code string, verifyIdentity bool) (id.KeyBackupVersion, *backup.MegolmBackupKey, error) {
	if !verifyIdentity && c.stores != nil {
		version, backupKey, ok, err := c.stores.LoadRecoveryBackup(ctx, code)
		if err != nil {
			c.cryptoStatus = "recovery_cache_unavailable"
			c.emit(OutboundEvent{"type": "crypto_status", "status": "recovery_cache_unavailable", "error": err.Error()})
		} else if ok {
			c.cryptoStatus = "recovery_key_cached"
			c.emit(OutboundEvent{"type": "crypto_status", "status": "recovery_key_cached", "keyBackupVersion": version.String()})
			return version, backupKey, nil
		}
	}

	keyID, keyData, err := mach.SSSS.GetDefaultKeyData(ctx)
	if err != nil {
		return "", nil, fmt.Errorf("failed to get default SSSS key data: %w", err)
	}
	key, err := keyData.VerifyRecoveryKey(keyID, code)
	if errors.Is(err, ssss.ErrInvalidRecoveryKey) && keyData.Passphrase != nil {
		key, err = keyData.VerifyPassphrase(keyID, code)
	}
	if errors.Is(err, ssss.ErrUnverifiableKey) {
		c.cryptoStatus = "recovery_unverified"
		c.emit(OutboundEvent{"type": "crypto_status", "status": "recovery_unverified", "keyId": keyID})
	} else if err != nil {
		return "", nil, fmt.Errorf("failed to verify Matrix recovery code: %w", err)
	}
	if verifyIdentity {
		if err := mach.FetchCrossSigningKeysFromSSSS(ctx, key); err != nil {
			return "", nil, fmt.Errorf("failed to fetch cross-signing keys from SSSS: %w", err)
		}
		if err := mach.SignOwnDevice(ctx, mach.OwnIdentity()); err != nil {
			return "", nil, fmt.Errorf("failed to sign own device: %w", err)
		}
		if err := mach.SignOwnMasterKey(ctx); err != nil {
			return "", nil, fmt.Errorf("failed to sign own master key: %w", err)
		}
	}

	data, err := mach.SSSS.GetDecryptedAccountData(ctx, event.AccountDataMegolmBackupKey, key)
	if err != nil {
		c.cryptoStatus = "key_backup_unavailable"
		c.emit(OutboundEvent{"type": "crypto_status", "status": "key_backup_unavailable", "error": err.Error()})
		return "", nil, nil
	}
	backupKey, err := backup.MegolmBackupKeyFromBytes(data)
	if err != nil {
		c.cryptoStatus = "key_backup_unavailable"
		c.emit(OutboundEvent{"type": "crypto_status", "status": "key_backup_unavailable", "error": err.Error()})
		return "", nil, nil
	}
	if c.stores != nil {
		_ = c.stores.SaveRecoveryBackup(ctx, code, "", backupKey)
	}
	if !verifyIdentity {
		return "", backupKey, nil
	}
	versionInfo, err := mach.GetAndVerifyLatestKeyBackupVersion(ctx, backupKey)
	if err != nil || versionInfo == nil {
		errorMessage := "no verified key backup version found"
		if err != nil {
			errorMessage = err.Error()
		}
		c.cryptoStatus = "key_backup_unavailable"
		c.emit(OutboundEvent{"type": "crypto_status", "status": "key_backup_unavailable", "error": errorMessage})
		return "", backupKey, nil
	}
	if c.stores != nil {
		_ = c.stores.SaveRecoveryBackup(ctx, code, versionInfo.Version, backupKey)
	}
	return versionInfo.Version, backupKey, nil
}

func (c *Core) resolvePickleKey(req MatrixCoreInitOptions) []byte {
	switch {
	case req.PickleKey != "":
		return []byte(req.PickleKey)
	case req.RecoveryKey != "":
		return []byte(req.RecoveryKey)
	default:
		return []byte(req.AccessToken)
	}
}
