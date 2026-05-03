package core

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/crypto"
	"maunium.net/go/mautrix/crypto/backup"
	"maunium.net/go/mautrix/id"
)

const (
	cryptoStoreFile        = "crypto.json"
	decryptionQueuePrefix  = "pending-decryption/"
	reactionSnapshotPrefix = "reaction/"
	recoveryBackupFile     = "recovery_backup.json"
	stateStoreFile         = "state.json"
	nextBatchFile          = "next_batch"
)

type byteStore interface {
	Delete(ctx context.Context, key string) error
	Get(ctx context.Context, key string) ([]byte, error)
	List(ctx context.Context, prefix string) ([]string, error)
	Set(ctx context.Context, key string, value []byte) error
}

func (bundle *storeBundle) LoadReactionSnapshots(ctx context.Context) ([]reactionSnapshot, error) {
	if bundle == nil || bundle.kv == nil {
		return nil, nil
	}
	keys, err := bundle.kv.List(ctx, bundle.prefix+reactionSnapshotPrefix)
	if err != nil {
		return nil, err
	}
	reactions := make([]reactionSnapshot, 0, len(keys))
	for _, key := range keys {
		raw, err := bundle.kv.Get(ctx, key)
		if err != nil || raw == nil {
			return nil, err
		}
		var snapshot reactionSnapshot
		if err := json.Unmarshal(raw, &snapshot); err != nil {
			return nil, err
		}
		reactions = append(reactions, snapshot)
	}
	return reactions, nil
}

func (bundle *storeBundle) SaveReactionSnapshot(ctx context.Context, snapshot reactionSnapshot) error {
	if bundle == nil || bundle.kv == nil || snapshot.EventID == "" {
		return nil
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	return bundle.kv.Set(ctx, bundle.prefix+reactionSnapshotPrefix+snapshot.EventID.String(), raw)
}

func (bundle *storeBundle) DeleteReactionSnapshot(ctx context.Context, eventID id.EventID) error {
	if bundle == nil || bundle.kv == nil || eventID == "" {
		return nil
	}
	return bundle.kv.Delete(ctx, bundle.prefix+reactionSnapshotPrefix+eventID.String())
}

type storeBundle struct {
	CryptoStore crypto.Store
	StateStore  mautrix.StateStore
	kv          byteStore
	pickleKey   []byte
	prefix      string
}

func newMemoryStoreBundle() *storeBundle {
	return &storeBundle{
		CryptoStore: crypto.NewMemoryStore(nil),
		StateStore:  mautrix.NewMemoryStateStore(),
	}
}

func newPersistentStoreBundle(ctx context.Context, kv byteStore, prefix string, pickleKey []byte) (*storeBundle, error) {
	cryptoStore, err := newPersistentCryptoStore(ctx, kv, prefix+cryptoStoreFile, pickleKey)
	if err != nil {
		return nil, fmt.Errorf("failed to load Matrix crypto store: %w", err)
	}
	stateStore, err := newPersistentStateStore(ctx, kv, prefix+stateStoreFile)
	if err != nil {
		return nil, fmt.Errorf("failed to load Matrix state store: %w", err)
	}
	return &storeBundle{
		CryptoStore: cryptoStore,
		StateStore:  stateStore,
		kv:          kv,
		pickleKey:   pickleKey,
		prefix:      prefix,
	}, nil
}

type persistedRecoveryBackup struct {
	Ciphertext      string `json:"ciphertext"`
	Nonce           string `json:"nonce"`
	RecoveryKeyHash string `json:"recoveryKeyHash"`
	Version         string `json:"version,omitempty"`
}

func (bundle *storeBundle) LoadRecoveryBackup(ctx context.Context, recoveryKey string) (id.KeyBackupVersion, *backup.MegolmBackupKey, bool, error) {
	if bundle == nil || bundle.kv == nil || recoveryKey == "" {
		return "", nil, false, nil
	}
	raw, err := bundle.kv.Get(ctx, bundle.prefix+recoveryBackupFile)
	if err != nil || raw == nil {
		return "", nil, false, err
	}
	var persisted persistedRecoveryBackup
	if err := json.Unmarshal(raw, &persisted); err != nil {
		return "", nil, false, err
	}
	if persisted.RecoveryKeyHash != recoveryKeyHash(recoveryKey) {
		return "", nil, false, nil
	}
	keyBytes, err := bundle.openRecoveryBackup(persisted)
	if err != nil {
		return "", nil, false, err
	}
	backupKey, err := backup.MegolmBackupKeyFromBytes(keyBytes)
	if err != nil {
		return "", nil, false, err
	}
	return id.KeyBackupVersion(persisted.Version), backupKey, true, nil
}

func (bundle *storeBundle) SaveRecoveryBackup(ctx context.Context, recoveryKey string, version id.KeyBackupVersion, backupKey *backup.MegolmBackupKey) error {
	if bundle == nil || bundle.kv == nil || recoveryKey == "" || backupKey == nil {
		return nil
	}
	persisted, err := bundle.sealRecoveryBackup(recoveryKey, version, backupKey.Bytes())
	if err != nil {
		return err
	}
	raw, err := json.Marshal(persisted)
	if err != nil {
		return err
	}
	return bundle.kv.Set(ctx, bundle.prefix+recoveryBackupFile, raw)
}

func (bundle *storeBundle) sealRecoveryBackup(recoveryKey string, version id.KeyBackupVersion, keyBytes []byte) (persistedRecoveryBackup, error) {
	aead, err := bundle.recoveryBackupAEAD()
	if err != nil {
		return persistedRecoveryBackup{}, err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return persistedRecoveryBackup{}, err
	}
	ciphertext := aead.Seal(nil, nonce, keyBytes, nil)
	return persistedRecoveryBackup{
		Ciphertext:      base64.RawStdEncoding.EncodeToString(ciphertext),
		Nonce:           base64.RawStdEncoding.EncodeToString(nonce),
		RecoveryKeyHash: recoveryKeyHash(recoveryKey),
		Version:         version.String(),
	}, nil
}

func (bundle *storeBundle) openRecoveryBackup(persisted persistedRecoveryBackup) ([]byte, error) {
	aead, err := bundle.recoveryBackupAEAD()
	if err != nil {
		return nil, err
	}
	nonce, err := base64.RawStdEncoding.DecodeString(persisted.Nonce)
	if err != nil {
		return nil, err
	}
	ciphertext, err := base64.RawStdEncoding.DecodeString(persisted.Ciphertext)
	if err != nil {
		return nil, err
	}
	return aead.Open(nil, nonce, ciphertext, nil)
}

func (bundle *storeBundle) recoveryBackupAEAD() (cipher.AEAD, error) {
	seed := sha256.Sum256(append([]byte("easymatrix recovery backup cache\x00"), bundle.pickleKey...))
	block, err := aes.NewCipher(seed[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func recoveryKeyHash(recoveryKey string) string {
	hash := sha256.Sum256([]byte(recoveryKey))
	return base64.RawStdEncoding.EncodeToString(hash[:])
}

func (bundle *storeBundle) LoadNextBatch(ctx context.Context) (string, error) {
	if bundle == nil || bundle.kv == nil {
		return "", nil
	}
	raw, err := bundle.kv.Get(ctx, bundle.prefix+nextBatchFile)
	if err != nil || raw == nil {
		return "", err
	}
	return string(raw), nil
}

func (bundle *storeBundle) SaveNextBatch(ctx context.Context, nextBatch string) error {
	if bundle == nil || bundle.kv == nil {
		return nil
	}
	if nextBatch == "" {
		return bundle.kv.Delete(ctx, bundle.prefix+nextBatchFile)
	}
	return bundle.kv.Set(ctx, bundle.prefix+nextBatchFile, []byte(nextBatch))
}

func (bundle *storeBundle) LoadPendingDecryption(ctx context.Context) ([]pendingDecryption, error) {
	if bundle == nil || bundle.kv == nil {
		return nil, nil
	}
	keys, err := bundle.kv.List(ctx, bundle.prefix+decryptionQueuePrefix)
	if err != nil {
		return nil, err
	}
	pending := make([]pendingDecryption, 0, len(keys))
	for _, key := range keys {
		raw, err := bundle.kv.Get(ctx, key)
		if err != nil || raw == nil {
			return nil, err
		}
		var item pendingDecryption
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		pending = append(pending, item)
	}
	return pending, nil
}

func (bundle *storeBundle) SavePendingDecryption(ctx context.Context, pending []pendingDecryption) error {
	if bundle == nil || bundle.kv == nil {
		return nil
	}
	keys, err := bundle.kv.List(ctx, bundle.prefix+decryptionQueuePrefix)
	if err != nil {
		return err
	}
	for _, key := range keys {
		if err := bundle.kv.Delete(ctx, key); err != nil {
			return err
		}
	}
	for _, item := range pending {
		raw, err := json.Marshal(item)
		if err != nil {
			return err
		}
		if err := bundle.kv.Set(ctx, bundle.prefix+decryptionQueuePrefix+item.EventID, raw); err != nil {
			return err
		}
	}
	return nil
}
