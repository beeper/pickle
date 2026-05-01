package core

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/crypto/attachment"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

type uploadMediaReq struct {
	BytesBase64 string `json:"bytesBase64"`
	ContentType string `json:"contentType,omitempty"`
	Filename    string `json:"filename,omitempty"`
}

type postMediaReq struct {
	RoomID            string `json:"roomId"`
	Body              string `json:"body,omitempty"`
	BytesBase64       string `json:"bytesBase64"`
	ContentType       string `json:"contentType,omitempty"`
	Duration          int    `json:"duration,omitempty"`
	Filename          string `json:"filename,omitempty"`
	Height            int    `json:"height,omitempty"`
	MsgType           string `json:"msgtype,omitempty"`
	Size              int    `json:"size,omitempty"`
	ThreadRootEventID string `json:"threadRootEventId,omitempty"`
	Width             int    `json:"width,omitempty"`
}

func (c *Core) handleUploadMedia(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req uploadMediaReq
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.ContentType == "" {
		req.ContentType = "application/octet-stream"
	}
	data, err := base64.StdEncoding.DecodeString(req.BytesBase64)
	if err != nil {
		return nil, err
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
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req postMediaReq
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.ContentType == "" {
		req.ContentType = "application/octet-stream"
	}
	plaintext, err := base64.StdEncoding.DecodeString(req.BytesBase64)
	if err != nil {
		return nil, err
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
		file.URL = resp.ContentURI.String()
		content.File = encryptedFileToEvent(file)
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

type downloadMediaReq struct {
	ContentURI string `json:"contentUri"`
}

func (c *Core) handleDownloadMedia(ctx context.Context, payload []byte) ([]byte, error) {
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
	return json.Marshal(OutboundEvent{"bytesBase64": base64.StdEncoding.EncodeToString(data)})
}

type encryptedFile struct {
	Hashes map[string]string `json:"hashes"`
	IV     string            `json:"iv"`
	Key    encryptedFileKey  `json:"key"`
	URL    string            `json:"url"`
	V      string            `json:"v"`
}

type encryptedFileKey struct {
	Alg    string   `json:"alg"`
	Ext    bool     `json:"ext"`
	K      string   `json:"k"`
	KeyOps []string `json:"key_ops"`
	Kty    string   `json:"kty"`
}

func (c *Core) handleUploadEncryptedMedia(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req uploadMediaReq
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	plaintext, err := base64.StdEncoding.DecodeString(req.BytesBase64)
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
	file.URL = resp.ContentURI.String()
	return json.Marshal(OutboundEvent{
		"contentUri": resp.ContentURI.String(),
		"file":       file,
		"raw":        resp,
	})
}

type downloadEncryptedMediaReq struct {
	File encryptedFile `json:"file"`
}

func (c *Core) handleDownloadEncryptedMedia(ctx context.Context, payload []byte) ([]byte, error) {
	cli, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	var req downloadEncryptedMediaReq
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	parsed, err := id.ParseContentURI(req.File.URL)
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
	return json.Marshal(OutboundEvent{"bytesBase64": base64.StdEncoding.EncodeToString(plaintext)})
}

func encryptMedia(plaintext []byte) ([]byte, encryptedFile, error) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, encryptedFile{}, err
	}
	iv := make([]byte, aes.BlockSize)
	if _, err := rand.Read(iv[:8]); err != nil {
		return nil, encryptedFile{}, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, encryptedFile{}, err
	}
	ciphertext := make([]byte, len(plaintext))
	cipher.NewCTR(block, iv).XORKeyStream(ciphertext, plaintext)
	hash := sha256.Sum256(ciphertext)
	return ciphertext, encryptedFile{
		Hashes: map[string]string{
			"sha256": base64.RawStdEncoding.EncodeToString(hash[:]),
		},
		IV: base64.RawStdEncoding.EncodeToString(iv),
		Key: encryptedFileKey{
			Alg:    "A256CTR",
			Ext:    true,
			K:      base64.RawURLEncoding.EncodeToString(key),
			KeyOps: []string{"encrypt", "decrypt"},
			Kty:    "oct",
		},
		V: "v2",
	}, nil
}

func decryptMedia(ciphertext []byte, file encryptedFile) ([]byte, error) {
	if expectedHash := file.Hashes["sha256"]; expectedHash != "" {
		hash := sha256.Sum256(ciphertext)
		if base64.RawStdEncoding.EncodeToString(hash[:]) != expectedHash {
			return nil, fmt.Errorf("encrypted media sha256 hash mismatch")
		}
	}
	key, err := base64.RawURLEncoding.DecodeString(file.Key.K)
	if err != nil {
		return nil, err
	}
	iv, err := base64.RawStdEncoding.DecodeString(file.IV)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	if len(iv) != aes.BlockSize {
		return nil, fmt.Errorf("encrypted media IV must be %d bytes", aes.BlockSize)
	}
	plaintext := make([]byte, len(ciphertext))
	cipher.NewCTR(block, iv).XORKeyStream(plaintext, ciphertext)
	return plaintext, nil
}

func encryptedFileToEvent(file encryptedFile) *event.EncryptedFileInfo {
	return &event.EncryptedFileInfo{
		EncryptedFile: attachment.EncryptedFile{
			Hashes:     attachment.EncryptedFileHashes{SHA256: file.Hashes["sha256"]},
			InitVector: file.IV,
			Key: attachment.JSONWebKey{
				Algorithm:   file.Key.Alg,
				Extractable: file.Key.Ext,
				Key:         file.Key.K,
				KeyOps:      file.Key.KeyOps,
				KeyType:     file.Key.Kty,
			},
			Version: file.V,
		},
		URL: id.ContentURIString(file.URL),
	}
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

func messageAttachments(content *event.MessageEventContent) []OutboundEvent {
	if content == nil || !content.MsgType.IsMedia() {
		return nil
	}
	attachment := OutboundEvent{
		"filename": content.GetFileName(),
		"msgtype":  string(content.MsgType),
	}
	if content.URL != "" {
		attachment["contentUri"] = string(content.URL)
	}
	if content.File != nil {
		attachment["encryptedFile"] = encryptedFileFromEvent(content.File)
	}
	if content.Info != nil {
		info := OutboundEvent{}
		if content.Info.MimeType != "" {
			info["contentType"] = content.Info.MimeType
		}
		if content.Info.Duration > 0 {
			info["duration"] = content.Info.Duration
		}
		if content.Info.Height > 0 {
			info["height"] = content.Info.Height
		}
		if content.Info.Size > 0 {
			info["size"] = content.Info.Size
		}
		if content.Info.Width > 0 {
			info["width"] = content.Info.Width
		}
		attachment["info"] = info
	}
	return []OutboundEvent{attachment}
}

func encryptedFileFromEvent(file *event.EncryptedFileInfo) encryptedFile {
	if file == nil {
		return encryptedFile{}
	}
	return encryptedFile{
		Hashes: map[string]string{"sha256": file.Hashes.SHA256},
		IV:     file.InitVector,
		Key: encryptedFileKey{
			Alg:    file.Key.Algorithm,
			Ext:    file.Key.Extractable,
			K:      file.Key.Key,
			KeyOps: file.Key.KeyOps,
			Kty:    file.Key.KeyType,
		},
		URL: string(file.URL),
		V:   file.Version,
	}
}
