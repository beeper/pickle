package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/beeperstream"
	"maunium.net/go/mautrix/crypto"
	"maunium.net/go/mautrix/crypto/backup"
	"maunium.net/go/mautrix/crypto/cryptohelper"
	"maunium.net/go/mautrix/crypto/ssss"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

type initReq struct {
	HomeserverURL  string `json:"homeserverUrl"`
	AccessToken    string `json:"accessToken"`
	CatchUpOnStart bool   `json:"catchUpOnStart,omitempty"`
	RecoveryCode   string `json:"recoveryCode,omitempty"`
	RecoveryKey    string `json:"recoveryKey,omitempty"`
	PickleKey      string `json:"pickleKey,omitempty"`
}

type whoamiResp struct {
	UserID   string `json:"userId"`
	DeviceID string `json:"deviceId"`
}

func (c *Core) handleInit(ctx context.Context, payload []byte) ([]byte, error) {
	var req initReq
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.RecoveryKey == "" {
		req.RecoveryKey = req.RecoveryCode
	}
	cli, err := mautrix.NewClient(req.HomeserverURL, "", req.AccessToken)
	if err != nil {
		return nil, err
	}
	configureHTTPClient(cli, c.host)
	resp, err := cli.Whoami(ctx)
	if err != nil {
		return nil, err
	}
	cli.UserID = resp.UserID
	cli.DeviceID = resp.DeviceID

	c.pickleKey = c.resolvePickleKey(req)
	stores, err := loadStoreBundle(ctx, c.host, req.HomeserverURL, resp.UserID, resp.DeviceID, c.pickleKey)
	if err != nil {
		return nil, err
	}
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
	c.reactions = make(map[id.EventID]reactionSnapshot)
	c.stores = stores
	c.userID = resp.UserID
	c.deviceID = resp.DeviceID
	c.cryptoStatus = "disabled"
	if c.nextBatch, err = stores.LoadNextBatch(ctx); err != nil {
		return nil, err
	}
	if err := c.loadPendingDecryptions(ctx); err != nil {
		return nil, err
	}

	if err := c.setupCrypto(ctx, req); err != nil {
		return nil, err
	}
	if err := c.setupBeeperStream(); err != nil {
		return nil, err
	}
	c.skipNextSync = !req.CatchUpOnStart
	if c.nextBatch == "" {
		c.skipNextSync = true
	}
	if c.skipNextSync && len(c.pendingDecryptions) > 0 {
		c.pendingDecryptions = nil
		_ = c.savePendingDecryptions(ctx)
	}

	c.emit(OutboundEvent{"type": "sync_status", "status": "initialized"})
	return json.Marshal(whoamiResp{UserID: resp.UserID.String(), DeviceID: resp.DeviceID.String()})
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
	return json.Marshal(whoamiResp{UserID: cli.UserID.String(), DeviceID: cli.DeviceID.String()})
}

func (c *Core) setupCrypto(ctx context.Context, req initReq) error {
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
	cli.Crypto = helper
	c.crypto = helper
	c.cryptoStatus = "enabled"
	c.emit(OutboundEvent{"type": "crypto_status", "status": "enabled"})

	if req.RecoveryKey != "" {
		backupVersion, backupKey, err := c.verifyWithRecovery(ctx, helper.Machine(), req.RecoveryKey)
		if err != nil {
			return err
		}
		c.backupVersion = backupVersion
		c.backupKey = backupKey
		c.emit(OutboundEvent{
			"type":             "crypto_status",
			"status":           "recovery_restored",
			"keyBackupVersion": backupVersion.String(),
		})
	}

	syncer.OnEvent(func(ctx context.Context, evt *event.Event) {
		c.processEvent(ctx, evt)
	})
	return nil
}

func (c *Core) verifyWithRecovery(ctx context.Context, mach *crypto.OlmMachine, code string) (id.KeyBackupVersion, *backup.MegolmBackupKey, error) {
	keyID, keyData, err := mach.SSSS.GetDefaultKeyData(ctx)
	if err != nil {
		return "", nil, fmt.Errorf("failed to get default SSSS key data: %w", err)
	}
	key, err := keyData.VerifyRecoveryKey(keyID, code)
	if errors.Is(err, ssss.ErrInvalidRecoveryKey) && keyData.Passphrase != nil {
		key, err = keyData.VerifyPassphrase(keyID, code)
	}
	if errors.Is(err, ssss.ErrUnverifiableKey) {
		c.emit(OutboundEvent{"type": "crypto_status", "status": "recovery_unverified", "keyId": keyID})
	} else if err != nil {
		return "", nil, fmt.Errorf("failed to verify Matrix recovery code: %w", err)
	}
	if err := mach.FetchCrossSigningKeysFromSSSS(ctx, key); err != nil {
		return "", nil, fmt.Errorf("failed to fetch cross-signing keys from SSSS: %w", err)
	}
	if err := mach.SignOwnDevice(ctx, mach.OwnIdentity()); err != nil {
		return "", nil, fmt.Errorf("failed to sign own device: %w", err)
	}
	if err := mach.SignOwnMasterKey(ctx); err != nil {
		return "", nil, fmt.Errorf("failed to sign own master key: %w", err)
	}

	data, err := mach.SSSS.GetDecryptedAccountData(ctx, event.AccountDataMegolmBackupKey, key)
	if err != nil {
		c.emit(OutboundEvent{"type": "crypto_status", "status": "key_backup_unavailable", "error": err.Error()})
		return "", nil, nil
	}
	backupKey, err := backup.MegolmBackupKeyFromBytes(data)
	if err != nil {
		c.emit(OutboundEvent{"type": "crypto_status", "status": "key_backup_unavailable", "error": err.Error()})
		return "", nil, nil
	}
	versionInfo, err := mach.GetAndVerifyLatestKeyBackupVersion(ctx, backupKey)
	if err != nil || versionInfo == nil {
		errorMessage := "no verified key backup version found"
		if err != nil {
			errorMessage = err.Error()
		}
		c.emit(OutboundEvent{"type": "crypto_status", "status": "key_backup_unavailable", "error": errorMessage})
		return "", backupKey, nil
	}
	return versionInfo.Version, backupKey, nil
}

func (c *Core) resolvePickleKey(req initReq) []byte {
	switch {
	case req.PickleKey != "":
		return []byte(req.PickleKey)
	case req.RecoveryKey != "":
		return []byte(req.RecoveryKey)
	default:
		return []byte(req.AccessToken)
	}
}
