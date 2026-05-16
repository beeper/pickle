package core

import (
	"context"
	"encoding/json"
	"time"

	"maunium.net/go/mautrix/crypto"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

func (store *persistentCryptoStore) save(ctx context.Context) error {
	snapshot, err := store.snapshot()
	if err != nil {
		return err
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	return store.kv.Set(ctx, store.key, raw)
}

func (store *persistentCryptoStore) reset(ctx context.Context) error {
	store.auxLock.Lock()
	defer store.auxLock.Unlock()
	store.MemoryStore = crypto.NewMemoryStore(func() error {
		return store.save(context.Background())
	})
	store.messageIndices = make(map[storedMessageIndexKey]storedMessageIndexValue)
	store.olmHashes = make(map[[32]byte]time.Time)
	return store.kv.Delete(ctx, store.key)
}

func (store *persistentCryptoStore) PutOlmHash(ctx context.Context, hash [32]byte, receivedAt time.Time) error {
	store.auxLock.Lock()
	store.olmHashes[hash] = receivedAt
	store.auxLock.Unlock()
	return store.save(ctx)
}

func (store *persistentCryptoStore) GetOlmHash(_ context.Context, hash [32]byte) (time.Time, error) {
	store.auxLock.Lock()
	defer store.auxLock.Unlock()
	return store.olmHashes[hash], nil
}

func (store *persistentCryptoStore) DeleteOldOlmHashes(ctx context.Context, beforeTS time.Time) error {
	store.auxLock.Lock()
	for hash, receivedAt := range store.olmHashes {
		if receivedAt.Before(beforeTS) {
			delete(store.olmHashes, hash)
		}
	}
	store.auxLock.Unlock()
	return store.save(ctx)
}

func (store *persistentCryptoStore) RemoveOutboundGroupSession(ctx context.Context, roomID id.RoomID) error {
	if err := store.MemoryStore.RemoveOutboundGroupSession(ctx, roomID); err != nil {
		return err
	}
	return store.save(ctx)
}

func (store *persistentCryptoStore) MarkOutboundGroupSessionShared(ctx context.Context, userID id.UserID, identityKey id.IdentityKey, sessionID id.SessionID) error {
	if err := store.MemoryStore.MarkOutboundGroupSessionShared(ctx, userID, identityKey, sessionID); err != nil {
		return err
	}
	return store.save(ctx)
}

func (store *persistentCryptoStore) ValidateMessageIndex(ctx context.Context, senderKey id.SenderKey, sessionID id.SessionID, eventID id.EventID, index uint, timestamp int64) (bool, error) {
	key := storedMessageIndexKey{
		SenderKey: senderKey,
		SessionID: sessionID,
		Index:     index,
	}
	store.auxLock.Lock()
	val, ok := store.messageIndices[key]
	if !ok {
		if eventID == "" && timestamp == 0 {
			store.auxLock.Unlock()
			return true, nil
		}
		store.messageIndices[key] = storedMessageIndexValue{
			EventID:   eventID,
			Timestamp: timestamp,
		}
		store.auxLock.Unlock()
		return true, store.save(ctx)
	}
	store.auxLock.Unlock()
	if val.EventID != eventID || val.Timestamp != timestamp {
		return false, nil
	}
	return true, nil
}

func ensureCryptoStoreMaps(store *crypto.MemoryStore) {
	if store.Sessions == nil {
		store.Sessions = make(map[id.SenderKey]crypto.OlmSessionList)
	}
	if store.GroupSessions == nil {
		store.GroupSessions = make(map[id.RoomID]map[id.SessionID]*crypto.InboundGroupSession)
	}
	if store.WithheldGroupSessions == nil {
		store.WithheldGroupSessions = make(map[id.RoomID]map[id.SessionID]*event.RoomKeyWithheldEventContent)
	}
	if store.OutGroupSessions == nil {
		store.OutGroupSessions = make(map[id.RoomID]*crypto.OutboundGroupSession)
	}
	if store.SharedGroupSessions == nil {
		store.SharedGroupSessions = make(map[id.UserID]map[id.IdentityKey]map[id.SessionID]struct{})
	}
	if store.Devices == nil {
		store.Devices = make(map[id.UserID]map[id.DeviceID]*id.Device)
	}
	if store.CrossSigningKeys == nil {
		store.CrossSigningKeys = make(map[id.UserID]map[id.CrossSigningUsage]id.CrossSigningKey)
	}
	if store.KeySignatures == nil {
		store.KeySignatures = make(map[id.UserID]map[id.Ed25519]map[id.UserID]map[id.Ed25519]string)
	}
	if store.OutdatedUsers == nil {
		store.OutdatedUsers = make(map[id.UserID]struct{})
	}
	if store.Secrets == nil {
		store.Secrets = make(map[id.Secret]string)
	}
}
