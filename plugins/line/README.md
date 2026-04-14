# LINE channel for Claude Code

Bot-mode messaging bridge using LINE's official Messaging API.

**Status:** scaffolding only. Not yet functional.

## Target architecture

Mirrors the `discord` plugin in `claude-plugins-official`:

- **MCP server** over stdio transport. Exposes tools: `fetch_messages`,
  `send_message`, `react`, `typing_indicator`.
- **Hono HTTP server** listens on `$LINE_WEBHOOK_PORT` for LINE's POST
  webhooks. Inbound events buffer to `~/.claude/channels/line/inbox/`.
- **State dir:** `~/.claude/channels/line/`
  - `.env` — `LINE_CHANNEL_TOKEN`, `LINE_CHANNEL_SECRET`, `LINE_WEBHOOK_PORT`
  - `access.json` — same shape as discord's (allowFrom, dmPolicy, groups)
  - `inbox/` — pending inbound messages

## Setup flow (planned)

During `npx sentoagent init` → LINE:

1. User creates a LINE channel at developers.line.biz, gets Channel Access
   Token + Channel Secret
2. Sentō prints a webhook URL (e.g. `https://their-vps.com/line/webhook`)
3. User pastes that URL into the LINE Messaging API console
4. First message from the user pairs their LINE ID with the agent
   (same pairing pattern as discord)

## Dependencies

- `@line/bot-sdk` — official LINE SDK
- `@modelcontextprotocol/sdk` — MCP protocol
- `hono` — lightweight HTTP server for the webhook

## Open decisions

- **State file schema** — reuse discord's `access.json` verbatim, or fork?
  Leaning reuse to keep Guardian health patterns + Sentō tooling identical.
- **Message buffering** — Telegram plugin batches messages with a 30-90s
  window; do we want the same for LINE? Probably yes.
- **Flex Messages** — rich LINE bubble UI. v1 ships plain text. Flex in v2.

## VPS vs local install

LINE only supports webhooks (no long-polling like Telegram), so the host
must be publicly reachable. On a VPS with a domain + reverse proxy this is
trivial. For Mac-local installs, we need to doc an ngrok / Cloudflare Tunnel
path or label LINE as "VPS only."

## Next session

1. Wire the stdio MCP server with actual tool handlers
2. Stand up the Hono webhook receiver
3. Implement access.json pairing flow
4. Write the `configure-channel.js` path for LINE token + webhook URL
5. Test against a real LINE bot
