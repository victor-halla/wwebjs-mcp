---
name: wwebjs-mcp
description: Use the wwebjs-mcp server to drive WhatsApp via the wwebjs-api. Covers connecting a session (QR/pairing), sending text/media/location/poll messages, managing chats, groups, contacts, labels, and reacting/replying to messages. Trigger when the user wants to send WhatsApp messages, manage a WhatsApp session, or otherwise use the whatsapp / wwebjs MCP tools.
---

# Using the WhatsApp (wwebjs-mcp) tools

This MCP server wraps the [wwebjs-api](https://github.com/avoylenko/wwebjs-api).
Every tool maps 1:1 to a REST endpoint. Tool names follow
`<area>_<action>` (e.g. `session_start`, `client_sendMessage`,
`message_react`, `groupChat_addParticipants`).

## Core concepts

- **Session** — a single logged-in WhatsApp account, identified by a
  `sessionId` you choose (alphanumeric + `-`). Almost every tool takes
  `sessionId`. Sessions persist on the wwebjs-api server across restarts.
- **chatId** — the WhatsApp address of a chat:
  - individual: `<countrycode><number>@c.us`, e.g. `551199998888@c.us`
  - group: `<id>@g.us`
  - channel: `<id>@newsletter`
  Never guess a chatId from a raw phone number — resolve it first with
  `client_getNumberId` (returns the correct serialized id).
- **messageId** — needed to react/reply/forward/delete a message. Get it from
  `chat_fetchMessages` or `client_searchMessages`.

## 1. Connect a session (do this first)

1. `session_start` with `{ "sessionId": "main" }`.
2. Poll `session_status` `{ "sessionId": "main" }` until it reports the client
   is connected/ready.
3. If not yet authenticated, get the login QR:
   - `session_qr` → QR string, **or**
   - `session_qr_image` (the `/qr/{id}/image` endpoint) → returns a PNG as
     image content the user can scan.
   - Alternatively `session_requestPairingCode` `{ "sessionId": "main",
     "phoneNumber": "551199998888" }` for phone-code login.
4. Ask the user to scan/enter it, then re-check `session_status`.

Tell the user plainly when a QR scan is required — you cannot scan it for them.

## 2. Send messages — `client_sendMessage`

The body is always `{ sessionId, chatId, contentType, content, options? }`.
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
"caption": "..." }`. Use `message_reply` when you specifically want to quote a
message by id.

Before sending to a new number, verify it exists:
`client_isRegisteredUser` / `client_getNumberId`.

## 3. Common tasks → tools

| Goal | Tool(s) |
|---|---|
| List chats | `client_getChats` |
| Read messages in a chat | `chat_fetchMessages` (`{ chatId, limit }`) |
| Search messages | `client_searchMessages` |
| Mark read / typing | `client_sendSeen`, `chat_sendStateTyping` |
| React to a message | `message_react` (`{ chatId, messageId, reaction }`, empty string removes) |
| Reply / forward / edit / delete | `message_reply`, `message_forward`, `message_edit`, `message_delete` |
| Download media from a message | `message_downloadMedia` |
| Contacts | `client_getContacts`, `client_getContactById`, `contact_block`, `contact_unblock` |
| Profile pic / about | `client_getProfilePicUrl`, `contact_getAbout` |
| Create group | `client_createGroup` (`{ name, participants: [...] }`) |
| Group admin | `groupChat_addParticipants`, `removeParticipants`, `promoteParticipants`, `demoteParticipants`, `setSubject`, `setDescription`, `getInviteCode`, `leave` |
| Labels (WA Business) | `client_getLabels`, `client_addOrRemoveLabels`, `chat_changeLabels` |
| Channels | `client_getChannels`, `channel_sendMessage`, `client_subscribeToChannel` |
| Screenshot of the WA Web page | `session_getPageScreenshot` (returns PNG) |

## 4. Workflow guidance

- **Resolve ids before acting.** Phone number → `client_getNumberId` →
  `chatId`. Chat → `chat_fetchMessages` → `messageId`.
- **Check state on errors.** HTTP 404/422 usually means the session isn't ready
  or an id is wrong — call `session_status` / `client_getState` and re-resolve
  ids rather than retrying blindly.
- **Confirm destructive actions** with the user before calling them:
  `session_terminate`, `session_terminateAll`, `chat_delete`,
  `chat_clearMessages`, `groupChat_leave`, `message_delete`, `contact_block`.
- **Rate / pacing.** For bulk operations (adding many participants, messaging
  many chats) pass the API's `options.sleep` where available and space calls
  out; WhatsApp bans automated flooding.
- **Media size.** Prefer `MessageMediaFromURL` for large files; inline base64
  (`MessageMedia`) bloats the request.

## 5. Discoverability

If you're unsure which tool matches a need, list the available tools — every
wwebjs-api endpoint is present and named after its path. The tool description
carries the endpoint's `[Tag] summary` from the OpenAPI spec.
