package core

import (
	"encoding/json"
	"testing"

	"maunium.net/go/mautrix/id"
)

func TestCryptoStatusReportsMissingRecoveryBackupState(t *testing.T) {
	core := New(nil)
	core.cryptoStatus = "key_backup_unavailable"
	core.deviceID = id.DeviceID("DEVICE")
	core.userID = id.UserID("@bot:example")

	raw, err := core.handleGetCryptoStatus()
	if err != nil {
		t.Fatal(err)
	}
	var status MatrixCryptoStatus
	if err := json.Unmarshal(raw, &status); err != nil {
		t.Fatal(err)
	}
	if status.State != "key_backup_unavailable" {
		t.Fatalf("expected key backup unavailable state, got %q", status.State)
	}
	if status.HasRecoveryKey {
		t.Fatal("missing backup status should not report a loaded recovery key")
	}
	if status.UserID != "@bot:example" || status.DeviceID != "DEVICE" {
		t.Fatalf("unexpected status identity: %#v", status)
	}
}
