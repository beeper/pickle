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

	aistream "github.com/beeper/ai-bridge/pkg/ai-stream"
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
		BridgeName: "test",
		CreationContent: map[string]any{
			"m.federate": false,
		},
		InitialMembers: []string{"@alice:example"},
		Invite:         []string{"@alice:example"},
		Name:           "Remote room",
		PortalKey:      MatrixAppservicePortalKey{ID: "remote-room", Receiver: "login:a"},
	}
	createReq := appservice.makePortalCreateRoomRequest(req, id.UserID("@test_bob:example"))

	if createReq.BeeperLocalRoomID != "" {
		t.Fatalf("expected homeserver-assigned room ID, got local room ID: %s", createReq.BeeperLocalRoomID)
	}
	if createReq.MeowRoomID != "" {
		t.Fatalf("expected no fi.mau room ID override, got %s", createReq.MeowRoomID)
	}
	if createReq.BeeperBridgeName != "" || createReq.BeeperBridgeAccountID != "" {
		t.Fatalf("expected bridge details to stay in bridge state events for homeserver-assigned rooms, got name=%q account=%q", createReq.BeeperBridgeName, createReq.BeeperBridgeAccountID)
	}
	assertHasUserID(t, createReq.Invite, "@alice:example")
	assertHasUserID(t, createReq.BeeperInitialMembers, "@alice:example")
	if createReq.PowerLevelOverride == nil || createReq.PowerLevelOverride.Users[id.UserID("@testbot:example")] != 9001 {
		t.Fatalf("expected bridge bot power level override, got %#v", createReq.PowerLevelOverride)
	}
	if createReq.PowerLevelOverride.Events[event.StateBridge.Type] != 100 {
		t.Fatalf("expected m.bridge power level override, got %#v", createReq.PowerLevelOverride.Events)
	}
	if createReq.CreationContent["m.federate"] != false {
		t.Fatalf("expected portal creation content to preserve m.federate=false, got %#v", createReq.CreationContent)
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

func TestAppserviceTransactionEmitsMautrixClassifiedEvents(t *testing.T) {
	var emitted []OutboundEvent
	core := New(func(evt OutboundEvent) {
		emitted = append(emitted, evt)
	})
	core.appserviceProcessor = newBeeperStreamEventProcessor()

	rawTxn := map[string]any{
		"events": []any{
			map[string]any{
				"content":   map[string]any{"name": "Project room"},
				"event_id":  "$name",
				"room_id":   "!room:example",
				"sender":    "@alice:example",
				"state_key": "",
				"type":      "m.room.name",
			},
			map[string]any{
				"content":   map[string]any{"membership": "invite"},
				"event_id":  "$member",
				"room_id":   "!room:example",
				"sender":    "@alice:example",
				"state_key": "@bob:example",
				"type":      "m.room.member",
			},
		},
		"ephemeral": []any{
			map[string]any{
				"content": map[string]any{
					"$message": map[string]any{
						"m.read": map[string]any{
							"@alice:example": map[string]any{"ts": 1},
						},
					},
				},
				"room_id": "!room:example",
				"type":    "m.receipt",
			},
		},
		"room_account_data": []any{
			map[string]any{
				"content": map[string]any{"unread": true},
				"room_id": "!room:example",
				"type":    "m.marked_unread",
			},
		},
	}
	payload, err := json.Marshal(MatrixAppserviceTransactionOptions{Transaction: mustJSON(t, rawTxn)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := core.handleAppserviceApplyTransaction(context.Background(), payload); err != nil {
		t.Fatal(err)
	}

	assertEmittedSyncEvent(t, emitted, "room_state", "m.room.name", "!room:example")
	assertEmittedSyncEvent(t, emitted, "membership", "m.room.member", "!room:example")
	assertEmittedSyncEvent(t, emitted, "receipt", "m.receipt", "!room:example")
	assertEmittedSyncEvent(t, emitted, "account_data", "m.marked_unread", "!room:example")
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

func TestBeeperStreamCarrierContentUsesAIBridgeEnvelopeShape(t *testing.T) {
	core := New(nil)

	content, err := core.beeperStreamCarrierContent("com.beeper.llm", MatrixPublishBeeperStreamMessagePartOptions{
		AgentID: "codex",
		EventID: "$stream",
		Part: OutboundEvent{
			"delta":     "hello",
			"messageId": "msg-1",
			"model":     "openclaw/codex",
			"runId":     "run-1",
			"threadId":  "thread-1",
			"type":      "TEXT_MESSAGE_CONTENT",
		},
		TurnID: "run-1",
	}, 7)
	if err != nil {
		t.Fatal(err)
	}
	payload, ok := content[aistream.BeeperAIKey].(aistream.BeeperAI)
	if !ok || len(payload.Events) != 1 {
		t.Fatalf("expected ai-bridge stream payload, got %#v", content)
	}
	envelope := payload.Events[0]
	if envelope.Seq != 7 || payload.Agent.ID != "codex" {
		t.Fatalf("unexpected ai-bridge envelope routing fields: payload=%#v envelope=%#v", payload, envelope)
	}
	if payload.ThreadID != "thread-1" || payload.RunID != "run-1" || payload.MessageID != "msg-1" {
		t.Fatalf("unexpected ai-bridge run identity: %#v", payload)
	}
	if envelope.Event.Type() != "TEXT_MESSAGE_CONTENT" || envelope.Event.Get("delta") != "hello" {
		t.Fatalf("unexpected ai-bridge event payload: %#v", envelope.Event.Map())
	}
	if !envelope.Event.Has("timestamp") {
		t.Fatalf("expected native bridge to add timestamp before ai-bridge validation: %#v", envelope.Event.Map())
	}

	custom, err := core.beeperStreamCarrierContent("com.example.custom", MatrixPublishBeeperStreamMessagePartOptions{
		EventID: "$stream",
		Part: OutboundEvent{
			"delta":     "custom",
			"messageId": "turn-1",
			"type":      "TEXT_MESSAGE_CONTENT",
		},
		TurnID: "turn-1",
	}, 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := custom[aistream.BeeperAIKey].(aistream.BeeperAI); !ok {
		t.Fatalf("expected custom stream type to use ai-bridge payload, got %#v", custom)
	}
}

func TestBeeperStreamPublishWithoutSubscribersSendsRoomCarrierEvent(t *testing.T) {
	requests := make(chan recordedRequest, 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		requests <- recordedRequest{body: string(body), path: r.URL.Path}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"event_id":"$event"}`))
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

	startReq, err := json.Marshal(MatrixStartBeeperStreamMessageOptions{
		RoomID:     "!room:example",
		StreamType: "com.beeper.llm",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = core.handleStartBeeperStreamMessage(context.Background(), startReq); err != nil {
		t.Fatal(err)
	}

	select {
	case req := <-requests:
		if !strings.Contains(req.body, `"com.beeper.stream":{"type":"com.beeper.llm"}`) {
			t.Fatalf("expected room-carrier anchor descriptor, got %s", req.body)
		}
	default:
		t.Fatal("expected stream anchor request")
	}

	publishReq, err := json.Marshal(MatrixPublishBeeperStreamMessagePartOptions{
		EventID: "$event",
		Part: OutboundEvent{
			"delta":     "hello",
			"messageId": "turn-test",
			"type":      "TEXT_MESSAGE_CONTENT",
		},
		RoomID: "!room:example",
		TurnID: "turn-test",
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
			if !strings.Contains(req.path, "/rooms/!room:example/send/m.room.message/") {
				continue
			}
			if !strings.Contains(req.body, `"com.beeper.ai"`) {
				continue
			}
			if !strings.Contains(req.body, `"body":""`) || !strings.Contains(req.body, `"msgtype":"m.text"`) {
				t.Fatalf("expected hidden m.text carrier event, got %s", req.body)
			}
			if !strings.Contains(req.body, `"rel_type":"m.reference"`) || !strings.Contains(req.body, `"event_id":"$event"`) {
				t.Fatalf("expected carrier event to reference stream root, got %s", req.body)
			}
			if !strings.Contains(req.body, `"delta":"hello"`) {
				t.Fatalf("expected ai-bridge stream payload in carrier body, got %s", req.body)
			}
			return
		case <-deadline:
			t.Fatal("timed out waiting for room carrier stream event")
		}
	}
}

func TestBeeperAIRunStreamUsesCanonicalAIBridgeRun(t *testing.T) {
	requests := make(chan recordedRequest, 16)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		requests <- recordedRequest{body: string(body), path: r.URL.Path}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"event_id":"$event"}`))
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

	startReq, err := json.Marshal(MatrixStartBeeperAIRunStreamOptions{
		MatrixBeginBeeperAIRunOptions: MatrixBeginBeeperAIRunOptions{
			AgentID:   "codex",
			AgentName: "Codex",
			Data:      OutboundEvent{"session_key": "session-1"},
			Model:     "openclaw/plugin",
			RunID:     "run-1",
			ThreadID:  "thread-1",
		},
		RoomID: "!room:example",
	})
	if err != nil {
		t.Fatal(err)
	}
	rawStart, err := core.handleStartBeeperAIRunStream(context.Background(), startReq)
	if err != nil {
		t.Fatal(err)
	}
	var startResult MatrixBeeperAIRunStreamResult
	if err = json.Unmarshal(rawStart, &startResult); err != nil {
		t.Fatal(err)
	}
	if startResult.EventID != "$event" || startResult.MessageID != "msg-run-1" {
		t.Fatalf("unexpected start result: %#v", startResult)
	}
	anchorBody := waitForRecordedRequest(t, requests, func(req recordedRequest) bool {
		return strings.Contains(req.body, `"com.beeper.ai"`) && strings.Contains(req.body, `"com.beeper.stream"`)
	})
	if strings.Contains(anchorBody, "Working...") || !strings.Contains(anchorBody, `"body":""`) {
		t.Fatalf("empty stream anchor should not expose working fallback, got %s", anchorBody)
	}

	appendReq, err := json.Marshal(MatrixAppendBeeperAIRunEventOptions{
		Event: OutboundEvent{
			"delta":     "hello",
			"messageId": "provider-msg",
			"type":      "TEXT_MESSAGE_CONTENT",
		},
		RunID: "run-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = core.handleAppendBeeperAIRunStreamEvent(context.Background(), appendReq); err != nil {
		t.Fatal(err)
	}
	carrierBody := waitForRecordedRequest(t, requests, func(req recordedRequest) bool {
		return strings.Contains(req.body, `"delta":"hello"`)
	})
	if !strings.Contains(carrierBody, `"messageId":"msg-run-1"`) {
		t.Fatalf("expected canonical envelope message id, got %s", carrierBody)
	}
	if strings.Contains(carrierBody, `"messageId":"provider-msg"`) {
		t.Fatalf("expected provider message id to be canonicalized by native stream, got %s", carrierBody)
	}

	finishReq, err := json.Marshal(MatrixFinishBeeperAIRunOptions{
		FinishReason: "stop",
		RunID:        "run-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	rawFinish, err := core.handleFinishBeeperAIRunStream(context.Background(), finishReq)
	if err != nil {
		t.Fatal(err)
	}
	var finishResult MatrixBeeperAIRunStreamResult
	if err = json.Unmarshal(rawFinish, &finishResult); err != nil {
		t.Fatal(err)
	}
	if finishResult.ReplacementEventID == "" || finishResult.Body != "hello" {
		t.Fatalf("unexpected finish result: %#v", finishResult)
	}
	if _, ok := core.beeperAIRuns["run-1"]; ok {
		t.Fatal("expected finalized stream run to be deleted")
	}
	replacementBody := waitForRecordedRequest(t, requests, func(req recordedRequest) bool {
		return strings.Contains(req.body, `"m.new_content"`)
	})
	if !strings.Contains(replacementBody, `"com.beeper.ai"`) || !strings.Contains(replacementBody, `"hello"`) {
		t.Fatalf("expected final replacement to use ai-bridge final content, got %s", replacementBody)
	}
}

func TestBeeperAIRunStreamStartUsesInitialTextPartForAnchorPreview(t *testing.T) {
	requests := make(chan recordedRequest, 16)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		requests <- recordedRequest{body: string(body), path: r.URL.Path}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"event_id":"$event"}`))
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

	startReq, err := json.Marshal(MatrixStartBeeperAIRunStreamOptions{
		MatrixBeginBeeperAIRunOptions: MatrixBeginBeeperAIRunOptions{
			AgentID:   "codex",
			AgentName: "Codex",
			Model:     "openclaw/plugin",
			RunID:     "run-preview",
			ThreadID:  "thread-preview",
		},
		InitialParts: []MatrixBeeperAIRunPartOptions{{
			Kind: "text",
			Text: "hello",
		}},
		RoomID: "!room:example",
	})
	if err != nil {
		t.Fatal(err)
	}
	rawStart, err := core.handleStartBeeperAIRunStream(context.Background(), startReq)
	if err != nil {
		t.Fatal(err)
	}
	var startResult MatrixBeeperAIRunStreamResult
	if err = json.Unmarshal(rawStart, &startResult); err != nil {
		t.Fatal(err)
	}
	if startResult.Body != "hello" {
		t.Fatalf("expected start snapshot body to use initial text, got %#v", startResult)
	}
	anchorBody := waitForRecordedRequest(t, requests, func(req recordedRequest) bool {
		return strings.Contains(req.body, `"com.beeper.ai"`) && strings.Contains(req.body, `"com.beeper.stream"`)
	})
	if !strings.Contains(anchorBody, `"body":"hello"`) || strings.Contains(anchorBody, "Working...") {
		t.Fatalf("expected anchor preview to use initial text, got %s", anchorBody)
	}
	carrierBody := waitForRecordedRequest(t, requests, func(req recordedRequest) bool {
		return strings.Contains(req.body, `"TEXT_MESSAGE_CONTENT"`) && strings.Contains(req.body, `"delta":"hello"`)
	})
	if !strings.Contains(carrierBody, `"seq":`) {
		t.Fatalf("expected initial text part to be published as a stream carrier, got %s", carrierBody)
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
		Part:    OutboundEvent{"type": "TEXT_MESSAGE_CONTENT", "messageId": "turn-test", "delta": "hi"},
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

func waitForRecordedRequest(t *testing.T, requests <-chan recordedRequest, matches func(recordedRequest) bool) string {
	t.Helper()
	deadline := time.After(time.Second)
	for {
		select {
		case req := <-requests:
			if matches(req) {
				return req.body
			}
		case <-deadline:
			t.Fatal("timed out waiting for recorded request")
		}
	}
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

func assertEmittedSyncEvent(t *testing.T, events []OutboundEvent, eventType string, matrixType string, roomID string) {
	t.Helper()
	for _, outbound := range events {
		if outbound["type"] != eventType {
			continue
		}
		rawEvent, ok := outbound["event"].(MatrixSyncEvent)
		if !ok {
			t.Fatalf("expected MatrixSyncEvent for %s, got %#v", eventType, outbound["event"])
		}
		if rawEvent.Type == matrixType && stringValue(rawEvent.RoomID) == roomID {
			return
		}
	}
	t.Fatalf("missing emitted %s event for %s in %v", eventType, matrixType, events)
}
