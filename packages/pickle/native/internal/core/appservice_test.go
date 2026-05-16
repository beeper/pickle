package core

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/beeperstream"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

func TestMakePortalCreateRoomRequestBuildsBridgeV2Room(t *testing.T) {
	appservice := &matrixAppservice{
		botUserID:        id.UserID("@testbot:example"),
		homeserverDomain: "example",
	}
	req := MatrixAppserviceCreatePortalRoomOptions{
		AutoJoinInvites: true,
		Bridge: MatrixAppserviceBridgeName{
			BeeperBridgeType: "test",
			DisplayName:      "Test",
			NetworkID:        "test",
		},
		BridgeName:     "test",
		InitialMembers: []string{"@alice:example"},
		Invite:         []string{"@alice:example"},
		Name:           "Remote room",
		PortalKey:      MatrixAppservicePortalKey{ID: "remote-room", Receiver: "login:a"},
	}
	createReq := appservice.makePortalCreateRoomRequest(req, id.UserID("@test_bob:example"))

	if createReq.BeeperLocalRoomID != id.RoomID("!remote-room.login:a:example") {
		t.Fatalf("unexpected local room ID: %s", createReq.BeeperLocalRoomID)
	}
	if createReq.MeowRoomID != createReq.BeeperLocalRoomID {
		t.Fatalf("expected fi.mau room ID to match local room ID, got %s", createReq.MeowRoomID)
	}
	assertHasUserID(t, createReq.Invite, "@alice:example")
	assertHasUserID(t, createReq.BeeperInitialMembers, "@alice:example")
	if createReq.PowerLevelOverride == nil || createReq.PowerLevelOverride.Users[id.UserID("@testbot:example")] != 9001 {
		t.Fatalf("expected bridge bot power level override, got %#v", createReq.PowerLevelOverride)
	}
	if createReq.PowerLevelOverride.Events[event.StateBridge.Type] != 100 {
		t.Fatalf("expected m.bridge power level override, got %#v", createReq.PowerLevelOverride.Events)
	}
	assertHasBridgeState(t, createReq, event.StateBridge.Type)
	assertHasBridgeState(t, createReq, event.StateHalfShotBridge.Type)
}

func TestAppserviceTransactionParsesBeeperStreamSubscribe(t *testing.T) {
	core := New(nil)
	core.appserviceProcessor = newBeeperStreamEventProcessor()

	var got *event.BeeperStreamSubscribeEventContent
	core.appserviceProcessor.On(event.ToDeviceBeeperStreamSubscribe, func(_ context.Context, evt *event.Event) {
		got = evt.Content.AsBeeperStreamSubscribe()
		if evt.Type != event.ToDeviceBeeperStreamSubscribe {
			t.Fatalf("unexpected event type %#v", evt.Type)
		}
	})

	rawTxn := map[string]any{
		"to_device": []any{map[string]any{
			"content": map[string]any{
				"device_id": "DESKTOP",
				"event_id":  "$event",
				"expiry_ms": 300000,
				"room_id":   "!room:example",
			},
			"sender":       "@alice:example",
			"to_device_id": "PICKLE",
			"to_user_id":   "@bridge:example",
			"type":         "com.beeper.stream.subscribe",
		}},
	}
	payload, err := json.Marshal(MatrixAppserviceTransactionOptions{Transaction: mustJSON(t, rawTxn)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := core.handleAppserviceApplyTransaction(context.Background(), payload); err != nil {
		t.Fatal(err)
	}

	if got == nil {
		t.Fatal("expected stream subscribe handler to be called")
	}
	if got.RoomID != id.RoomID("!room:example") || got.EventID != id.EventID("$event") || got.DeviceID != id.DeviceID("DESKTOP") {
		t.Fatalf("unexpected parsed subscribe content: %#v", got)
	}
}

func TestBeeperStreamClientUsesAppserviceBotDevice(t *testing.T) {
	core := New(nil)
	mainClient, err := mautrix.NewClient("https://matrix.example/_hungryserv/alice", id.UserID("@bot:example"), "login-token")
	if err != nil {
		t.Fatal(err)
	}
	mainClient.StateStore = mautrix.NewMemoryStateStore()
	core.client = mainClient

	cli, err := core.beeperStreamClient(MatrixCoreInitOptions{
		Appservice: &MatrixAppserviceInitOptions{
			Homeserver:       "https://matrix.example/_hungryserv/alice",
			HomeserverDomain: "example",
			Registration: MatrixAppserviceRegistration{
				AppToken:        "as-token",
				SenderLocalpart: "bot",
			},
		},
		DeviceID: "PICKLE",
	})
	if err != nil {
		t.Fatal(err)
	}

	if cli.UserID != id.UserID("@bot:example") {
		t.Fatalf("unexpected stream user ID: %s", cli.UserID)
	}
	if cli.DeviceID != id.DeviceID("PICKLE") {
		t.Fatalf("unexpected stream device ID: %s", cli.DeviceID)
	}
	if cli.AccessToken != "as-token" {
		t.Fatalf("expected appservice token, got %q", cli.AccessToken)
	}
	if !cli.SetAppServiceUserID || !cli.SetAppServiceDeviceID {
		t.Fatalf("expected appservice user and device query flags")
	}
	if cli.StateStore != mainClient.StateStore {
		t.Fatalf("expected stream client to share state store")
	}
}

func TestCreateBeeperStreamUsesMautrixEncryptionDecision(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"event_id":"$stream"}`))
	}))
	t.Cleanup(server.Close)

	core := New(nil)
	cli, err := mautrix.NewClient(server.URL, id.UserID("@testbot:example"), "device-token")
	if err != nil {
		t.Fatal(err)
	}
	cli.DeviceID = id.DeviceID("PICKLE")
	cli.StateStore = mautrix.NewMemoryStateStore()
	core.client = cli
	core.beeperStream, err = beeperstream.New(cli)
	if err != nil {
		t.Fatal(err)
	}

	req, err := json.Marshal(MatrixStartBeeperStreamMessageOptions{
		RoomID:     "!room:example",
		StreamType: "com.beeper.llm",
	})
	if err != nil {
		t.Fatal(err)
	}
	resp, err := core.handleStartBeeperStreamMessage(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Descriptor event.BeeperStreamInfo `json:"descriptor"`
	}
	if err = json.Unmarshal(resp, &result); err != nil {
		t.Fatal(err)
	}
	if result.Descriptor.Encryption != nil {
		t.Fatal("expected unencrypted beeper stream descriptor for unencrypted room")
	}

	if err = cli.StateStore.SetEncryptionEvent(context.Background(), id.RoomID("!room:example"), &event.EncryptionEventContent{
		Algorithm: id.AlgorithmMegolmV1,
	}); err != nil {
		t.Fatal(err)
	}
	resp, err = core.handleStartBeeperStreamMessage(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(resp, &result); err != nil {
		t.Fatal(err)
	}
	if result.Descriptor.Encryption == nil {
		t.Fatal("expected encrypted beeper stream descriptor")
	}
	if result.Descriptor.Encryption.Algorithm != id.AlgorithmBeeperStreamV1 {
		t.Fatalf("unexpected stream encryption algorithm: %s", result.Descriptor.Encryption.Algorithm)
	}
	if len(result.Descriptor.Encryption.Key) != 32 {
		t.Fatalf("unexpected stream encryption key length: %d", len(result.Descriptor.Encryption.Key))
	}
}

func TestRegisterBeeperStreamInjectsDirectSubscribers(t *testing.T) {
	requests := make(chan recordedRequest, 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		requests <- recordedRequest{body: string(body), path: r.URL.Path}
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "/sendToDevice/") {
			_, _ = w.Write([]byte(`{}`))
		} else {
			_, _ = w.Write([]byte(`{"event_id":"$stream"}`))
		}
	}))
	t.Cleanup(server.Close)

	core := New(nil)
	cli, err := mautrix.NewClient(server.URL, id.UserID("@testbot:example"), "device-token")
	if err != nil {
		t.Fatal(err)
	}
	cli.DeviceID = id.DeviceID("PICKLE")
	cli.StateStore = mautrix.NewMemoryStateStore()
	core.client = cli
	core.beeperStream, err = beeperstream.New(cli)
	if err != nil {
		t.Fatal(err)
	}

	if err = cli.StateStore.SetEncryptionEvent(context.Background(), id.RoomID("!room:example"), &event.EncryptionEventContent{
		Algorithm: id.AlgorithmMegolmV1,
	}); err != nil {
		t.Fatal(err)
	}
	startReq, err := json.Marshal(MatrixStartBeeperStreamMessageOptions{
		RoomID:     "!room:example",
		StreamType: "com.beeper.llm",
		Subscribers: []MatrixBeeperStreamSubscriber{{
			DeviceID: "DESKTOP",
			UserID:   "@alice:example",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = core.handleStartBeeperStreamMessage(context.Background(), startReq); err != nil {
		t.Fatal(err)
	}

	publishReq, err := json.Marshal(MatrixPublishBeeperStreamMessagePartOptions{
		EventID: "$stream",
		Part:    OutboundEvent{"type": "text-delta", "delta": "hi"},
		RoomID:  "!room:example",
		TurnID:  "turn-test",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = core.handlePublishBeeperStreamMessagePart(context.Background(), publishReq); err != nil {
		t.Fatal(err)
	}

	deadline := time.After(time.Second)
	for {
		select {
		case req := <-requests:
			if !strings.Contains(req.path, "/sendToDevice/") {
				continue
			}
			if !strings.Contains(req.path, "/sendToDevice/m.room.encrypted/") {
				t.Fatalf("expected encrypted stream update sendToDevice request, got %s", req.path)
			}
			if !strings.Contains(req.body, "@alice:example") || !strings.Contains(req.body, "DESKTOP") {
				t.Fatalf("expected desktop subscriber in sendToDevice body, got %s", req.body)
			}
			return
		case <-deadline:
			t.Fatal("timed out waiting for stream update sendToDevice request")
		}
	}
}

type recordedRequest struct {
	body string
	path string
}

func mustJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func assertHasUserID(t *testing.T, users []id.UserID, expected id.UserID) {
	t.Helper()
	for _, userID := range users {
		if userID == expected {
			return
		}
	}
	t.Fatalf("expected %s in %v", expected, users)
}

func assertHasBridgeState(t *testing.T, req *mautrix.ReqCreateRoom, eventType string) {
	t.Helper()
	for _, state := range req.InitialState {
		if state.Type.Type == eventType {
			if state.StateKey == nil || *state.StateKey != "test" {
				t.Fatalf("unexpected state key for %s: %#v", eventType, state.StateKey)
			}
			content, ok := state.Content.Parsed.(*event.BridgeEventContent)
			if !ok {
				t.Fatalf("expected mautrix bridge event content in %s, got %#v", eventType, state.Content.Parsed)
			}
			if content.BridgeBot != id.UserID("@testbot:example") {
				t.Fatalf("unexpected bridgebot in %s: %#v", eventType, content)
			}
			return
		}
	}
	t.Fatalf("missing %s initial state", eventType)
}
