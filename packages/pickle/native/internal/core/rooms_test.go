package core

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/id"
)

func TestOpenDMReusesDirectChatByDefault(t *testing.T) {
	createRoomCalled := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/_matrix/client/v3/user/@alice:example/account_data/m.direct":
			_ = json.NewEncoder(w).Encode(map[string][]string{
				"@bob:example": {"!dm:example"},
			})
		case "/_matrix/client/v3/createRoom":
			createRoomCalled = true
			http.Error(w, "createRoom should not be called", http.StatusInternalServerError)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	core := New(nil)
	core.client, _ = mautrix.NewClient(server.URL, id.UserID("@alice:example"), "token")

	raw, err := core.handleOpenDM(context.Background(), []byte(`{"userId":"@bob:example"}`))
	if err != nil {
		t.Fatal(err)
	}
	var result MatrixOpenDMResult
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	if result.RoomID != "!dm:example" {
		t.Fatalf("expected existing DM room, got %q", result.RoomID)
	}
	if createRoomCalled {
		t.Fatal("openDM should reuse m.direct room by default")
	}
}

func TestOpenDMForceCreateIgnoresExistingDirectChat(t *testing.T) {
	createRoomCalled := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/_matrix/client/v3/user/@alice:example/account_data/m.direct":
			if r.Method == http.MethodGet {
				_ = json.NewEncoder(w).Encode(map[string][]string{
					"@bob:example": {"!dm:example"},
				})
				return
			}
			if r.Method == http.MethodPut {
				_, _ = w.Write([]byte(`{}`))
				return
			}
		case "/_matrix/client/v3/createRoom":
			createRoomCalled = true
			_ = json.NewEncoder(w).Encode(map[string]string{"room_id": "!new:example"})
			return
		case "/_matrix/client/v3/rooms/!new:example/invite":
			_, _ = w.Write([]byte(`{}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	core := New(nil)
	core.client, _ = mautrix.NewClient(server.URL, id.UserID("@alice:example"), "token")

	raw, err := core.handleOpenDM(context.Background(), []byte(`{"userId":"@bob:example","forceCreate":true}`))
	if err != nil {
		t.Fatal(err)
	}
	var result MatrixOpenDMResult
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	if result.RoomID != "!new:example" {
		t.Fatalf("expected new DM room, got %q", result.RoomID)
	}
	if !createRoomCalled {
		t.Fatal("forceCreate should create a new room")
	}
}

func TestFetchRoomUsesDirectAccountDataBeforeMemberCountFallback(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/_matrix/client/v3/user/@alice:example/account_data/m.direct":
			_ = json.NewEncoder(w).Encode(map[string][]string{
				"@bob:example": {"!room:example"},
			})
		case "/_matrix/client/v3/rooms/!room:example/joined_members":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"joined": map[string]any{
					"@alice:example": map[string]any{},
					"@bob:example":   map[string]any{},
					"@carol:example": map[string]any{},
				},
			})
		default:
			writeMatrixNotFound(w)
		}
	}))
	defer server.Close()

	core := New(nil)
	core.client, _ = mautrix.NewClient(server.URL, id.UserID("@alice:example"), "token")

	raw, err := core.handleFetchRoom(context.Background(), []byte(`{"roomId":"!room:example"}`))
	if err != nil {
		t.Fatal(err)
	}
	var info MatrixRoomInfo
	if err := json.Unmarshal(raw, &info); err != nil {
		t.Fatal(err)
	}
	if !info.IsDM {
		t.Fatal("expected room to be marked as DM from m.direct")
	}
	if info.DirectUserID != "@bob:example" {
		t.Fatalf("expected direct user @bob:example, got %q", info.DirectUserID)
	}
	if info.MemberCount != 3 {
		t.Fatalf("expected member count 3, got %d", info.MemberCount)
	}
}

func TestFetchRoomPowerLevelsParsesFiniteNumericContent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || !strings.Contains(r.URL.Path, "/state/m.room.power_levels/") {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ban":            50,
			"events":         map[string]any{"m.room.name": 75, "bad": "ignored"},
			"events_default": 1,
			"invite":         2,
			"kick":           3,
			"notifications":  map[string]any{"room": 20},
			"redact":         4,
			"state_default":  5,
			"users":          map[string]any{"@admin:example": 100},
			"users_default":  6,
		})
	}))
	defer server.Close()

	core := New(nil)
	core.client, _ = mautrix.NewClient(server.URL, id.UserID("@alice:example"), "token")

	raw, err := core.handleFetchRoomPowerLevels(context.Background(), []byte(`{"roomId":"!room:example"}`))
	if err != nil {
		t.Fatal(err)
	}
	var levels MatrixRoomPowerLevels
	if err := json.Unmarshal(raw, &levels); err != nil {
		t.Fatal(err)
	}
	if levels.Ban == nil || *levels.Ban != 50 {
		t.Fatalf("expected ban 50, got %#v", levels.Ban)
	}
	if _, ok := levels.Events["bad"]; ok || levels.Events["m.room.name"] != 75 {
		t.Fatalf("expected filtered events, got %#v", levels.Events)
	}
	if levels.Users["@admin:example"] != 100 {
		t.Fatalf("expected user power 100, got %#v", levels.Users)
	}
	if levels.Notifications["room"] != 20 {
		t.Fatalf("expected room notification power 20, got %#v", levels.Notifications)
	}
	if levels.StateDefault == nil || *levels.StateDefault != 5 || levels.UsersDefault == nil || *levels.UsersDefault != 6 {
		t.Fatalf("expected defaults to be parsed, got state=%#v users=%#v", levels.StateDefault, levels.UsersDefault)
	}
}

func writeMatrixNotFound(w http.ResponseWriter) {
	w.WriteHeader(http.StatusNotFound)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"errcode": "M_NOT_FOUND",
		"error":   "not found",
	})
}
