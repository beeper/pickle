package core

import "maunium.net/go/mautrix/event"

type MatrixRawEvent struct {
	Content        map[string]any `json:"content"`
	EventID        string         `json:"eventId"`
	IsMe           *bool          `json:"isMe,omitempty"`
	OriginServerTS *int64         `json:"originServerTs,omitempty"`
	Raw            any            `json:"raw"`
	RoomID         string         `json:"roomId"`
	Sender         string         `json:"sender"`
	Type           string         `json:"type"`
}

type MatrixMediaInfo struct {
	ContentType *string `json:"contentType,omitempty"`
	Duration    *int64  `json:"duration,omitempty"`
	Height      *int    `json:"height,omitempty"`
	Size        *int64  `json:"size,omitempty"`
	Width       *int    `json:"width,omitempty"`
}

type MatrixMediaAttachment struct {
	ContentURI    *string                  `json:"contentUri,omitempty"`
	EncryptedFile *event.EncryptedFileInfo `json:"encryptedFile,omitempty" tstype:"MatrixEncryptedFile"`
	Filename      *string                  `json:"filename,omitempty"`
	Info          *MatrixMediaInfo         `json:"info,omitempty"`
	Msgtype       string                   `json:"msgtype" tstype:"\"m.image\" | \"m.video\" | \"m.audio\" | \"m.file\""`
}

type MatrixMessageEvent struct {
	MatrixRawEvent
	Attachments       []MatrixMediaAttachment `json:"attachments,omitempty"`
	Body              string                  `json:"body"`
	FormattedBody     *string                 `json:"formattedBody,omitempty"`
	IsEncrypted       *bool                   `json:"isEncrypted,omitempty"`
	IsEdited          *bool                   `json:"isEdited,omitempty"`
	Mentions          *MatrixMentions         `json:"mentions,omitempty"`
	Msgtype           string                  `json:"msgtype"`
	Relation          *MatrixRelation         `json:"relation,omitempty"`
	Replaces          *string                 `json:"replaces,omitempty"`
	ReplyTo           *string                 `json:"replyTo,omitempty"`
	ThreadRootEventID *string                 `json:"threadRootEventId,omitempty"`
}

func (evt *MatrixMessageEvent) setThreadRoot(threadRoot string) {
	if threadRoot != "" && evt.ThreadRootEventID == nil {
		evt.ThreadRootEventID = &threadRoot
	}
}

func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func optionalBool(value bool) *bool {
	if !value {
		return nil
	}
	return &value
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func boolValue(value *bool) bool {
	return value != nil && *value
}

func int64Value(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}

type MatrixRelation struct {
	EventID    string  `json:"eventId"`
	IsFallback *bool   `json:"isFallback,omitempty"`
	Key        *string `json:"key,omitempty"`
	ReplyTo    *string `json:"replyTo,omitempty"`
	Type       string  `json:"type" tstype:"\"m.replace\" | \"m.annotation\" | \"m.thread\" | \"m.reference\" | string"`
}

type MatrixReactionEvent struct {
	MatrixRawEvent
	Added            *bool  `json:"added,omitempty"`
	Key              string `json:"key"`
	RelatesToEventID string `json:"relatesToEventId"`
}

type MatrixInviteEvent struct {
	Inviter *string `json:"inviter,omitempty"`
	Raw     any     `json:"raw"`
	RoomID  string  `json:"roomId"`
}

type MatrixSyncEvent struct {
	Class          string         `json:"class" tstype:"\"state\" | \"ephemeral\" | \"accountData\" | \"toDevice\" | \"membership\" | \"redaction\" | \"raw\" | string"`
	Content        map[string]any `json:"content"`
	Decrypted      *bool          `json:"decrypted,omitempty"`
	Encrypted      *bool          `json:"encrypted,omitempty"`
	EventID        *string        `json:"eventId,omitempty"`
	NextBatch      *string        `json:"nextBatch,omitempty"`
	OriginServerTS *int64         `json:"originServerTs,omitempty"`
	Raw            any            `json:"raw"`
	RoomID         *string        `json:"roomId,omitempty"`
	Section        string         `json:"section,omitempty"`
	Sender         *string        `json:"sender,omitempty"`
	StateKey       *string        `json:"stateKey,omitempty"`
	Type           string         `json:"type"`
}

type MatrixRoomThreadSummary struct {
	LastReplyTS *int64             `json:"lastReplyTs,omitempty"`
	ReplyCount  *int               `json:"replyCount,omitempty"`
	Root        MatrixMessageEvent `json:"root"`
}

type MatrixFetchMessagesResult struct {
	Messages   []MatrixMessageEvent `json:"messages"`
	NextCursor *string              `json:"nextCursor,omitempty"`
}

type MatrixFetchMessageResult struct {
	Message *MatrixMessageEvent `json:"message" tstype:"MatrixMessageEvent | null"`
}

type MatrixUploadMediaResult struct {
	ContentURI string `json:"contentUri"`
	Raw        any    `json:"raw"`
}

type MatrixDownloadMediaResult struct {
	BytesBase64 string `json:"bytesBase64"`
}

type MatrixUploadEncryptedMediaResult struct {
	ContentURI string                  `json:"contentUri"`
	File       event.EncryptedFileInfo `json:"file" tstype:"MatrixEncryptedFile"`
	Raw        any                     `json:"raw"`
}

type MatrixOpenDMResult struct {
	Raw    any    `json:"raw"`
	RoomID string `json:"roomId"`
}

type MatrixJoinRoomResult struct {
	Raw    any    `json:"raw"`
	RoomID string `json:"roomId"`
}

type MatrixJoinedRoomsResult struct {
	Raw     any      `json:"raw"`
	RoomIDs []string `json:"roomIds"`
}

type MatrixUserInfo struct {
	AvatarURL   *string `json:"avatarUrl,omitempty"`
	DisplayName *string `json:"displayName,omitempty"`
	Raw         any     `json:"raw"`
	UserID      string  `json:"userId"`
}

type MatrixListRoomThreadsResult struct {
	NextCursor *string                   `json:"nextCursor,omitempty"`
	Threads    []MatrixRoomThreadSummary `json:"threads"`
}
