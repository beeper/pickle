//go:build js && wasm

package core

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"syscall/js"

	"maunium.net/go/mautrix/id"
)

type jsByteStore struct {
	value js.Value
}

func loadStoreBundle(ctx context.Context, host RuntimeHost, homeserverURL string, userID id.UserID, deviceID id.DeviceID, pickleKey []byte) (*storeBundle, error) {
	rawStore := host.get("state")
	if rawStore.IsUndefined() || rawStore.IsNull() {
		return newMemoryStoreBundle(), nil
	}
	kv := jsByteStore{value: rawStore}
	prefix := persistentStorePrefix(homeserverURL, userID, deviceID)
	return newPersistentStoreBundle(ctx, kv, prefix, pickleKey)
}

func persistentStorePrefix(homeserverURL string, userID id.UserID, deviceID id.DeviceID) string {
	homeHash := sha256.Sum256([]byte(homeserverURL))
	homeKey := base64.RawURLEncoding.EncodeToString(homeHash[:])
	userKey := base64.RawURLEncoding.EncodeToString([]byte(userID.String()))
	deviceKey := base64.RawURLEncoding.EncodeToString([]byte(deviceID.String()))
	return "pickle/v1/" + homeKey + "/" + userKey + "/" + deviceKey + "/"
}

func (store jsByteStore) Get(ctx context.Context, key string) ([]byte, error) {
	value, err := awaitJS(ctx, store.value.Call("get", key))
	if err != nil || value.IsUndefined() || value.IsNull() {
		return nil, err
	}
	length := value.Get("byteLength").Int()
	if length == 0 {
		return []byte{}, nil
	}
	bytes := make([]byte, length)
	js.CopyBytesToGo(bytes, value)
	return bytes, nil
}

func (store jsByteStore) Set(ctx context.Context, key string, value []byte) error {
	array := js.Global().Get("Uint8Array").New(len(value))
	js.CopyBytesToJS(array, value)
	_, err := awaitJS(ctx, store.value.Call("set", key, array))
	return err
}

func (store jsByteStore) Delete(ctx context.Context, key string) error {
	_, err := awaitJS(ctx, store.value.Call("delete", key))
	return err
}

func (store jsByteStore) List(ctx context.Context, prefix string) ([]string, error) {
	value, err := awaitJS(ctx, store.value.Call("list", prefix))
	if err != nil || value.IsUndefined() || value.IsNull() {
		return nil, err
	}
	length := value.Get("length").Int()
	keys := make([]string, 0, length)
	for i := 0; i < length; i++ {
		keys = append(keys, value.Index(i).String())
	}
	return keys, nil
}

type jsAwaitResult struct {
	value js.Value
	err   error
}

func awaitJS(ctx context.Context, value js.Value) (js.Value, error) {
	if value.IsUndefined() || value.IsNull() || value.Get("then").Type() != js.TypeFunction {
		return value, nil
	}
	done := make(chan jsAwaitResult, 1)
	resolve := js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) == 0 {
			done <- jsAwaitResult{}
		} else {
			done <- jsAwaitResult{value: args[0]}
		}
		return nil
	})
	reject := js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) == 0 {
			done <- jsAwaitResult{err: fmt.Errorf("javascript promise rejected")}
		} else {
			done <- jsAwaitResult{err: jsError(args[0])}
		}
		return nil
	})
	defer resolve.Release()
	defer reject.Release()
	value.Call("then", resolve).Call("catch", reject)
	select {
	case result := <-done:
		return result.value, result.err
	case <-ctx.Done():
		return js.Value{}, ctx.Err()
	}
}

func jsError(value js.Value) error {
	if value.IsUndefined() || value.IsNull() {
		return fmt.Errorf("javascript promise rejected")
	}
	if msg := value.Get("message"); msg.Type() == js.TypeString {
		return fmt.Errorf("%s", msg.String())
	}
	return fmt.Errorf("%s", value.String())
}
