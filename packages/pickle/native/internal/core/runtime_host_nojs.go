//go:build !js || !wasm

package core

type RuntimeHost struct{}

func DefaultRuntimeHost() RuntimeHost {
	return RuntimeHost{}
}
