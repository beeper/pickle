package core

const (
	// ts:operation syncOnce sync_once MatrixSyncOnceOptions void optional
	opSyncOnce = "sync_once"
	// ts:operation startSync start_sync MatrixSyncStartOptions void optional
	opStartSync = "start_sync"
	// ts:operation stopSync stop_sync - void
	opStopSync = "stop_sync"
	// ts:operation init init MatrixCoreInitOptions MatrixWhoami
	opInit = "init"
	// ts:operation whoami whoami - MatrixWhoami
	opWhoami = "whoami"
	// ts:operation logout logout - void
	opLogout = "logout"
	// ts:operation getCryptoStatus get_crypto_status - MatrixCryptoStatus
	opGetCryptoStatus = "get_crypto_status"
	// ts:operation rawRequest raw_request MatrixRawRequestOptions MatrixRawRequestResult
	opRawRequest = "raw_request"
	// ts:operation initAppservice init_appservice MatrixAppserviceInitOptions MatrixAppserviceInfo
	opInitAppservice = "init_appservice"
	// ts:operation appserviceEnsureRegistered appservice_ensure_registered MatrixAppserviceUserOptions void
	opAppserviceEnsureRegistered = "appservice_ensure_registered"
	// ts:operation appserviceEnsureJoined appservice_ensure_joined MatrixAppserviceRoomUserOptions void
	opAppserviceEnsureJoined = "appservice_ensure_joined"
	// ts:operation appserviceCreateRoom appservice_create_room MatrixAppserviceCreateRoomOptions MatrixCreateRoomResult
	opAppserviceCreateRoom = "appservice_create_room"
	// ts:operation appserviceCreatePortalRoom appservice_create_portal_room MatrixAppserviceCreatePortalRoomOptions MatrixCreateRoomResult
	opAppserviceCreatePortalRoom = "appservice_create_portal_room"
	// ts:operation appserviceCreateManagementRoom appservice_create_management_room MatrixAppserviceCreateManagementRoomOptions MatrixCreateRoomResult
	opAppserviceCreateManagementRoom = "appservice_create_management_room"
	// ts:operation appserviceSendMessage appservice_send_message MatrixAppserviceSendMessageOptions MatrixRawMessage
	opAppserviceSendMessage = "appservice_send_message"
	// ts:operation appserviceBatchSend appservice_batch_send MatrixAppserviceBatchSendOptions MatrixAppserviceBatchSendResult
	opAppserviceBatchSend = "appservice_batch_send"
	// ts:operation applySyncResponse apply_sync_response MatrixApplySyncResponseOptions void
	opApplySyncResponse = "apply_sync_response"
	// ts:operation getAccountData get_account_data MatrixGetAccountDataOptions MatrixAccountDataResult
	opGetAccountData = "get_account_data"
	// ts:operation setAccountData set_account_data MatrixSetAccountDataOptions void
	opSetAccountData = "set_account_data"
	// ts:operation getRoomAccountData get_room_account_data MatrixGetRoomAccountDataOptions MatrixAccountDataResult
	opGetRoomAccountData = "get_room_account_data"
	// ts:operation setRoomAccountData set_room_account_data MatrixSetRoomAccountDataOptions void
	opSetRoomAccountData = "set_room_account_data"
	// ts:operation sendToDevice send_to_device MatrixSendToDeviceOptions MatrixSendToDeviceResult
	opSendToDevice = "send_to_device"
	// ts:operation sendReceipt send_receipt MatrixSendReceiptOptions void
	opSendReceipt = "send_receipt"
	// ts:operation postMessage post_message MatrixSendMessageOptions MatrixRawMessage
	opPostMessage = "post_message"
	// ts:operation postMediaMessage post_media_message MatrixSendMediaMessageOptions MatrixRawMessage
	opPostMediaMessage = "post_media_message"
	// ts:operation editMessage edit_message MatrixEditMessageOptions MatrixRawMessage
	opEditMessage = "edit_message"
	// ts:operation deleteMessage delete_message MatrixDeleteMessageOptions void
	opDeleteMessage = "delete_message"
	// ts:operation addReaction add_reaction MatrixReactionOptions MatrixRawMessage
	opAddReaction = "add_reaction"
	// ts:operation removeReaction remove_reaction MatrixReactionOptions void
	opRemoveReaction = "remove_reaction"
	// ts:operation sendEphemeralEvent send_ephemeral_event MatrixSendEphemeralEventOptions MatrixRawMessage
	opSendEphemeralEvent = "send_ephemeral_event"
	// ts:operation createBeeperStream create_beeper_stream MatrixCreateBeeperStreamOptions MatrixCreateBeeperStreamResult
	opCreateBeeperStream = "create_beeper_stream"
	// ts:operation registerBeeperStream register_beeper_stream MatrixRegisterBeeperStreamOptions void
	opRegisterBeeperStream = "register_beeper_stream"
	// ts:operation publishBeeperStream publish_beeper_stream MatrixBeeperStreamOptions void
	opPublishBeeperStream = "publish_beeper_stream"
	// ts:operation unsubscribeBeeperStream unsubscribe_beeper_stream MatrixBeeperStreamOptions void
	opUnsubscribeBeeperStream = "unsubscribe_beeper_stream"
	// ts:operation setTyping set_typing MatrixTypingOptions void
	opSetTyping = "set_typing"
	// ts:operation fetchMessage fetch_message MatrixFetchMessageOptions MatrixFetchMessageResult
	opFetchMessage = "fetch_message"
	// ts:operation fetchMessages fetch_messages MatrixFetchMessagesOptions MatrixFetchMessagesResult
	opFetchMessages = "fetch_messages"
	// ts:operation markRead mark_read MatrixMarkReadOptions void
	opMarkRead = "mark_read"
	// ts:operation uploadMedia upload_media MatrixUploadMediaOptions MatrixUploadMediaResult
	opUploadMedia = "upload_media"
	// ts:operation downloadMedia download_media MatrixDownloadMediaOptions MatrixDownloadMediaResult
	opDownloadMedia = "download_media"
	// ts:operation downloadMediaThumbnail download_media_thumbnail MatrixDownloadMediaThumbnailOptions MatrixDownloadMediaResult
	opDownloadMediaThumbnail = "download_media_thumbnail"
	// ts:operation uploadEncryptedMedia upload_encrypted_media MatrixUploadMediaOptions MatrixUploadEncryptedMediaResult
	opUploadEncryptedMedia = "upload_encrypted_media"
	// ts:operation downloadEncryptedMedia download_encrypted_media MatrixDownloadEncryptedMediaOptions MatrixDownloadMediaResult
	opDownloadEncryptedMedia = "download_encrypted_media"
	// ts:operation createRoom create_room MatrixCreateRoomOptions MatrixCreateRoomResult
	opCreateRoom = "create_room"
	// ts:operation fetchRoom fetch_room MatrixFetchRoomOptions MatrixRoomInfo
	opFetchRoom = "fetch_room"
	// ts:operation fetchRoomState fetch_room_state MatrixFetchRoomStateOptions MatrixFetchRoomStateResult
	opFetchRoomState = "fetch_room_state"
	// ts:operation fetchRoomStateEvent fetch_room_state_event MatrixFetchRoomStateEventOptions MatrixRoomStateEvent
	opFetchRoomStateEvent = "fetch_room_state_event"
	// ts:operation sendRoomStateEvent send_room_state_event MatrixSendRoomStateEventOptions MatrixRawMessage
	opSendRoomStateEvent = "send_room_state_event"
	// ts:operation resolveRoomAlias resolve_room_alias MatrixResolveRoomAliasOptions MatrixResolveRoomAliasResult
	opResolveRoomAlias = "resolve_room_alias"
	// ts:operation listPublicRooms list_public_rooms MatrixListPublicRoomsOptions MatrixListPublicRoomsResult
	opListPublicRooms = "list_public_rooms"
	// ts:operation openDM open_dm MatrixOpenDMOptions MatrixOpenDMResult
	opOpenDM = "open_dm"
	// ts:operation joinRoom join_room MatrixJoinRoomOptions MatrixJoinRoomResult
	opJoinRoom = "join_room"
	// ts:operation leaveRoom leave_room MatrixLeaveRoomOptions void
	opLeaveRoom = "leave_room"
	// ts:operation inviteUser invite_user MatrixInviteUserOptions void
	opInviteUser = "invite_user"
	// ts:operation fetchRoomMembers fetch_room_members MatrixFetchRoomMembersOptions MatrixRoomMembersResult
	opFetchRoomMembers = "fetch_room_members"
	// ts:operation kickUser kick_user MatrixKickUserOptions void
	opKickUser = "kick_user"
	// ts:operation banUser ban_user MatrixBanUserOptions void
	opBanUser = "ban_user"
	// ts:operation unbanUser unban_user MatrixUnbanUserOptions void
	opUnbanUser = "unban_user"
	// ts:operation fetchJoinedRooms fetch_joined_rooms - MatrixJoinedRoomsResult
	opFetchJoinedRooms = "fetch_joined_rooms"
	// ts:operation getUser get_user MatrixGetUserOptions MatrixUserInfo
	opGetUser = "get_user"
	// ts:operation getOwnDisplayName get_own_display_name - MatrixOwnDisplayNameResult
	opGetOwnDisplayName = "get_own_display_name"
	// ts:operation setOwnDisplayName set_own_display_name MatrixSetOwnDisplayNameOptions void
	opSetOwnDisplayName = "set_own_display_name"
	// ts:operation getOwnAvatarURL get_own_avatar_url - MatrixOwnAvatarURLResult
	opGetOwnAvatarURL = "get_own_avatar_url"
	// ts:operation setOwnAvatarURL set_own_avatar_url MatrixSetOwnAvatarURLOptions void
	opSetOwnAvatarURL = "set_own_avatar_url"
	// ts:operation listRoomThreads list_room_threads MatrixListRoomThreadsOptions MatrixListRoomThreadsResult
	opListRoomThreads = "list_room_threads"
	// ts:operation close close - void
	opClose = "close"
)
