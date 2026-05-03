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

type MatrixOwnDisplayNameResult struct {
	DisplayName *string `json:"displayName,omitempty"`
	Raw         any     `json:"raw"`
}

type MatrixSetOwnDisplayNameOptions struct {
	DisplayName string `json:"displayName"`
}

type MatrixOwnAvatarURLResult struct {
	AvatarURL *string `json:"avatarUrl,omitempty"`
}

type MatrixSetOwnAvatarURLOptions struct {
	AvatarURL string `json:"avatarUrl"`
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

func (c *Core) handleGetOwnDisplayName(ctx context.Context) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	resp, err := retryMatrix(ctx, func() (*mautrix.RespUserDisplayName, error) {
		return cli.GetOwnDisplayName(ctx)
	})
	if err != nil {
		return nil, err
	}
	result := MatrixOwnDisplayNameResult{
		Raw: resp,
	}
	if resp.DisplayName != "" {
		result.DisplayName = &resp.DisplayName
	}
	return json.Marshal(result)
}

func (c *Core) handleSetOwnDisplayName(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixSetOwnDisplayNameOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	return nil, retryMatrixVoid(ctx, func() error {
		return cli.SetDisplayName(ctx, req.DisplayName)
	})
}

func (c *Core) handleGetOwnAvatarURL(ctx context.Context) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	avatarURL, err := retryMatrix(ctx, func() (id.ContentURI, error) {
		return cli.GetOwnAvatarURL(ctx)
	})
	if err != nil {
		return nil, err
	}
	result := MatrixOwnAvatarURLResult{}
	if avatarURL.String() != "" {
		avatarURLString := avatarURL.String()
		result.AvatarURL = &avatarURLString
	}
	return json.Marshal(result)
}

func (c *Core) handleSetOwnAvatarURL(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixSetOwnAvatarURLOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	avatarURL, err := id.ParseContentURI(req.AvatarURL)
	if err != nil {
		return nil, err
	}
	return nil, retryMatrixVoid(ctx, func() error {
		return cli.SetAvatarURL(ctx, avatarURL)
	})
}
