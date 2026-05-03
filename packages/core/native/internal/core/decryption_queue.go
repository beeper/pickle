package core

import (
	"context"
	"encoding/json"
	"sort"
	"time"

	"maunium.net/go/mautrix/crypto"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

const (
	maxPendingDecryptions = 200
	maxPendingAge         = 24 * time.Hour
	sessionRequestBackoff = 5 * time.Minute
)

type pendingDecryption struct {
	AddedAt            int64           `json:"addedAt"`
	Attempts           int             `json:"attempts"`
	Event              json.RawMessage `json:"event"`
	EventID            string          `json:"eventId"`
	RoomID             string          `json:"roomId"`
	MinIndex           uint            `json:"minIndex,omitempty"`
	Sender             string          `json:"sender,omitempty"`
	DeviceID           string          `json:"deviceId,omitempty"`
	SenderKey          string          `json:"senderKey,omitempty"`
	SessionID          string          `json:"sessionId,omitempty"`
	BackupChecked      bool            `json:"backupChecked,omitempty"`
	SessionRequestedAt int64           `json:"sessionRequestedAt,omitempty"`
}

func (c *Core) loadPendingDecryptions(ctx context.Context) error {
	pending, err := c.stores.LoadPendingDecryption(ctx)
	if err != nil {
		return err
	}
	c.pendingDecryptions = c.trimPendingDecryptions(pending)
	return nil
}

func (c *Core) rememberPendingDecryption(ctx context.Context, evt *event.Event) {
	if evt == nil || evt.ID == "" || evt.Type != event.EventEncrypted {
		return
	}
	raw, err := json.Marshal(evt)
	if err != nil {
		return
	}
	_ = evt.Content.ParseRaw(evt.Type)
	content := evt.Content.AsEncrypted()
	minIndex, _ := crypto.ParseMegolmMessageIndex(content.MegolmCiphertext)
	eventID := evt.ID.String()
	next := pendingDecryption{
		AddedAt:   time.Now().UnixMilli(),
		Event:     raw,
		EventID:   eventID,
		MinIndex:  minIndex,
		RoomID:    evt.RoomID.String(),
		Sender:    evt.Sender.String(),
		DeviceID:  content.DeviceID.String(),
		SenderKey: content.SenderKey.String(),
		SessionID: content.SessionID.String(),
	}
	for index, existing := range c.pendingDecryptions {
		if existing.EventID == eventID {
			next.AddedAt = existing.AddedAt
			next.Attempts = existing.Attempts
			next.BackupChecked = existing.BackupChecked
			next.SessionRequestedAt = existing.SessionRequestedAt
			c.pendingDecryptions[index] = next
			c.requestMissingSession(ctx, &c.pendingDecryptions[index], false)
			_ = c.savePendingDecryptions(ctx)
			return
		}
	}
	c.pendingDecryptions = append(c.pendingDecryptions, next)
	c.requestMissingSession(ctx, &c.pendingDecryptions[len(c.pendingDecryptions)-1], false)
	_ = c.savePendingDecryptions(ctx)
}

func (c *Core) retryPendingDecryptions(ctx context.Context) {
	if len(c.pendingDecryptions) == 0 || c.crypto == nil {
		return
	}
	remaining := c.pendingDecryptions[:0]
	changed := false
	for _, pending := range c.trimPendingDecryptions(c.pendingDecryptions) {
		var evt event.Event
		if err := json.Unmarshal(pending.Event, &evt); err != nil {
			changed = true
			continue
		}
		decrypted, err := c.decryptIfNeeded(ctx, &evt)
		if err != nil {
			pending.Attempts++
			if c.requestMissingSession(ctx, &pending, true) {
				decrypted, err = c.decryptIfNeeded(ctx, &evt)
			}
		}
		if err != nil {
			remaining = append(remaining, pending)
			changed = true
			continue
		}
		if decrypted.Type == event.EventMessage {
			if converted := c.convertMessageEvent(decrypted); converted != nil {
				if !c.markTimelineEventEmitted(evt.ID) {
					continue
				}
				c.emit(OutboundEvent{"type": "message", "event": converted})
			}
		}
		changed = true
	}
	c.pendingDecryptions = c.trimPendingDecryptions(remaining)
	if changed {
		_ = c.savePendingDecryptions(ctx)
	}
}

func (c *Core) retryPendingDecryptionEvent(ctx context.Context, evt *event.Event) bool {
	if evt == nil || evt.ID == "" || len(c.pendingDecryptions) == 0 || c.crypto == nil {
		return false
	}
	for index := range c.pendingDecryptions {
		pending := &c.pendingDecryptions[index]
		if pending.EventID != evt.ID.String() {
			continue
		}
		decrypted, err := c.decryptIfNeeded(ctx, evt)
		if err != nil {
			pending.Attempts++
			if c.requestMissingSession(ctx, pending, true) {
				decrypted, err = c.decryptIfNeeded(ctx, evt)
			}
		}
		if err != nil {
			_ = c.savePendingDecryptions(ctx)
			return false
		}
		c.removePendingDecryption(ctx, evt.ID)
		if decrypted.Type == event.EventMessage {
			if converted := c.convertMessageEvent(decrypted); converted != nil {
				if !c.markTimelineEventEmitted(evt.ID) {
					return true
				}
				c.emit(OutboundEvent{"type": "message", "event": converted})
			}
		}
		return true
	}
	return false
}

func (c *Core) removePendingDecryption(ctx context.Context, eventID id.EventID) {
	if eventID == "" || len(c.pendingDecryptions) == 0 {
		return
	}
	changed := false
	remaining := c.pendingDecryptions[:0]
	for _, pending := range c.pendingDecryptions {
		if pending.EventID == eventID.String() {
			changed = true
			continue
		}
		remaining = append(remaining, pending)
	}
	c.pendingDecryptions = remaining
	if changed {
		_ = c.savePendingDecryptions(ctx)
	}
}

func (c *Core) requestMissingSession(ctx context.Context, pending *pendingDecryption, forceBackup bool) bool {
	if c.crypto == nil || pending == nil || pending.RoomID == "" || pending.SessionID == "" {
		return false
	}
	if forceBackup && !pending.BackupChecked {
		if restored, checked := c.restorePendingFromBackup(ctx, pending); restored {
			pending.SessionRequestedAt = 0
			return true
		} else if checked {
			pending.BackupChecked = true
		}
	}
	now := time.Now()
	if pending.SessionRequestedAt > 0 && now.Sub(time.UnixMilli(pending.SessionRequestedAt)) < sessionRequestBackoff {
		return false
	}
	pending.SessionRequestedAt = now.UnixMilli()
	if pending.SenderKey == "" || pending.Sender == "" {
		return false
	}
	c.crypto.RequestSession(ctx, id.RoomID(pending.RoomID), id.SenderKey(pending.SenderKey), id.SessionID(pending.SessionID), id.UserID(pending.Sender), "")
	return false
}

func (c *Core) restorePendingFromBackup(ctx context.Context, pending *pendingDecryption) (bool, bool) {
	if c.crypto == nil || c.backupKey == nil {
		return false, false
	}
	if pending == nil {
		return false, false
	}
	mach := c.crypto.Machine()
	if c.backupVersion == "" {
		versionInfo, err := mach.GetAndVerifyLatestKeyBackupVersion(ctx, c.backupKey)
		if err != nil || versionInfo == nil {
			return false, false
		}
		c.backupVersion = versionInfo.Version
	}
	roomID := id.RoomID(pending.RoomID)
	sessionID := id.SessionID(pending.SessionID)
	resp, err := mach.Client.GetKeyBackupForRoomAndSession(ctx, c.backupVersion, roomID, sessionID)
	if err != nil || resp == nil {
		if err != nil {
			c.emit(OutboundEvent{"type": "crypto_status", "status": "key_backup_unavailable", "error": err.Error()})
		}
		return false, true
	}
	sessionData, err := resp.SessionData.Decrypt(c.backupKey)
	if err != nil {
		c.emit(OutboundEvent{"type": "crypto_status", "status": "key_backup_unavailable", "error": err.Error()})
		return false, true
	}
	imported, err := mach.ImportRoomKeyFromBackup(ctx, c.backupVersion, roomID, sessionID, sessionData)
	if err != nil {
		c.emit(OutboundEvent{"type": "crypto_status", "status": "key_backup_unavailable", "error": err.Error()})
	}
	return err == nil && imported != nil, true
}

func (c *Core) trimPendingDecryptions(pending []pendingDecryption) []pendingDecryption {
	cutoff := time.Now().Add(-maxPendingAge).UnixMilli()
	trimmed := pending[:0]
	for _, item := range pending {
		if item.EventID == "" || item.AddedAt < cutoff {
			continue
		}
		trimmed = append(trimmed, item)
	}
	sort.SliceStable(trimmed, func(i, j int) bool {
		return trimmed[i].AddedAt > trimmed[j].AddedAt
	})
	if len(trimmed) > maxPendingDecryptions {
		trimmed = trimmed[:maxPendingDecryptions]
	}
	return trimmed
}

func (c *Core) savePendingDecryptions(ctx context.Context) error {
	if c.stores == nil {
		return nil
	}
	return c.stores.SavePendingDecryption(ctx, c.pendingDecryptions)
}
