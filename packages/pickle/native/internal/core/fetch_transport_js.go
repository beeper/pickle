//go:build js && wasm

package core

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"syscall/js"

	"maunium.net/go/mautrix"
)

func configureHTTPClient(cli *mautrix.Client, host RuntimeHost) {
	transport := jsFetchTransport{host: host}
	cli.Client = &http.Client{Transport: transport}
	cli.ExternalClient = &http.Client{Transport: transport}
}

type jsFetchTransport struct {
	host RuntimeHost
}

func (transport jsFetchTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	fetch := transport.resolveFetch()
	if fetch.Type() != js.TypeFunction {
		return nil, fmt.Errorf("javascript fetch is not available")
	}

	headers := js.Global().Get("Headers").New()
	for key, values := range req.Header {
		for _, value := range values {
			headers.Call("append", key, value)
		}
	}

	options := map[string]any{
		"headers": headers,
		"method":  req.Method,
	}
	if req.Body != nil {
		body, err := io.ReadAll(req.Body)
		if err != nil {
			return nil, err
		}
		if len(body) > 0 {
			array := js.Global().Get("Uint8Array").New(len(body))
			js.CopyBytesToJS(array, body)
			options["body"] = array
		}
	}

	responseValue, err := awaitJS(req.Context(), fetch.Invoke(req.URL.String(), js.ValueOf(options)))
	if err != nil {
		return nil, err
	}

	arrayBuffer, err := awaitJS(req.Context(), responseValue.Call("arrayBuffer"))
	if err != nil {
		return nil, err
	}
	bodyBytes := make([]byte, arrayBuffer.Get("byteLength").Int())
	if len(bodyBytes) > 0 {
		js.CopyBytesToGo(bodyBytes, js.Global().Get("Uint8Array").New(arrayBuffer))
	}

	header := http.Header{}
	forEach := js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) >= 2 {
			header.Add(args[1].String(), args[0].String())
		}
		return nil
	})
	responseValue.Get("headers").Call("forEach", forEach)
	forEach.Release()

	statusCode := responseValue.Get("status").Int()
	statusText := responseValue.Get("statusText").String()
	if statusText == "" {
		statusText = http.StatusText(statusCode)
	}
	resp := &http.Response{
		Body:          io.NopCloser(bytes.NewReader(bodyBytes)),
		ContentLength: int64(len(bodyBytes)),
		Header:        header,
		Request:       req,
		Status:        strconv.Itoa(statusCode) + " " + statusText,
		StatusCode:    statusCode,
	}
	return resp, nil
}

func (transport jsFetchTransport) resolveFetch() js.Value {
	fetch := transport.host.get("fetch")
	if fetch.Type() == js.TypeFunction {
		return fetch
	}
	return js.Global().Get("fetch")
}
