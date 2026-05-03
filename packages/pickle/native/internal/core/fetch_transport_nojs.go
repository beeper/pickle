//go:build !js || !wasm

package core

import "maunium.net/go/mautrix"

func configureHTTPClient(_ *mautrix.Client, _ RuntimeHost) {}
