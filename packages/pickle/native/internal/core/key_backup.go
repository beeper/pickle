package core

import (
	"context"
	"encoding/json"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/crypto/backup"
	"maunium.net/go/mautrix/crypto/olm"
	"maunium.net/go/mautrix/id"
)

func (c *Core) backupOutboundMegolmSession(ctx context.Context, roomID id.RoomID) {
	if c == nil || c.crypto == nil || c.backupKey == nil || roomID == "" {
		return
	}
	mach := c.crypto.Machine()
	if c.backupVersion == "" {
		versionInfo, err := mach.GetAndVerifyLatestKeyBackupVersion(ctx, c.backupKey)
		if err != nil || versionInfo == nil {
			c.emit(OutboundEvent{"type": "crypto_status", "status": "key_backup_unavailable"})
			return
		}
		c.backupVersion = versionInfo.Version
		_ = mach.SetKeyBackupVersion(ctx, versionInfo.Version)
	}
	session, err := mach.CryptoStore.GetOutboundGroupSession(ctx, roomID)
	if err != nil || session == nil || !session.Shared {
		return
	}
	content := session.ShareContent()
	shareContent := content.AsRoomKey()
	if shareContent == nil || shareContent.SessionID == "" || shareContent.SessionKey == "" {
		return
	}
	inbound, err := olm.NewInboundGroupSession([]byte(shareContent.SessionKey))
	if err != nil {
		c.emit(OutboundEvent{"type": "crypto_status", "status": "key_backup_unavailable", "error": err.Error()})
		return
	}
	exported, err := inbound.Export(inbound.FirstKnownIndex())
	if err != nil {
		c.emit(OutboundEvent{"type": "crypto_status", "status": "key_backup_unavailable", "error": err.Error()})
		return
	}
	sessionData := backup.MegolmSessionData{
		Algorithm:          id.AlgorithmMegolmV1,
		ForwardingKeyChain: []string{},
		SenderClaimedKeys:  backup.SenderClaimedKeys{Ed25519: mach.GetAccount().SigningKey()},
		SenderKey:          mach.GetAccount().IdentityKey(),
		SessionKey:         string(exported),
	}
	encrypted, err := backup.EncryptSessionData(c.backupKey, sessionData)
	if err != nil {
		c.emit(OutboundEvent{"type": "crypto_status", "status": "key_backup_unavailable", "error": err.Error()})
		return
	}
	raw, err := json.Marshal(encrypted)
	if err != nil {
		c.emit(OutboundEvent{"type": "crypto_status", "status": "key_backup_unavailable", "error": err.Error()})
		return
	}
	req := mautrix.ReqKeyBackupData{
		FirstMessageIndex: 0,
		ForwardedCount:    0,
		IsVerified:        true,
		SessionData:       raw,
	}
	_, err = mach.Client.PutKeysInBackupForRoom(ctx, c.backupVersion, roomID, &mautrix.ReqRoomKeyBackup{
		Sessions: map[id.SessionID]mautrix.ReqKeyBackupData{shareContent.SessionID: req},
	})
	if err != nil {
		c.emit(OutboundEvent{"type": "crypto_status", "status": "key_backup_unavailable", "error": err.Error()})
		return
	}
	c.emit(OutboundEvent{"type": "crypto_status", "status": "key_backup_updated", "keyBackupVersion": c.backupVersion.String()})
}

func (c *Core) prepareOutboundMegolm(ctx context.Context, cli *mautrix.Client, roomID id.RoomID) error {
	if err := ensureMegolmRecipients(ctx, cli, roomID); err != nil {
		return err
	}
	if c == nil || c.crypto == nil || cli == nil || cli.StateStore == nil {
		return nil
	}
	encrypted, err := cli.StateStore.IsEncrypted(ctx, roomID)
	if err != nil || !encrypted {
		return err
	}
	members, err := cli.StateStore.GetRoomJoinedOrInvitedMembers(ctx, roomID)
	if err != nil {
		return err
	}
	if err := c.crypto.Machine().ShareGroupSession(ctx, roomID, members); err != nil {
		return err
	}
	c.backupOutboundMegolmSession(ctx, roomID)
	return nil
}
