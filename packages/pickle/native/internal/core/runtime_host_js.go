//go:build js && wasm

package core

import "syscall/js"

type RuntimeHost struct {
	value js.Value
}

func DefaultRuntimeHost() RuntimeHost {
	return RuntimeHost{value: js.Undefined()}
}

func NewRuntimeHost(value js.Value) RuntimeHost {
	return RuntimeHost{value: value}
}

func (host RuntimeHost) get(name string) js.Value {
	if host.value.IsUndefined() || host.value.IsNull() {
		return js.Undefined()
	}
	return host.value.Get(name)
}
