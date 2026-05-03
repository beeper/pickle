package core

import "encoding/json"

type MatrixCryptoStatus struct {
	DeviceID               string `json:"deviceId,omitempty"`
	HasRecoveryKey         bool   `json:"hasRecoveryKey"`
	KeyBackupVersion       string `json:"keyBackupVersion,omitempty"`
	PendingDecryptionCount int    `json:"pendingDecryptionCount"`
	State                  string `json:"state" tstype:"\"disabled\" | \"enabled\" | \"key_backup_updated\" | \"key_backup_unavailable\" | \"recovery_cache_unavailable\" | \"recovery_key_cached\" | \"recovery_key_loaded\" | \"recovery_restored\" | \"recovery_unverified\""`
	StoreBacked            bool   `json:"storeBacked"`
	UserID                 string `json:"userId,omitempty"`
}

func (c *Core) handleGetCryptoStatus() ([]byte, error) {
	state := c.cryptoStatus
	if state == "" {
		state = "disabled"
	}
	return json.Marshal(MatrixCryptoStatus{
		DeviceID:               c.deviceID.String(),
		HasRecoveryKey:         c.backupKey != nil,
		KeyBackupVersion:       c.backupVersion.String(),
		PendingDecryptionCount: len(c.pendingDecryptions),
		State:                  state,
		StoreBacked:            c.stores != nil,
		UserID:                 c.userID.String(),
	})
}
