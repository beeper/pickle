package core

import (
	"encoding/hex"

	"maunium.net/go/mautrix/id"
)

func (store *persistentCryptoStore) snapshot() (persistedCryptoSnapshot, error) {
	snapshot := persistedCryptoSnapshot{
		Sessions:              make(map[id.SenderKey][]persistedOlmSession, len(store.Sessions)),
		GroupSessions:         make(map[id.RoomID]map[id.SessionID]persistedInboundGroupSession, len(store.GroupSessions)),
		WithheldGroupSessions: store.WithheldGroupSessions,
		OutGroupSessions:      make(map[id.RoomID]persistedOutboundGroupSession, len(store.OutGroupSessions)),
		SharedGroupSessions:   store.SharedGroupSessions,
		Devices:               store.Devices,
		CrossSigningKeys:      store.CrossSigningKeys,
		KeySignatures:         store.KeySignatures,
		Secrets:               store.Secrets,
	}
	if store.Account != nil {
		pickled, err := store.Account.Internal.Pickle(store.pickleKey)
		if err != nil {
			return snapshot, err
		}
		snapshot.Account = &persistedAccount{
			Pickle:           pickled,
			Shared:           store.Account.Shared,
			KeyBackupVersion: store.Account.KeyBackupVersion,
		}
	}
	for senderKey, sessions := range store.Sessions {
		for _, session := range sessions {
			if session == nil || session.Internal == nil {
				continue
			}
			pickled, err := session.Internal.Pickle(store.pickleKey)
			if err != nil {
				return snapshot, err
			}
			snapshot.Sessions[senderKey] = append(snapshot.Sessions[senderKey], persistedOlmSession{
				Pickle:          pickled,
				ExpirationMixin: session.ExpirationMixin,
			})
		}
	}
	for roomID, sessions := range store.GroupSessions {
		snapshot.GroupSessions[roomID] = make(map[id.SessionID]persistedInboundGroupSession, len(sessions))
		for sessionID, session := range sessions {
			if session == nil || session.Internal == nil {
				continue
			}
			pickled, err := session.Internal.Pickle(store.pickleKey)
			if err != nil {
				return snapshot, err
			}
			snapshot.GroupSessions[roomID][sessionID] = persistedInboundGroupSession{
				Pickle:           pickled,
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
	for roomID, session := range store.OutGroupSessions {
		if session == nil || session.Internal == nil {
			continue
		}
		pickled, err := session.Internal.Pickle(store.pickleKey)
		if err != nil {
			return snapshot, err
		}
		users := make([]persistedOutboundUserState, 0, len(session.Users))
		for user, state := range session.Users {
			users = append(users, persistedOutboundUserState{
				UserID:   user.UserID,
				DeviceID: user.DeviceID,
				State:    state,
			})
		}
		snapshot.OutGroupSessions[roomID] = persistedOutboundGroupSession{
			Pickle:          pickled,
			ExpirationMixin: session.ExpirationMixin,
			MaxMessages:     session.MaxMessages,
			MessageCount:    session.MessageCount,
			Users:           users,
			RoomID:          session.RoomID,
			Shared:          session.Shared,
		}
	}
	for userID := range store.OutdatedUsers {
		snapshot.OutdatedUsers = append(snapshot.OutdatedUsers, userID)
	}
	store.auxLock.Lock()
	for key, value := range store.messageIndices {
		snapshot.MessageIndices = append(snapshot.MessageIndices, persistedMessageIndex{
			SenderKey: key.SenderKey,
			SessionID: key.SessionID,
			Index:     key.Index,
			EventID:   value.EventID,
			Timestamp: value.Timestamp,
		})
	}
	for hash, receivedAt := range store.olmHashes {
		snapshot.OlmHashes = append(snapshot.OlmHashes, persistedOlmHash{
			Hash:       hex.EncodeToString(hash[:]),
			ReceivedAt: receivedAt,
		})
	}
	store.auxLock.Unlock()
	return snapshot, nil
}
