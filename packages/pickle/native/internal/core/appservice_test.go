package core

import (
	"testing"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

func TestApplyBeeperPortalCreateDefaultsBuildsBridgeRoomRequest(t *testing.T) {
	core := New(nil)
	core.appservice = &matrixAppservice{
		botUserID:        id.UserID("@testbot:example"),
		homeserverDomain: "example",
	}
	req := MatrixAppserviceCreateRoomOptions{
		MatrixCreateRoomOptions: MatrixCreateRoomOptions{
			Invite: []string{"@alice:example"},
		},
		BeeperAutoJoinInvites: true,
		BeeperBridgeAccountID: "login:a",
		BeeperBridgeName:      "test",
		BeeperInitialMembers:  []string{"@alice:example"},
		BeeperPortal: &MatrixAppserviceBeeperPortalCreateOptions{
			BridgeType:  "test",
			ChannelID:   "remote-room",
			ChannelName: "Remote room",
			NetworkID:   "test",
			NetworkName: "Test",
			PortalKey:   &MatrixAppservicePortalKey{ID: "remote-room", Receiver: "login:a"},
			Receiver:    "login:a",
		},
		UserID: "@test_bob:example",
	}
	createReq := makeCreateRoomRequest(req.MatrixCreateRoomOptions)
	createReq.BeeperInitialMembers = toUserIDs(req.BeeperInitialMembers)
	createReq.BeeperAutoJoinInvites = req.BeeperAutoJoinInvites
	createReq.BeeperBridgeName = req.BeeperBridgeName
	createReq.BeeperBridgeAccountID = req.BeeperBridgeAccountID

	core.applyBeeperPortalCreateDefaults(createReq, req)

	if createReq.BeeperLocalRoomID != id.RoomID("!remote-room.login:a:example") {
		t.Fatalf("unexpected local room ID: %s", createReq.BeeperLocalRoomID)
	}
	if createReq.MeowRoomID != createReq.BeeperLocalRoomID {
		t.Fatalf("expected fi.mau room ID to match local room ID, got %s", createReq.MeowRoomID)
	}
	assertHasUserID(t, createReq.Invite, "@testbot:example")
	assertHasUserID(t, createReq.BeeperInitialMembers, "@testbot:example")
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
