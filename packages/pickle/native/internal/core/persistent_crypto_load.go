package core

import (
	"encoding/hex"
	"sort"
	"time"

	"maunium.net/go/mautrix/crypto"
	"maunium.net/go/mautrix/crypto/olm"
	"maunium.net/go/mautrix/id"
)

func (store *persistentCryptoStore) applySnapshot(snapshot persistedCryptoSnapshot) error {
	ensureCryptoStoreMaps(store.MemoryStore)
	if snapshot.Account != nil && len(snapshot.Account.Pickle) > 0 {
		internal, err := olm.AccountFromPickled(snapshot.Account.Pickle, store.pickleKey)
		if err != nil {
			return err
		}
		store.Account = &crypto.OlmAccount{
			Internal:         internal,
			Shared:           snapshot.Account.Shared,
			KeyBackupVersion: snapshot.Account.KeyBackupVersion,
		}
	}
	for senderKey, sessions := range snapshot.Sessions {
		list := make(crypto.OlmSessionList, 0, len(sessions))
		for _, session := range sessions {
			internal, err := olm.SessionFromPickled(session.Pickle, store.pickleKey)
			if err != nil {
				return err
			}
			list = append(list, &crypto.OlmSession{
				Internal:        internal,
				ExpirationMixin: session.ExpirationMixin,
			})
		}
		sort.Sort(list)
		store.Sessions[senderKey] = list
	}
	for roomID, sessions := range snapshot.GroupSessions {
		if store.GroupSessions[roomID] == nil {
			store.GroupSessions[roomID] = make(map[id.SessionID]*crypto.InboundGroupSession)
		}
		for sessionID, session := range sessions {
			internal, err := olm.InboundGroupSessionFromPickled(session.Pickle, store.pickleKey)
			if err != nil {
				return err
			}
			store.GroupSessions[roomID][sessionID] = &crypto.InboundGroupSession{
				Internal:         internal,
				SigningKey:       session.SigningKey,
				SenderKey:        session.SenderKey,
				RoomID:           session.RoomID,
				ForwardingChains: session.ForwardingChains,
				RatchetSafety:    session.RatchetSafety,
				ReceivedAt:       session.ReceivedAt,
				MaxAge:           session.MaxAge,
				MaxMessages:      session.MaxMessages,
				IsScheduled:      session.IsScheduled,
				KeyBackupVersion: session.KeyBackupVersion,
				KeySource:        session.KeySource,
			}
		}
	}
	if snapshot.WithheldGroupSessions != nil {
		store.WithheldGroupSessions = snapshot.WithheldGroupSessions
	}
	for roomID, session := range snapshot.OutGroupSessions {
		internal, err := olm.OutboundGroupSessionFromPickled(session.Pickle, store.pickleKey)
		if err != nil {
			return err
		}
		users := make(map[crypto.UserDevice]crypto.OGSState, len(session.Users))
		for _, user := range session.Users {
			users[crypto.UserDevice{UserID: user.UserID, DeviceID: user.DeviceID}] = user.State
		}
		store.OutGroupSessions[roomID] = &crypto.OutboundGroupSession{
			Internal:        internal,
			ExpirationMixin: session.ExpirationMixin,
			MaxMessages:     session.MaxMessages,
			MessageCount:    session.MessageCount,
			Users:           users,
			RoomID:          session.RoomID,
			Shared:          session.Shared,
		}
	}
	if snapshot.SharedGroupSessions != nil {
		store.SharedGroupSessions = snapshot.SharedGroupSessions
	}
	if snapshot.Devices != nil {
		store.Devices = snapshot.Devices
	}
	if snapshot.CrossSigningKeys != nil {
		store.CrossSigningKeys = snapshot.CrossSigningKeys
	}
	if snapshot.KeySignatures != nil {
		store.KeySignatures = snapshot.KeySignatures
	}
	if snapshot.Secrets != nil {
		store.Secrets = snapshot.Secrets
	}
	store.OutdatedUsers = make(map[id.UserID]struct{}, len(snapshot.OutdatedUsers))
	for _, userID := range snapshot.OutdatedUsers {
		store.OutdatedUsers[userID] = struct{}{}
	}
	store.messageIndices = make(map[storedMessageIndexKey]storedMessageIndexValue, len(snapshot.MessageIndices))
	for _, item := range snapshot.MessageIndices {
		store.messageIndices[storedMessageIndexKey{
			SenderKey: item.SenderKey,
			SessionID: item.SessionID,
			Index:     item.Index,
		}] = storedMessageIndexValue{EventID: item.EventID, Timestamp: item.Timestamp}
	}
	store.olmHashes = make(map[[32]byte]time.Time, len(snapshot.OlmHashes))
	for _, item := range snapshot.OlmHashes {
		rawHash, err := hex.DecodeString(item.Hash)
		if err != nil || len(rawHash) != 32 {
			continue
		}
		var hash [32]byte
		copy(hash[:], rawHash)
		store.olmHashes[hash] = item.ReceivedAt
	}
	return nil
}
