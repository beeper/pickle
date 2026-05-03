//go:build !js || !wasm

package core

import (
	"context"

	"maunium.net/go/mautrix/id"
)

func loadStoreBundle(_ context.Context, _ RuntimeHost, _ string, _ id.UserID, _ id.DeviceID, _ []byte) (*storeBundle, error) {
	return newMemoryStoreBundle(), nil
}
