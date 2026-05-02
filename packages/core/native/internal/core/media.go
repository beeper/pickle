package core

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/crypto/attachment"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

// ts:export MatrixUploadMediaOptions
type uploadMediaReq struct {
	BytesBase64 string `json:"bytesBase64"`
	ContentType string `json:"contentType,omitempty"`
	Filename    string `json:"filename,omitempty"`
}

// ts:export MatrixSendMediaMessageOptions
type postMediaReq struct {
	RoomID            string `json:"roomId"`
	Body              string `json:"body,omitempty"`
	BytesBase64       string `json:"bytesBase64"`
	ContentType       string `json:"contentType,omitempty"`
	Duration          int    `json:"duration,omitempty"`
	Filename          string `json:"filename,omitempty"`
	Height            int    `json:"height,omitempty"`
	MsgType           string `json:"msgtype,omitempty" ts:"\"m.image\" | \"m.video\" | \"m.audio\" | \"m.file\""`
	Size              int    `json:"size,omitempty"`
	ThreadRootEventID string `json:"threadRootEventId,omitempty"`
	Width             int    `json:"width,omitempty"`
}

func (c *Core) handleUploadMedia(ctx context.Context, payload []byte) ([]byte, error) {
	var req uploadMediaReq
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	data, err := base64.StdEncoding.DecodeString(req.BytesBase64)
	if err != nil {
		return nil, err
	}
	return c.uploadMedia(ctx, req, data)
}

func (c *Core) handleUploadMediaBytes(ctx context.Context, payload []byte, data []byte) ([]byte, error) {
	var req uploadMediaReq
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	return c.uploadMedia(ctx, req, data)
}

func (c *Core) uploadMedia(ctx context.Context, req uploadMediaReq, data []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	if req.ContentType == "" {
		req.ContentType = "application/octet-stream"
	}
	resp, err := retryMatrix(ctx, func() (*mautrix.RespMediaUpload, error) {
		return cli.UploadBytesWithName(ctx, data, req.ContentType, req.Filename)
	})
	if err != nil {
		return nil, err
	}
	return json.Marshal(OutboundEvent{"contentUri": resp.ContentURI.String(), "raw": resp})
}

func (c *Core) handlePostMediaMessage(ctx context.Context, payload []byte) ([]byte, error) {
	var req postMediaReq
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	plaintext, err := base64.StdEncoding.DecodeString(req.BytesBase64)
	if err != nil {
		return nil, err
	}
	return c.postMediaMessage(ctx, req, plaintext)
}

func (c *Core) handlePostMediaMessageBytes(ctx context.Context, payload []byte, plaintext []byte) ([]byte, error) {
	var req postMediaReq
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	return c.postMediaMessage(ctx, req, plaintext)
}

func (c *Core) postMediaMessage(ctx context.Context, req postMediaReq, plaintext []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	if req.ContentType == "" {
		req.ContentType = "application/octet-stream"
	}
	if req.Size == 0 {
		req.Size = len(plaintext)
	}
	msgType := event.MessageType(req.MsgType)
	if msgType == "" {
		msgType = mediaMsgType(req.ContentType)
	}
	body := req.Body
	if body == "" {
		body = req.Filename
	}
	if body == "" {
		body = "file"
	}
	content := &event.MessageEventContent{
		Body:     body,
		FileName: req.Filename,
		Info: &event.FileInfo{
			MimeType: req.ContentType,
			Duration: req.Duration,
			Height:   req.Height,
			Size:     req.Size,
			Width:    req.Width,
		},
		MsgType: msgType,
	}
	if content.Info.IsZero() {
		content.Info = nil
	}
	encrypted := false
	if cli.StateStore != nil {
		encrypted, _ = cli.StateStore.IsEncrypted(ctx, id.RoomID(req.RoomID))
	}
	if encrypted {
		ciphertext, file, err := encryptMedia(plaintext)
		if err != nil {
			return nil, err
		}
		resp, err := retryMatrix(ctx, func() (*mautrix.RespMediaUpload, error) {
			return cli.UploadBytesWithName(ctx, ciphertext, "application/octet-stream", req.Filename)
		})
		if err != nil {
			return nil, err
		}
		file.URL = id.ContentURIString(resp.ContentURI.String())
		content.File = &file
	} else {
		resp, err := retryMatrix(ctx, func() (*mautrix.RespMediaUpload, error) {
			return cli.UploadBytesWithName(ctx, plaintext, req.ContentType, req.Filename)
		})
		if err != nil {
			return nil, err
		}
		content.URL = id.ContentURIString(resp.ContentURI.String())
	}
	if req.ThreadRootEventID != "" {
		content.RelatesTo = (&event.RelatesTo{}).SetThread(id.EventID(req.ThreadRootEventID), "")
	}
	resp, err := retryMatrix(ctx, func() (*mautrix.RespSendEvent, error) {
		return cli.SendMessageEvent(ctx, id.RoomID(req.RoomID), event.EventMessage, content)
	})
	if err != nil {
		return nil, err
	}
	return json.Marshal(rawMessageResp{EventID: resp.EventID.String(), RoomID: req.RoomID, Raw: resp})
}

// ts:export MatrixDownloadMediaOptions
type downloadMediaReq struct {
	ContentURI string `json:"contentUri"`
}

func (c *Core) handleDownloadMedia(ctx context.Context, payload []byte) ([]byte, error) {
	data, err := c.downloadMedia(ctx, payload)
	if err != nil {
		return nil, err
	}
	return json.Marshal(OutboundEvent{"bytesBase64": base64.StdEncoding.EncodeToString(data)})
}

func (c *Core) handleDownloadMediaBytes(ctx context.Context, payload []byte) ([]byte, error) {
	return c.downloadMedia(ctx, payload)
}

func (c *Core) downloadMedia(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req downloadMediaReq
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	parsed, err := id.ParseContentURI(req.ContentURI)
	if err != nil {
		return nil, err
	}
	data, err := retryMatrix(ctx, func() ([]byte, error) {
		return cli.DownloadBytes(ctx, parsed)
	})
	if err != nil {
		return nil, err
	}
	return data, nil
}

func (c *Core) handleUploadEncryptedMedia(ctx context.Context, payload []byte) ([]byte, error) {
	var req uploadMediaReq
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	plaintext, err := base64.StdEncoding.DecodeString(req.BytesBase64)
	if err != nil {
		return nil, err
	}
	return c.uploadEncryptedMedia(ctx, req, plaintext)
}

func (c *Core) handleUploadEncryptedMediaBytes(ctx context.Context, payload []byte, plaintext []byte) ([]byte, error) {
	var req uploadMediaReq
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	return c.uploadEncryptedMedia(ctx, req, plaintext)
}

func (c *Core) uploadEncryptedMedia(ctx context.Context, req uploadMediaReq, plaintext []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	ciphertext, file, err := encryptMedia(plaintext)
	if err != nil {
		return nil, err
	}
	resp, err := retryMatrix(ctx, func() (*mautrix.RespMediaUpload, error) {
		return cli.UploadBytesWithName(ctx, ciphertext, "application/octet-stream", req.Filename)
	})
	if err != nil {
		return nil, err
	}
	file.URL = id.ContentURIString(resp.ContentURI.String())
	return json.Marshal(OutboundEvent{
		"contentUri": resp.ContentURI.String(),
		"file":       file,
		"raw":        resp,
	})
}

// ts:export MatrixDownloadEncryptedMediaOptions
type downloadEncryptedMediaReq struct {
	File event.EncryptedFileInfo `json:"file" ts:"MatrixEncryptedFile"`
}

func (c *Core) handleDownloadEncryptedMedia(ctx context.Context, payload []byte) ([]byte, error) {
	plaintext, err := c.downloadEncryptedMedia(ctx, payload)
	if err != nil {
		return nil, err
	}
	return json.Marshal(OutboundEvent{"bytesBase64": base64.StdEncoding.EncodeToString(plaintext)})
}

func (c *Core) handleDownloadEncryptedMediaBytes(ctx context.Context, payload []byte) ([]byte, error) {
	return c.downloadEncryptedMedia(ctx, payload)
}

func (c *Core) downloadEncryptedMedia(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req downloadEncryptedMediaReq
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	parsed, err := id.ParseContentURI(string(req.File.URL))
	if err != nil {
		return nil, err
	}
	ciphertext, err := retryMatrix(ctx, func() ([]byte, error) {
		return cli.DownloadBytes(ctx, parsed)
	})
	if err != nil {
		return nil, err
	}
	plaintext, err := decryptMedia(ciphertext, req.File)
	if err != nil {
		return nil, err
	}
	return plaintext, nil
}

func encryptMedia(plaintext []byte) ([]byte, event.EncryptedFileInfo, error) {
	file := attachment.NewEncryptedFile()
	ciphertext := file.Encrypt(plaintext)
	return ciphertext, event.EncryptedFileInfo{EncryptedFile: *file}, nil
}

func decryptMedia(ciphertext []byte, file event.EncryptedFileInfo) ([]byte, error) {
	return file.EncryptedFile.Decrypt(ciphertext)
}

func mediaMsgType(contentType string) event.MessageType {
	switch {
	case strings.HasPrefix(contentType, "image/"):
		return event.MsgImage
	case strings.HasPrefix(contentType, "video/"):
		return event.MsgVideo
	case strings.HasPrefix(contentType, "audio/"):
		return event.MsgAudio
	default:
		return event.MsgFile
	}
}

func messageAttachments(content *event.MessageEventContent) []tsMediaAttachment {
	if content == nil || !content.MsgType.IsMedia() {
		return nil
	}
	attachment := tsMediaAttachment{
		Filename: optionalString(content.GetFileName()),
		Msgtype:  string(content.MsgType),
	}
	if content.URL != "" {
		contentURI := string(content.URL)
		attachment.ContentURI = &contentURI
	}
	if content.File != nil {
		attachment.EncryptedFile = content.File
	}
	if content.Info != nil {
		info := tsMediaInfo{}
		if content.Info.MimeType != "" {
			info.ContentType = &content.Info.MimeType
		}
		if content.Info.Duration > 0 {
			duration := int64(content.Info.Duration)
			info.Duration = &duration
		}
		if content.Info.Height > 0 {
			info.Height = &content.Info.Height
		}
		if content.Info.Size > 0 {
			size := int64(content.Info.Size)
			info.Size = &size
		}
		if content.Info.Width > 0 {
			info.Width = &content.Info.Width
		}
		attachment.Info = &info
	}
	return []tsMediaAttachment{attachment}
}
