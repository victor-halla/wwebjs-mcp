---
name: wwebjs-mcp
description: Use the wwebjs-mcp server to drive WhatsApp via the wwebjs-api. Covers connecting a session (QR/pairing), sending text/media/location/poll messages, managing chats, groups, contacts, labels, channels, and reacting/replying to messages. Trigger when the user wants to send WhatsApp messages, manage a WhatsApp session, or otherwise use the whatsapp / wwebjs MCP tools.
---

# Using the wwebjs-mcp tools

This MCP server exposes the [wwebjs-api](https://github.com/avoylenko/wwebjs-api)
as one MCP tool per REST endpoint — **149 tools**, generated automatically
from its OpenAPI spec. Tool names are `<area>_<action>`
(`session_start`, `client_sendMessage`, `message_react`,
`groupChat_addParticipants`, …); the full catalog is in section 3 below.

Call a tool exactly like any other tool available to you: pass a single JSON
object with `sessionId` plus whatever fields that tool needs, listed in the
catalog as `tool_name(sessionId, field1, field2, ...)`. There is no separate
"MCP call" step to think about — the tool *is* the call.

If a tool you need isn't in the catalog below (the upstream API grows over
time and this file can lag), check your live tool list — every wwebjs-api
endpoint is always present, named after its path.

## Core concepts

- **Session** — a single logged-in WhatsApp account, identified by a
  `sessionId` you choose (alphanumeric + `-`). Almost every tool takes
  `sessionId`. Sessions persist on the wwebjs-api server across restarts.
- **chatId** — the WhatsApp address of a chat:
  - individual: `<countrycode><number>@c.us`, e.g. `551199998888@c.us`
  - group: `<id>@g.us`
  - channel: `<id>@newsletter`
  Never guess a chatId from a raw phone number — resolve it first with
  `client_getNumberId` (returns the correctly serialized id).
- **messageId** — needed to react/reply/forward/star/delete a message. Get it
  from `chat_fetchMessages` or `client_searchMessages`.

## 1. Connect a session (do this first)

1. `session_getSessions()` — see what's already running before creating a
   duplicate.
2. `session_start(sessionId)` to launch a new one, or `session_restart(sessionId)`
   to recover one that exists but shows `session_not_connected`
   (`session_start` on an existing id fails with `Session already exists`).
3. Poll `session_status(sessionId)` until it reports connected/ready.
4. If not yet authenticated, get the login credential:
   - `session_qr(sessionId)` → raw QR string, **or**
   - `session_qr_image(sessionId)` → PNG returned as MCP image content the
     user can scan directly, **or**
   - `session_requestPairingCode(sessionId, phoneNumber)` → a phone-entry
     pairing code instead of a QR.
5. Ask the user to scan/enter it, then re-check `session_status`. QR codes
   expire in well under a minute — regenerate with `session_qr_image` if too
   much time passed rather than reusing a stale one.

Tell the user plainly when a QR scan or pairing code entry is required — you
cannot complete that step for them.

## 2. Send messages — `client_sendMessage`

`client_sendMessage(sessionId, chatId, contentType, content, options?)`.
`contentType` selects the shape of `content`:

| contentType | content example |
|---|---|
| `string` | `"Hello!"` |
| `MessageMediaFromURL` | `"https://example.com/img.jpg"` |
| `MessageMedia` | `{ "mimetype": "image/jpeg", "data": "<base64>", "filename": "img.jpg" }` |
| `Location` | `{ "latitude": -23.5, "longitude": -46.6, "description": "Office" }` |
| `Contact` | a contactId string, e.g. `"551199990000@c.us"` |
| `Poll` | `{ "pollName": "Lunch?", "pollOptions": ["Pizza","Sushi"], "options": { "allowMultipleAnswers": false } }` |

Text example:
```json
{ "sessionId": "main", "chatId": "551199998888@c.us",
  "contentType": "string", "content": "Olá! 👋" }
```

`options` supports things like `{ "quotedMessageId": "...", "mentions": [...],
"caption": "..." }`. Use `message_reply` instead when you specifically want
to quote a message by id (same `contentType`/`content` shape, plus
`messageId`).

Before sending to a new number, verify it exists:
`client_isRegisteredUser(sessionId, number)` or `client_getNumberId(sessionId, number)`.

## 3. Full tool catalog

Every argument below is in addition to `sessionId`. `options`/`searchOptions`
are open-ended objects passed straight through to the underlying
`whatsapp-web.js` call — check the wwebjs-api docs or just try the fields
that make sense for the action. Body field names come straight from the
upstream OpenAPI spec; on a validation error the server's response tells you
exactly which fields it expected, so treat that as authoritative over this
list if they ever disagree.

### Session — connect, monitor, and tear down sessions

- `session_getSessions()` — list all session ids known to the server.
- `session_start(sessionId)` — start a brand-new session (fails if one already exists — use `session_restart` instead).
- `session_status(sessionId)` — connection state (`CONNECTED`, or `session_not_connected`, etc).
- `session_qr(sessionId)` — raw QR login string.
- `session_qr_image(sessionId)` — QR login code as a scannable PNG.
- `session_requestPairingCode(sessionId, phoneNumber, showNotification?)` — phone-entry pairing code instead of a QR.
- `session_restart(sessionId)` — restart an existing session (use this to reconnect one that dropped).
- `session_stop(sessionId)` — stop a session without deleting its saved auth (can be started again later).
- `session_terminate(sessionId)` — **destructive.** Stop and delete a session's auth; next start needs a fresh QR/pairing. Confirm with the user first.
- `session_terminateAll()` — **destructive.** Terminates every session on the server. Confirm with the user first.
- `session_terminateInactive()` — **destructive.** Terminates sessions the server considers inactive. Confirm with the user first.
- `session_getPageScreenshot(sessionId)` — PNG screenshot of the underlying WhatsApp Web page; handy for debugging a stuck session.

### Client — account-wide actions (not tied to one chat)

- `client_getState(sessionId)` / `client_getClassInfo(sessionId)` — connection state / current-connection info.
- `client_getWWebVersion(sessionId)` — WhatsApp Web version in use.
- `client_resetState(sessionId)` — force-reset the connection state.
- `client_sendMessage(sessionId, chatId, contentType, content, options?)` — see section 2.
- `client_sendPresenceAvailable(sessionId)` / `client_sendPresenceUnavailable(sessionId)` — mark yourself online/offline.
- `client_sendSeen(sessionId, chatId)` — mark a chat as read.
- `client_getNumberId(sessionId, number)` — resolve a raw phone number to its WhatsApp id (**do this before messaging a new number**).
- `client_isRegisteredUser(sessionId, number)` — check whether a number is on WhatsApp at all.
- `client_getFormattedNumber(sessionId, number)` / `client_getCountryCode(sessionId, number)` — number formatting helpers.
- `client_getContacts(sessionId)` / `client_getContactById(sessionId, contactId)` — list / fetch contacts.
- `client_getContactDeviceCount(sessionId, userId)` — how many devices a contact is linked on.
- `client_getContactLidAndPhone(sessionId, userIds)` — resolve LID↔phone number pairs.
- `client_getBlockedContacts(sessionId)` — list blocked contacts.
- `client_getProfilePicUrl(sessionId, contactId)` — a contact's profile picture URL.
- `client_getCommonGroups(sessionId, contactId)` — groups you share with a contact.
- `client_getChats(sessionId)` / `post_client_getChats(sessionId, searchOptions?)` — list all chats (the `post_` variant accepts search options; same underlying data otherwise).
- `client_getChatById(sessionId, chatId)` — fetch one chat.
- `client_searchMessages(sessionId, query, options?)` — full-text message search.
- `client_archiveChat` / `client_unarchiveChat(sessionId, chatId)` — archive toggle.
- `client_pinChat` / `client_unpinChat(sessionId, chatId)` — pin toggle.
- `client_muteChat(sessionId, chatId, unmuteDate?)` / `client_unmuteChat(sessionId, chatId)` — mute toggle.
- `client_markChatUnread(sessionId, chatId)` — mark a chat unread.
- `client_openChatWindow(sessionId, chatId)` / `client_openChatWindowAt(sessionId, messageId)` — focus a chat in the underlying WhatsApp Web page.
- `client_syncHistory(sessionId, chatId)` — request full history sync for a chat.
- `client_getLabels(sessionId)` / `client_getLabelById(sessionId, labelId)` — WhatsApp Business labels.
- `client_getChatLabels(sessionId, chatId)` — labels on one chat.
- `client_getChatsByLabelId(sessionId, labelId)` — chats under one label.
- `client_addOrRemoveLabels(sessionId, labelIds, chatIds)` — assign/unassign labels across chats.
- `client_createGroup(sessionId, title, participants, options?)` — create a group.
- `client_acceptInvite(sessionId, inviteCode)` — join a group via invite code.
- `client_getInviteInfo(sessionId, displayName)` — preview an invite before accepting.
- `client_createChannel(sessionId, title, options?)` — create a channel.
- `client_getChannels(sessionId)` — list channels.
- `client_getChannelByInviteCode(sessionId, inviteCode)` / `client_searchChannels(sessionId, searchOptions?)` — find channels.
- `client_subscribeToChannel(sessionId, channelId)` / `client_unsubscribeFromChannel(sessionId, channelId, options?)` — channel subscription toggle.
- `client_setDisplayName(sessionId, ...)` / `client_setStatus(sessionId, status)` / `client_setProfilePicture(sessionId, ...)` / `client_deleteProfilePicture(sessionId)` — account profile settings. **Note:** the upstream spec's `client_setDisplayName` body schema is copy-pasted from the profile-picture endpoint (`pictureMimetype`/`pictureData`) — if it 400s, try the field name that actually matches what you're setting, or fall back to `client_runMethod`.
- `client_setAutoDownloadAudio(sessionId, flag)` / `client_setAutoDownloadDocuments(sessionId, flag)` / `client_setAutoDownloadPhotos(sessionId, flag)` / `client_setAutoDownloadVideos(sessionId, flag)` — auto-download toggles.
- `client_setBackgroundSync(sessionId, flag)` — background sync toggle.
- `client_runMethod(sessionId, method, options?)` — escape hatch: call an arbitrary `whatsapp-web.js` `Client` method not otherwise exposed.

### Chat — actions scoped to one chat (individual or group)

- `chat_getClassInfo(sessionId, chatId)` — fetch the chat object.
- `chat_getContact(sessionId, chatId)` — the chat's contact (1:1 chats).
- `chat_fetchMessages(sessionId, chatId, searchOptions?)` — load message history (`searchOptions: { limit, fromMe? }`).
- `chat_sendSeen(sessionId, chatId)` — mark as read.
- `chat_sendStateTyping(sessionId, chatId)` / `chat_sendStateRecording(sessionId, chatId)` — show a "typing…"/"recording…" indicator.
- `chat_clearState(sessionId, chatId)` — stop those indicators immediately.
- `chat_markUnread(sessionId, chatId)` — mark unread.
- `chat_clearMessages(sessionId, chatId)` — **destructive.** Wipes chat history. Confirm with the user first.
- `chat_delete(sessionId, chatId)` — **destructive.** Deletes the chat. Confirm with the user first.
- `chat_getLabels(sessionId, chatId)` / `chat_changeLabels(sessionId, chatId, labelIds)` — read/change this chat's labels.
- `chat_syncHistory(sessionId, chatId)` — request history sync for this chat.
- `chat_runMethod(sessionId, chatId, method, options?)` — escape hatch for arbitrary `Chat` methods.

### Group Chat — group-specific management (chatId must be a `@g.us` id)

- `groupChat_getClassInfo(sessionId, chatId)` — fetch group metadata.
- `groupChat_setSubject(sessionId, chatId, subject)` / `groupChat_setDescription(sessionId, chatId, description)` — rename / redescribe.
- `groupChat_setPicture(sessionId, chatId, pictureMimeType, pictureData)` / `groupChat_deletePicture(sessionId, chatId)` — group photo.
- `groupChat_setInfoAdminsOnly(sessionId, chatId, adminsOnly)` — restrict who can edit group info.
- `groupChat_setMessagesAdminsOnly(sessionId, chatId, adminsOnly)` — restrict who can post.
- `groupChat_addParticipants(sessionId, chatId, participantIds, options?)` — add members.
- `groupChat_removeParticipants(sessionId, chatId, participantIds)` — remove members.
- `groupChat_promoteParticipants(sessionId, chatId, participantIds)` / `groupChat_demoteParticipants(sessionId, chatId, participantIds)` — admin toggle.
- `groupChat_getGroupMembershipRequests(sessionId, chatId)` — pending join requests.
- `groupChat_approveGroupMembershipRequests(sessionId, chatId, options?)` / `groupChat_rejectGroupMembershipRequests(sessionId, chatId, options?)` — act on join requests.
- `groupChat_getInviteCode(sessionId, chatId)` / `groupChat_revokeInvite(sessionId, chatId)` — invite link management.
- `groupChat_leave(sessionId, chatId)` — **destructive** (you lose access). Confirm with the user first.
- `groupChat_runMethod(sessionId, chatId, method, options?)` — escape hatch for arbitrary `GroupChat` methods.

### Message — act on a specific message (needs `chatId` + `messageId`)

- `message_getClassInfo(sessionId, chatId, messageId)` — fetch the message object.
- `message_getContact(sessionId, chatId, messageId)` — sender's contact.
- `message_getInfo(sessionId, chatId, messageId)` — delivery/read status.
- `message_getQuotedMessage(sessionId, chatId, messageId)` — the message this one quotes, if any.
- `message_getMentions(sessionId, chatId, messageId)` / `message_getGroupMentions(sessionId, chatId, messageId)` — mentioned contacts/groups.
- `message_getReactions(sessionId, chatId, messageId)` — who reacted, and with what.
- `message_getOrder(sessionId, chatId, messageId)` / `message_getPayment(sessionId, chatId, messageId)` — WhatsApp Business order/payment message details.
- `message_getPollVotes(sessionId, chatId, messageId)` — poll results for a poll message.
- `message_downloadMedia(sessionId, chatId, messageId)` / `message_downloadMediaAsData(sessionId, chatId, messageId)` — download attached media (as MCP content / as raw base64 data respectively).
- `message_react(sessionId, chatId, messageId, reaction)` — react with an emoji; empty string `""` removes your reaction.
- `message_reply(sessionId, chatId, messageId, contentType, content, options?)` — reply quoting this message (same content shapes as `client_sendMessage`).
- `message_forward(sessionId, chatId, messageId, destinationChatId)` — forward to another chat.
- `message_edit(sessionId, chatId, messageId, content, options?)` — edit a message you sent.
- `message_star(sessionId, chatId, messageId)` / `message_unstar(sessionId, chatId, messageId)` — star toggle.
- `message_delete(sessionId, chatId, messageId, everyone?, clearMedia?)` — **destructive.** `everyone: true` deletes for all recipients (only works within WhatsApp's short delete window). Confirm with the user first.
- `message_runMethod(sessionId, chatId, messageId, method, options?)` — escape hatch for arbitrary `Message` methods.

### Contact — actions on a contact (not chat-scoped)

- `contact_getClassInfo(sessionId, contactId)` — fetch the contact object.
- `contact_getAbout(sessionId, contactId)` — their "about"/status text.
- `contact_getChat(sessionId, contactId)` — the 1:1 chat with this contact.
- `contact_getCommonGroups(sessionId, contactId)` — shared groups.
- `contact_getProfilePicUrl(sessionId, contactId)` — profile picture URL.
- `contact_getFormattedNumber(sessionId, contactId)` / `contact_getCountryCode(sessionId, contactId)` — number formatting helpers.
- `contact_block(sessionId, contactId)` / `contact_unblock(sessionId, contactId)` — block toggle. Confirm blocking with the user first.

### Channel Chat — channel-specific management (chatId must be a `@newsletter` id)

- `channel_getClassInfo(sessionId, chatId)` — fetch channel metadata.
- `channel_fetchMessages(sessionId, chatId, searchOptions?)` — load channel post history.
- `channel_sendMessage(sessionId, chatId, contentType, content, options?)` — post to the channel (same content shapes as `client_sendMessage`).
- `channel_sendSeen(sessionId, chatId)` — mark channel posts as seen.
- `channel_getSubscribers(sessionId, chatId, limit?)` — subscribers who are also in your contacts.
- `channel_setSubject(sessionId, chatId, newSubject)` / `channel_setDescription(sessionId, chatId, newDescription)` — rename / redescribe.
- `channel_setProfilePicture(sessionId, chatId, newProfilePictureUrl?, newProfilePictureMedia?)` — channel photo.
- `channel_setReactionSetting(sessionId, chatId, reactionCode)` — configure allowed reactions.
- `channel_mute(sessionId, chatId)` / `channel_unmute(sessionId, chatId)` — mute toggle.
- `channel_sendChannelAdminInvite(sessionId, chatId, userId, options?)` / `channel_revokeChannelAdminInvite(sessionId, chatId, userId)` — admin invite management.
- `channel_acceptChannelAdminInvite(sessionId, chatId)` / `channel_demoteChannelAdmin(sessionId, chatId, userId)` — accept invite / demote an admin.
- `channel_transferChannelOwnership(sessionId, chatId, newOwnerId, options?)` — **destructive** (you lose ownership). Confirm with the user first.
- `channel_deleteChannel(sessionId, chatId)` — **destructive.** Confirm with the user first.

### Utility

- `ping()` — no `sessionId`; health-checks the wwebjs-api server itself (not a session).
- `localCallbackExample` exists in the spec but is wwebjs-api's own webhook test endpoint (upstream docs: "ONLY FOR DEVELOPMENT/TEST PURPOSES") — not something you'd call from here.

## 4. Workflow guidance

- **Resolve ids before acting.** Phone number → `client_getNumberId` →
  `chatId`. Chat → `chat_fetchMessages` → `messageId`.
- **Check state on errors.** HTTP 404/422 usually means the session isn't
  ready or an id is wrong — call `session_status` / `client_getState` and
  re-resolve ids rather than retrying blindly.
- **Confirm destructive actions** with the user before calling them — flagged
  throughout the catalog above (`session_terminate*`, `chat_delete`,
  `chat_clearMessages`, `groupChat_leave`, `message_delete`, `contact_block`,
  `channel_deleteChannel`, `channel_transferChannelOwnership`).
- **Rate / pacing.** For bulk operations (adding many participants, messaging
  many chats) pass the API's `options.sleep` where available and space calls
  out; WhatsApp bans automated flooding.
- **Media size.** Prefer `MessageMediaFromURL` for large files; inline base64
  (`MessageMedia`) bloats the request.
