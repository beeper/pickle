package core

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

type MatrixAccountDataResult struct {
	Content map[string]any `json:"content"`
	Raw     any            `json:"raw"`
	Type    string         `json:"type"`
}

type MatrixGetAccountDataOptions struct {
	EventType string `json:"eventType"`
}

type MatrixSetAccountDataOptions struct {
	Content   map[string]any `json:"content"`
	EventType string         `json:"eventType"`
}

type MatrixGetRoomAccountDataOptions struct {
	EventType string `json:"eventType"`
	RoomID    string `json:"roomId"`
}

type MatrixSetRoomAccountDataOptions struct {
	Content   map[string]any `json:"content"`
	EventType string         `json:"eventType"`
	RoomID    string         `json:"roomId"`
}

type MatrixSendToDeviceOptions struct {
	Content       map[string]any                       `json:"content,omitempty"`
	EventType     string                               `json:"eventType"`
	Messages      map[string]map[string]map[string]any `json:"messages,omitempty"`
	TransactionID string                               `json:"transactionId,omitempty"`
	UserID        string                               `json:"userId,omitempty"`
	DeviceID      string                               `json:"deviceId,omitempty"`
}

type MatrixSendToDeviceResult struct {
	Raw any `json:"raw"`
}

type MatrixSendReceiptOptions struct {
	Content     map[string]any `json:"content,omitempty"`
	EventID     string         `json:"eventId"`
	ReceiptType string         `json:"receiptType,omitempty"`
	RoomID      string         `json:"roomId"`
	ThreadID    string         `json:"threadId,omitempty"`
}

type MatrixRawRequestOptions struct {
	Body    any               `json:"body,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
	Method  string            `json:"method,omitempty"`
	Path    string            `json:"path"`
	Query   map[string]string `json:"query,omitempty"`
}

type MatrixRawRequestResult struct {
	Body   any               `json:"body,omitempty"`
	Raw    any               `json:"raw,omitempty"`
	Status int               `json:"status"`
	Header map[string]string `json:"headers,omitempty"`
}

func (c *Core) handleGetAccountData(ctx context.Context, payload []byte) ([]byte, error) {
	var req MatrixGetAccountDataOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.EventType == "" {
		return nil, errors.New("eventType is required")
	}
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var content map[string]any
	if err := cli.GetAccountData(ctx, req.EventType, &content); err != nil {
		return nil, err
	}
	return json.Marshal(MatrixAccountDataResult{Content: content, Raw: content, Type: req.EventType})
}

func (c *Core) handleSetAccountData(ctx context.Context, payload []byte) ([]byte, error) {
	var req MatrixSetAccountDataOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.EventType == "" {
		return nil, errors.New("eventType is required")
	}
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	return c.emptyIfNil(cli.SetAccountData(ctx, req.EventType, req.Content))
}

func (c *Core) handleGetRoomAccountData(ctx context.Context, payload []byte) ([]byte, error) {
	var req MatrixGetRoomAccountDataOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.EventType == "" || req.RoomID == "" {
		return nil, errors.New("roomId and eventType are required")
	}
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var content map[string]any
	if err := cli.GetRoomAccountData(ctx, id.RoomID(req.RoomID), req.EventType, &content); err != nil {
		return nil, err
	}
	return json.Marshal(MatrixAccountDataResult{Content: content, Raw: content, Type: req.EventType})
}

func (c *Core) handleSetRoomAccountData(ctx context.Context, payload []byte) ([]byte, error) {
	var req MatrixSetRoomAccountDataOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.EventType == "" || req.RoomID == "" {
		return nil, errors.New("roomId and eventType are required")
	}
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	return c.emptyIfNil(cli.SetRoomAccountData(ctx, id.RoomID(req.RoomID), req.EventType, req.Content))
}

func (c *Core) handleSendToDevice(ctx context.Context, payload []byte) ([]byte, error) {
	var req MatrixSendToDeviceOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.EventType == "" {
		return nil, errors.New("eventType is required")
	}
	messages := req.Messages
	if len(messages) == 0 && req.UserID != "" && req.DeviceID != "" {
		messages = map[string]map[string]map[string]any{req.UserID: {req.DeviceID: req.Content}}
	}
	if len(messages) == 0 {
		return nil, errors.New("messages or userId/deviceId/content are required")
	}
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	converted := make(map[id.UserID]map[id.DeviceID]*event.Content, len(messages))
	for userID, devices := range messages {
		converted[id.UserID(userID)] = make(map[id.DeviceID]*event.Content, len(devices))
		for deviceID, content := range devices {
			converted[id.UserID(userID)][id.DeviceID(deviceID)] = &event.Content{Raw: content}
		}
	}
	toDeviceReq := &mautrix.ReqSendToDevice{Messages: converted}
	var resp *mautrix.RespSendToDevice
	if req.TransactionID != "" {
		urlPath := cli.BuildClientURL("v3", "sendToDevice", req.EventType, req.TransactionID)
		_, err = cli.MakeRequest(ctx, http.MethodPut, urlPath, toDeviceReq, &resp)
	} else {
		resp, err = cli.SendToDevice(ctx, event.Type{Type: req.EventType}, toDeviceReq)
	}
	if err != nil {
		return nil, err
	}
	return json.Marshal(MatrixSendToDeviceResult{Raw: resp})
}

func (c *Core) handleSendReceipt(ctx context.Context, payload []byte) ([]byte, error) {
	var req MatrixSendReceiptOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.RoomID == "" || req.EventID == "" {
		return nil, errors.New("roomId and eventId are required")
	}
	receiptType := event.ReceiptTypeRead
	if req.ReceiptType != "" {
		receiptType = event.ReceiptType(req.ReceiptType)
	}
	var content any = map[string]any{}
	if len(req.Content) > 0 {
		content = req.Content
	}
	if req.ThreadID != "" {
		content = mautrix.ReqSendReceipt{ThreadID: req.ThreadID}
		if len(req.Content) > 0 {
			req.Content["thread_id"] = req.ThreadID
			content = req.Content
		}
	}
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	return c.emptyIfNil(cli.SendReceipt(ctx, id.RoomID(req.RoomID), id.EventID(req.EventID), receiptType, content))
}

func (c *Core) handleRawRequest(ctx context.Context, payload []byte) ([]byte, error) {
	var req MatrixRawRequestOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.Path == "" {
		return nil, errors.New("path is required")
	}
	method := req.Method
	if method == "" {
		method = http.MethodGet
	}
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	rawURL, err := rawClientURL(cli, req.Path, req.Query)
	if err != nil {
		return nil, err
	}
	headers := http.Header{}
	for key, value := range req.Headers {
		headers.Set(key, value)
	}
	var body any
	data, resp, err := cli.MakeFullRequestWithResp(ctx, mautrix.FullRequest{
		Headers:      headers,
		Method:       method,
		RequestJSON:  req.Body,
		ResponseJSON: &body,
		URL:          rawURL,
	})
	if err != nil {
		return nil, err
	}
	result := MatrixRawRequestResult{Body: body, Raw: json.RawMessage(data), Status: resp.StatusCode}
	if len(resp.Header) > 0 {
		result.Header = make(map[string]string, len(resp.Header))
		for key, values := range resp.Header {
			if len(values) > 0 {
				result.Header[key] = values[0]
			}
		}
	}
	return json.Marshal(result)
}

func rawClientURL(cli *mautrix.Client, path string, query map[string]string) (string, error) {
	if strings.Contains(path, "://") {
		return "", errors.New("raw request path must be relative to the homeserver")
	}
	path = "/" + strings.TrimPrefix(path, "/")
	base := *cli.HomeserverURL
	parsed, err := url.Parse(path)
	if err != nil {
		return "", err
	}
	base.Path = parsed.Path
	base.RawPath = parsed.EscapedPath()
	values := base.Query()
	if parsed.RawQuery != "" {
		parsedValues, err := url.ParseQuery(parsed.RawQuery)
		if err != nil {
			return "", err
		}
		for key, entries := range parsedValues {
			for _, value := range entries {
				values.Add(key, value)
			}
		}
	}
	for key, value := range query {
		values.Set(key, value)
	}
	base.RawQuery = values.Encode()
	return base.String(), nil
}
