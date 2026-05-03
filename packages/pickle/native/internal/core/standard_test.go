package core

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/id"
)

func TestStandardMatrixHelpersUseExpectedEndpoints(t *testing.T) {
	var seen []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.RequestURI())
		switch r.URL.Path {
		case "/_matrix/client/v3/user/@alice:example/account_data/m.preference":
			if r.Method == http.MethodGet {
				_ = json.NewEncoder(w).Encode(map[string]any{"theme": "dark"})
				return
			}
			if r.Method == http.MethodPut {
				_, _ = w.Write([]byte(`{}`))
				return
			}
		case "/_matrix/client/v3/user/@alice:example/rooms/!room:example/account_data/m.room.preference",
			"/_matrix/client/v3/user/@alice:example/rooms/%21room:example/account_data/m.room.preference":
			if r.Method == http.MethodGet {
				_ = json.NewEncoder(w).Encode(map[string]any{"muted": true})
				return
			}
			if r.Method == http.MethodPut {
				_, _ = w.Write([]byte(`{}`))
				return
			}
		case "/_matrix/client/v3/sendToDevice/m.test/txn":
			if r.Method == http.MethodPut {
				_ = json.NewEncoder(w).Encode(map[string]any{})
				return
			}
		case "/_matrix/client/v3/rooms/!room:example/receipt/m.read.private/$event",
			"/_matrix/client/v3/rooms/%21room:example/receipt/m.read.private/%24event":
			if r.Method == http.MethodPost {
				_, _ = w.Write([]byte(`{}`))
				return
			}
		case "/_matrix/client/v3/custom":
			if r.Method == http.MethodPost && r.URL.Query().Get("q") == "1" {
				_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
				return
			}
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	core := New(nil)
	core.client, _ = mautrix.NewClient(server.URL, id.UserID("@alice:example"), "token")
	core.client.DeviceID = id.DeviceID("DEVICE")
	ctx := context.Background()

	raw, err := core.handleGetAccountData(ctx, []byte(`{"eventType":"m.preference"}`))
	if err != nil {
		t.Fatal(err)
	}
	var accountData MatrixAccountDataResult
	if err := json.Unmarshal(raw, &accountData); err != nil {
		t.Fatal(err)
	}
	if accountData.Content["theme"] != "dark" {
		t.Fatalf("unexpected account data: %#v", accountData.Content)
	}
	if _, err := core.handleSetAccountData(ctx, []byte(`{"eventType":"m.preference","content":{"theme":"light"}}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := core.handleGetRoomAccountData(ctx, []byte(`{"roomId":"!room:example","eventType":"m.room.preference"}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := core.handleSetRoomAccountData(ctx, []byte(`{"roomId":"!room:example","eventType":"m.room.preference","content":{"muted":false}}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := core.handleSendToDevice(ctx, []byte(`{"eventType":"m.test","userId":"@bob:example","deviceId":"BOB","content":{"hello":true},"transactionId":"txn"}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := core.handleSendReceipt(ctx, []byte(`{"roomId":"!room:example","eventId":"$event","receiptType":"m.read.private","threadId":"$thread"}`)); err != nil {
		t.Fatal(err)
	}
	raw, err = core.handleRawRequest(ctx, []byte(`{"method":"POST","path":"/_matrix/client/v3/custom","query":{"q":"1"},"body":{"include":true}}`))
	if err != nil {
		t.Fatal(err)
	}
	var rawResult MatrixRawRequestResult
	if err := json.Unmarshal(raw, &rawResult); err != nil {
		t.Fatal(err)
	}
	if rawResult.Status != http.StatusOK {
		t.Fatalf("unexpected raw request status %d", rawResult.Status)
	}

	expected := []string{
		"GET /_matrix/client/v3/user/@alice:example/account_data/m.preference",
		"PUT /_matrix/client/v3/user/@alice:example/account_data/m.preference",
		"GET /_matrix/client/v3/user/@alice:example/rooms/%21room:example/account_data/m.room.preference",
		"PUT /_matrix/client/v3/user/@alice:example/rooms/%21room:example/account_data/m.room.preference",
		"PUT /_matrix/client/v3/sendToDevice/m.test/txn",
		"POST /_matrix/client/v3/rooms/%21room:example/receipt/m.read.private/$event",
		"POST /_matrix/client/v3/custom?q=1",
	}
	if len(seen) != len(expected) {
		t.Fatalf("expected %d requests, got %d: %#v", len(expected), len(seen), seen)
	}
	for index, want := range expected {
		if seen[index] != want {
			t.Fatalf("request %d: expected %q, got %q", index, want, seen[index])
		}
	}
}

func TestLogoutUsesMatrixLogoutEndpoint(t *testing.T) {
	var seen string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = r.Method + " " + r.URL.Path
		if r.Method == http.MethodPost && r.URL.Path == "/_matrix/client/v3/logout" {
			_, _ = w.Write([]byte(`{}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	core := New(nil)
	core.client, _ = mautrix.NewClient(server.URL, id.UserID("@alice:example"), "token")
	if _, err := core.handleLogout(context.Background()); err != nil {
		t.Fatal(err)
	}
	if seen != "POST /_matrix/client/v3/logout" {
		t.Fatalf("unexpected logout request %q", seen)
	}
}

func TestRawRequestRejectsAbsoluteURLs(t *testing.T) {
	core := New(nil)
	core.client, _ = mautrix.NewClient("https://example.com", id.UserID("@alice:example"), "token")

	_, err := core.handleRawRequest(context.Background(), []byte(`{"path":"https://evil.example/_matrix/client/v3/account/whoami"}`))
	if err == nil || err.Error() != "raw request path must be relative to the homeserver" {
		t.Fatalf("expected relative path error, got %v", err)
	}
}
