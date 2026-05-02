package core

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

type MatrixListRoomThreadsOptions struct {
	Cursor string `json:"cursor,omitempty"`
	Limit  int    `json:"limit,omitempty"`
	RoomID string `json:"roomId"`
}

type threadListResp struct {
	Chunk     []*event.Event `json:"chunk"`
	NextBatch string         `json:"next_batch,omitempty"`
	PrevBatch string         `json:"prev_batch,omitempty"`
}

func (c *Core) handleListRoomThreads(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req MatrixListRoomThreadsOptions
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.Limit <= 0 {
		req.Limit = 50
	}
	response, err := c.requestThreadList(ctx, cli, req)
	if err != nil {
		return nil, err
	}
	threads := make([]MatrixRoomThreadSummary, 0, len(response.Chunk))
	for _, evt := range response.Chunk {
		if evt != nil && evt.RoomID == "" {
			evt.RoomID = id.RoomID(req.RoomID)
		}
		root := c.convertMaybeEncryptedMessageEvent(ctx, evt)
		if root == nil {
			continue
		}
		replyCount := 0
		if evt.Unsigned.Relations != nil {
			if chunk, ok := evt.Unsigned.Relations.Raw[event.RelThread]; ok {
				replyCount = chunk.Count
			}
		}
		threads = append(threads, MatrixRoomThreadSummary{
			ReplyCount: &replyCount,
			Root:       *root,
		})
	}
	return json.Marshal(OutboundEvent{"threads": threads, "nextCursor": response.NextBatch})
}

func (c *Core) requestThreadList(ctx context.Context, cli *mautrix.Client, req MatrixListRoomThreadsOptions) (*threadListResp, error) {
	query := map[string]string{
		"dir":     string(mautrix.DirectionBackward),
		"include": "all",
		"limit":   strconv.Itoa(req.Limit),
	}
	if req.Cursor != "" {
		query["from"] = req.Cursor
	}
	var response threadListResp
	stableURL := cli.BuildURLWithQuery(mautrix.ClientURLPath{"v1", "rooms", id.RoomID(req.RoomID), "threads"}, query)
	if err := retryMatrixVoid(ctx, func() error {
		_, err := cli.MakeRequest(ctx, http.MethodGet, stableURL, nil, &response)
		return err
	}); err == nil {
		return &response, nil
	}
	response = threadListResp{}
	unstableURL := cli.BuildURLWithQuery(mautrix.BaseURLPath{"_matrix", "client", "unstable", "org.matrix.msc3856", "rooms", id.RoomID(req.RoomID), "threads"}, query)
	if err := retryMatrixVoid(ctx, func() error {
		_, err := cli.MakeRequest(ctx, http.MethodGet, unstableURL, nil, &response)
		return err
	}); err != nil {
		return nil, err
	}
	return &response, nil
}
