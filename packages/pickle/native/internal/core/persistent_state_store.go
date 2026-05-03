package core

import (
	"context"
	"encoding/json"
	"fmt"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

type persistentStateStore struct {
	*mautrix.MemoryStateStore

	kv  byteStore
	key string
}

func newPersistentStateStore(ctx context.Context, kv byteStore, key string) (*persistentStateStore, error) {
	mem, ok := mautrix.NewMemoryStateStore().(*mautrix.MemoryStateStore)
	if !ok {
		return nil, fmt.Errorf("unexpected Matrix memory state store type")
	}
	store := &persistentStateStore{
		MemoryStateStore: mem,
		kv:               kv,
		key:              key,
	}
	raw, err := kv.Get(ctx, key)
	if err != nil || raw == nil {
		return store, err
	}
	if err = json.Unmarshal(raw, store.MemoryStateStore); err != nil {
		return nil, err
	}
	ensureStateStoreMaps(store.MemoryStateStore)
	return store, nil
}

func (store *persistentStateStore) save(ctx context.Context) error {
	raw, err := json.Marshal(store.MemoryStateStore)
	if err != nil {
		return err
	}
	return store.kv.Set(ctx, store.key, raw)
}

func (store *persistentStateStore) UpdateState(ctx context.Context, evt *event.Event) {
	mautrix.UpdateStateStore(ctx, store.MemoryStateStore, evt)
	_ = store.save(ctx)
}

func (store *persistentStateStore) MarkRegistered(ctx context.Context, userID id.UserID) error {
	if err := store.MemoryStateStore.MarkRegistered(ctx, userID); err != nil {
		return err
	}
	return store.save(ctx)
}

func (store *persistentStateStore) SetMembership(ctx context.Context, roomID id.RoomID, userID id.UserID, membership event.Membership) error {
	if err := store.MemoryStateStore.SetMembership(ctx, roomID, userID, membership); err != nil {
		return err
	}
	return store.save(ctx)
}

func (store *persistentStateStore) SetMember(ctx context.Context, roomID id.RoomID, userID id.UserID, member *event.MemberEventContent) error {
	if err := store.MemoryStateStore.SetMember(ctx, roomID, userID, member); err != nil {
		return err
	}
	return store.save(ctx)
}

func (store *persistentStateStore) ClearCachedMembers(ctx context.Context, roomID id.RoomID, memberships ...event.Membership) error {
	if err := store.MemoryStateStore.ClearCachedMembers(ctx, roomID, memberships...); err != nil {
		return err
	}
	return store.save(ctx)
}

func (store *persistentStateStore) ReplaceCachedMembers(ctx context.Context, roomID id.RoomID, evts []*event.Event, onlyMemberships ...event.Membership) error {
	if err := store.MemoryStateStore.ReplaceCachedMembers(ctx, roomID, evts, onlyMemberships...); err != nil {
		return err
	}
	return store.save(ctx)
}

func (store *persistentStateStore) MarkMembersFetched(ctx context.Context, roomID id.RoomID) error {
	if err := store.MemoryStateStore.MarkMembersFetched(ctx, roomID); err != nil {
		return err
	}
	return store.save(ctx)
}

func (store *persistentStateStore) SetPowerLevels(ctx context.Context, roomID id.RoomID, levels *event.PowerLevelsEventContent) error {
	if err := store.MemoryStateStore.SetPowerLevels(ctx, roomID, levels); err != nil {
		return err
	}
	return store.save(ctx)
}

func (store *persistentStateStore) SetCreate(ctx context.Context, evt *event.Event) error {
	if err := store.MemoryStateStore.SetCreate(ctx, evt); err != nil {
		return err
	}
	return store.save(ctx)
}

func (store *persistentStateStore) SetJoinRules(ctx context.Context, roomID id.RoomID, content *event.JoinRulesEventContent) error {
	if err := store.MemoryStateStore.SetJoinRules(ctx, roomID, content); err != nil {
		return err
	}
	return store.save(ctx)
}

func (store *persistentStateStore) SetEncryptionEvent(ctx context.Context, roomID id.RoomID, content *event.EncryptionEventContent) error {
	if err := store.MemoryStateStore.SetEncryptionEvent(ctx, roomID, content); err != nil {
		return err
	}
	return store.save(ctx)
}

func ensureStateStoreMaps(store *mautrix.MemoryStateStore) {
	if store.Registrations == nil {
		store.Registrations = make(map[id.UserID]bool)
	}
	if store.Members == nil {
		store.Members = make(map[id.RoomID]map[id.UserID]*event.MemberEventContent)
	}
	if store.MembersFetched == nil {
		store.MembersFetched = make(map[id.RoomID]bool)
	}
	if store.PowerLevels == nil {
		store.PowerLevels = make(map[id.RoomID]*event.PowerLevelsEventContent)
	}
	if store.Encryption == nil {
		store.Encryption = make(map[id.RoomID]*event.EncryptionEventContent)
	}
	if store.Create == nil {
		store.Create = make(map[id.RoomID]*event.Event)
	}
	if store.JoinRules == nil {
		store.JoinRules = make(map[id.RoomID]*event.JoinRulesEventContent)
	}
}
