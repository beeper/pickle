package core

import (
	"testing"

	"maunium.net/go/mautrix"
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
