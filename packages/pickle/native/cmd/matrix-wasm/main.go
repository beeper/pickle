//go:build js && wasm

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"sync"
	"syscall/js"

	"github.com/beeper/pickle/packages/pickle/native/internal/core"
)

func main() {
	var lock sync.Mutex
	var nextID int
	cores := make(map[string]*core.Core)

	js.Global().Set("__matrixCoreCreate", js.FuncOf(func(_ js.Value, args []js.Value) any {
		lock.Lock()
		defer lock.Unlock()
		nextID++
		coreID := strconv.Itoa(nextID)
		host := core.DefaultRuntimeHost()
		if len(args) > 0 {
			host = core.NewRuntimeHost(args[0])
		}
		cores[coreID] = core.New(func(evt core.OutboundEvent) {
			payload, err := json.Marshal(evt)
			if err != nil {
				return
			}
			emit := js.Global().Get("__matrixCoreEmit")
			if emit.Type() == js.TypeFunction {
				emit.Invoke(coreID, string(payload))
			}
		}, host)
		return coreID
	}))

	js.Global().Set("__matrixCoreCall", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 3 {
			return promise(func(_ js.Value, reject js.Value) {
				reject.Invoke("expected core ID, operation and payload")
			})
		}
		coreID := args[0].String()
		op := args[1].String()
		payload := []byte(args[2].String())
		return promise(func(resolve js.Value, reject js.Value) {
			go func() {
				lock.Lock()
				matrixCore := cores[coreID]
				lock.Unlock()
				if matrixCore == nil {
					reject.Invoke("unknown matrix core ID")
					return
				}
				resp, err := matrixCore.Handle(context.Background(), op, payload)
				if err != nil {
					reject.Invoke(err.Error())
					return
				}
				if op == "close" {
					lock.Lock()
					delete(cores, coreID)
					lock.Unlock()
				}
				resolve.Invoke(string(resp))
			}()
		})
	}))

	js.Global().Set("__matrixCoreCallBytes", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) < 3 || len(args) > 4 {
			return promise(func(_ js.Value, reject js.Value) {
				reject.Invoke("expected core ID, operation, payload and optional bytes")
			})
		}
		coreID := args[0].String()
		op := args[1].String()
		payload := []byte(args[2].String())
		var data []byte
		if len(args) == 4 && !args[3].IsUndefined() && !args[3].IsNull() {
			data = make([]byte, args[3].Get("byteLength").Int())
			js.CopyBytesToGo(data, args[3])
		}
		return promise(func(resolve js.Value, reject js.Value) {
			go func() {
				lock.Lock()
				matrixCore := cores[coreID]
				lock.Unlock()
				if matrixCore == nil {
					reject.Invoke("unknown matrix core ID")
					return
				}
				resp, err := matrixCore.HandleBytes(context.Background(), op, payload, data)
				if err != nil {
					reject.Invoke(err.Error())
					return
				}
				switch value := resp.(type) {
				case []byte:
					array := js.Global().Get("Uint8Array").New(len(value))
					js.CopyBytesToJS(array, value)
					resolve.Invoke(array)
				case string:
					resolve.Invoke(value)
				default:
					jsonResp, err := json.Marshal(value)
					if err != nil {
						reject.Invoke(err.Error())
						return
					}
					resolve.Invoke(string(jsonResp))
				}
			}()
		})
	}))

	select {}
}

func promise(fn func(resolve js.Value, reject js.Value)) js.Value {
	promiseCtor := js.Global().Get("Promise")
	return promiseCtor.New(js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 2 {
			panic(fmt.Errorf("promise executor received %d args", len(args)))
		}
		resolve, reject := args[0], args[1]
		fn(resolve, reject)
		return nil
	}))
}
