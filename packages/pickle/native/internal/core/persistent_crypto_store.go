package core

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"maunium.net/go/mautrix/crypto"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

type persistentCryptoStore struct {
	*crypto.MemoryStore

	kv             byteStore
	key            string
	pickleKey      []byte
	messageIndices map[storedMessageIndexKey]storedMessageIndexValue
	olmHashes      map[[32]byte]time.Time
	auxLock        sync.Mutex
}

type persistedCryptoSnapshot struct {
	Account               *persistedAccount                                                 `json:"account,omitempty"`
	Sessions              map[id.SenderKey][]persistedOlmSession                            `json:"sessions,omitempty"`
	GroupSessions         map[id.RoomID]map[id.SessionID]persistedInboundGroupSession       `json:"groupSessions,omitempty"`
	WithheldGroupSessions map[id.RoomID]map[id.SessionID]*event.RoomKeyWithheldEventContent `json:"withheldGroupSessions,omitempty"`
	OutGroupSessions      map[id.RoomID]persistedOutboundGroupSession                       `json:"outGroupSessions,omitempty"`
	SharedGroupSessions   map[id.UserID]map[id.IdentityKey]map[id.SessionID]struct{}        `json:"sharedGroupSessions,omitempty"`
	MessageIndices        []persistedMessageIndex                                           `json:"messageIndices,omitempty"`
	Devices               map[id.UserID]map[id.DeviceID]*id.Device                          `json:"devices,omitempty"`
	CrossSigningKeys      map[id.UserID]map[id.CrossSigningUsage]id.CrossSigningKey         `json:"crossSigningKeys,omitempty"`
	KeySignatures         map[id.UserID]map[id.Ed25519]map[id.UserID]map[id.Ed25519]string  `json:"keySignatures,omitempty"`
	OutdatedUsers         []id.UserID                                                       `json:"outdatedUsers,omitempty"`
	Secrets               map[id.Secret]string                                              `json:"secrets,omitempty"`
	OlmHashes             []persistedOlmHash                                                `json:"olmHashes,omitempty"`
}

type persistedAccount struct {
	KeyBackupVersion id.KeyBackupVersion `json:"keyBackupVersion,omitempty"`
	Pickle           []byte              `json:"pickle"`
	Shared           bool                `json:"shared"`
}

type persistedOlmSession struct {
	ExpirationMixin crypto.ExpirationMixin `json:"expirationMixin"`
	Pickle          []byte                 `json:"pickle"`
}

type persistedInboundGroupSession struct {
	ForwardingChains []string             `json:"forwardingChains,omitempty"`
	IsScheduled      bool                 `json:"isScheduled"`
	KeyBackupVersion id.KeyBackupVersion  `json:"keyBackupVersion,omitempty"`
	KeySource        id.KeySource         `json:"keySource,omitempty"`
	MaxAge           int64                `json:"maxAge"`
	MaxMessages      int                  `json:"maxMessages"`
	Pickle           []byte               `json:"pickle"`
	RatchetSafety    crypto.RatchetSafety `json:"ratchetSafety"`
	ReceivedAt       time.Time            `json:"receivedAt"`
	RoomID           id.RoomID            `json:"roomId"`
	SenderKey        id.Curve25519        `json:"senderKey"`
	SigningKey       id.Ed25519           `json:"signingKey"`
}

type persistedOutboundGroupSession struct {
	ExpirationMixin crypto.ExpirationMixin       `json:"expirationMixin"`
	MaxMessages     int                          `json:"maxMessages"`
	MessageCount    int                          `json:"messageCount"`
	Pickle          []byte                       `json:"pickle"`
	RoomID          id.RoomID                    `json:"roomId"`
	Shared          bool                         `json:"shared"`
	Users           []persistedOutboundUserState `json:"users,omitempty"`
}

type persistedOutboundUserState struct {
	DeviceID id.DeviceID     `json:"deviceId"`
	State    crypto.OGSState `json:"state"`
	UserID   id.UserID       `json:"userId"`
}

type storedMessageIndexKey struct {
	Index     uint
	SenderKey id.SenderKey
	SessionID id.SessionID
}

type storedMessageIndexValue struct {
	EventID   id.EventID
	Timestamp int64
}

type persistedMessageIndex struct {
	EventID   id.EventID   `json:"eventId"`
	Index     uint         `json:"index"`
	SenderKey id.SenderKey `json:"senderKey"`
	SessionID id.SessionID `json:"sessionId"`
	Timestamp int64        `json:"timestamp"`
}

type persistedOlmHash struct {
	Hash       string    `json:"hash"`
	ReceivedAt time.Time `json:"receivedAt"`
}

func newPersistentCryptoStore(ctx context.Context, kv byteStore, key string, pickleKey []byte) (*persistentCryptoStore, error) {
	store := &persistentCryptoStore{
		kv:             kv,
		key:            key,
		pickleKey:      pickleKey,
		messageIndices: make(map[storedMessageIndexKey]storedMessageIndexValue),
		olmHashes:      make(map[[32]byte]time.Time),
	}
	store.MemoryStore = crypto.NewMemoryStore(func() error {
		return store.save(context.Background())
	})
	raw, err := kv.Get(ctx, key)
	if err != nil || raw == nil {
		return store, err
	}
	var snapshot persistedCryptoSnapshot
	if err = json.Unmarshal(raw, &snapshot); err != nil {
		return nil, err
	}
	if err = store.applySnapshot(snapshot); err != nil {
		return nil, err
	}
	return store, nil
}
