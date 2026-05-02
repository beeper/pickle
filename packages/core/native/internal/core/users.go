package core

import (
	"context"
	"encoding/json"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/id"
)

type MatrixGetUserOptions struct {
	UserID string `json:"userId"`
}

func (c *Core) handleGetUser(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixGetUserOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	profile, err := retryMatrix(ctx, func() (*mautrix.RespUserProfile, error) {
		return cli.GetProfile(ctx, id.UserID(req.UserID))
	})
	if err != nil {
		return nil, err
	}
	resp := OutboundEvent{
		"raw":    profile,
		"userId": req.UserID,
	}
	if profile.DisplayName != "" {
		resp["displayName"] = profile.DisplayName
	}
	if profile.AvatarURL.String() != "" {
		resp["avatarUrl"] = profile.AvatarURL.String()
	}
	return json.Marshal(resp)
}
