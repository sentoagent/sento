# WhatsApp + LINE channels — implementation notes

> Living document for the `feat/whatsapp-line-channels` branch. Update as
> decisions land. This branch ships in stages over multiple sessions.

## Goal

Add two new messaging channels to Sentō:

1. **LINE** — bot-mode, official Messaging API. Unlocks the Japanese market
   (84% of Japanese smartphone users have LINE).
2. **WhatsApp** — companion-mode via Baileys (unofficial client automation).
   Unlocks LatAm/Spain/India and the millions of WhatsApp-first users.

## What's done in this commit

- Plugin scaffolds at `plugins/line/` and `plugins/whatsapp/` with manifests,
  package.json (correct deps), `.mcp.json`, and stub `server.ts` files
  that exit with a clear "WIP" message.
- READMEs in each plugin documenting the planned architecture so the next
  implementer (us, future-us, or anyone else) doesn't have to start from
  scratch.
- `src/prompts.js` lists LINE and WhatsApp as channel options (marked WIP),
  plus the LINE token + secret prompts and the WhatsApp ToS-ack confirm.
- `src/steps/install-plugins.js` knows how to install local Sentō-shipped
  plugins from the `plugins/` directory (only when the chosen channel
  matches), since neither LINE nor WhatsApp is in `claude-plugins-official`.
- `src/steps/configure-channel.js` knows where LINE's two secrets land in
  `.env`, and that WhatsApp uses Baileys creds.json (no install-time token).

## LINE plugin status — code-complete, not yet live-tested

**Done:**
- [x] stdio MCP server with `list_unread`, `send_message`, `clear_inbox_item` tools
- [x] Hono webhook receiver on `LINE_WEBHOOK_PORT` (default 8765)
- [x] Webhook signature verification via `LINE_CHANNEL_SECRET`
- [x] Pairing flow with 5-char codes (10-min TTL), matches discord's pattern
- [x] `access.json` schema: `dmPolicy` (pairing default) + `allowFrom` +
      `groups` + `pending` + `mentionPatterns`
- [x] Approved-pairings poller — reads `approved/<senderId>` files dropped
      by the `/line:access` skill, sends "you're paired" confirm
- [x] Mention gating for groups/rooms — requires bot userId in mentionees
      array OR regex match from `mentionPatterns`
- [x] Reply-token expiry fallback — on reply API error, falls back to push
      with a stderr warning (if `to_id` also provided)
- [x] `/line:access` skill at `plugins/line/skills/access/SKILL.md`
- [x] Webhook URL printed prominently during `sento init` with clear
      reverse-proxy instructions
- [x] Guardian regex updated to include `← line` + `← whatsapp`
- [x] `sento doctor` validates LINE token + secret presence, WhatsApp
      creds.json existence + parse-ability

**Still pending for true production-ready:**
- [ ] **Actually run the plugin** — I haven't executed `bun install` in the
      plugin dir, started the server, or sent a real LINE message through
      it. Code reads correctly but has not been smoke-tested.
- [ ] Message buffering window (mirror telegram's 30-90s batching)
- [ ] LINE Flex Messages / sticker / image handling (text only for v1)
- [ ] Rate limiting on outbound push
- [ ] Quota tracking (LINE free tier = 500 push/month)
- [ ] Test against a real LINE Messaging API channel end-to-end

### WhatsApp plugin (`plugins/whatsapp/server.ts`)

Architecture cribs from
[openclaw/openclaw `extensions/whatsapp/`](https://github.com/openclaw/openclaw/tree/main/extensions/whatsapp)
(MIT). Patterns reused with attribution; code written fresh.

Phase 1 — auth + connection:
- [ ] Wire Baileys with `useMultiFileAuthState` against
      `~/.claude/channels/whatsapp/<accountId>/`
- [ ] QR code render via `qrcode-terminal` + base64 PNG for web setup
- [ ] Pairing-code alternative for headless VPS
- [ ] Creds persistence with parse-before-clobber `.bak` (chmod 600)
- [ ] Reconnect policy: `{ initialMs: 2_000, maxMs: 30_000, factor: 1.8,
      jitter: 0.25, maxAttempts: 12 }`

Phase 2 — identity + access control:
- [ ] Identity normalization (JID / LID / E.164, strip multi-device suffix)
- [ ] `access.json` shape mirroring Discord's, plus E.164 allowlist
- [ ] `dmPolicy`: pairing | allowlist | open | disabled
- [ ] Group three-layer gating: membership × sender policy × mention

Phase 3 — MCP tool surface:
- [ ] `list_chats`, `fetch_messages`, `reply` — no confirm
- [ ] `send_whatsapp_to_contact` — confirm=true (the "draft before send"
      tool the agent uses to message third parties)
- [ ] `typing_indicator`, `react`

Phase 4 — safety:
- [ ] Per-recipient rate limit (1 msg / 10s)
- [ ] Per-account rate limit (30 msg / min)
- [ ] Heartbeat + Guardian integration so a logged-out session triggers
      a re-link prompt via the user's primary channel (Discord etc.)

### Sentō integration polish

- [ ] `src/templates/guardian.js` — add `← line` and `← whatsapp` to the
      log-pattern regex so Guardian's stuck-detection works for these too
- [ ] `src/commands/doctor.js` — add validation for LINE token presence
      and WhatsApp creds.json existence/health
- [ ] `src/templates/start-agent.js` — verify it dynamically uses
      `config.channelType` for both new channels (it already does today)
- [ ] `docker-entrypoint.sh` — currently installs from
      `claude-plugins-official` only. For Docker users on LINE/WhatsApp,
      we need to also install the local plugins. Decide: bundle them
      into the Docker image, or pull them from a future
      `sentoagent/claude-plugins-sento` marketplace.

### Website (sento-website repo, separate branch)

- [ ] Add LINE + WhatsApp tabs to `/setup`'s channel picker
- [ ] Translate the new tab content to es/zh/ja (~50 strings each)
- [ ] Add LINE + WhatsApp branches to the wizard's chat flow
- [ ] Update Nav + sitemap if needed
- [ ] Blog post announcing each (separate launch moments — see
      "Stagger features as launch moments" insight)

## Architecture decisions made so far

### Local plugins vs. dedicated marketplace

**Decision (revisitable):** ship LINE + WhatsApp as local plugins under
`sento/plugins/`, install via `claude plugin install <path>` directly.

**Why:** lets us iterate fast without standing up a second repo. A future
`sentoagent/claude-plugins-sento` marketplace is a v2 concern when we want
plugin updates without bumping Sentō's version.

**Trade-off:** Docker users who clone the Sentō repo get the plugins. But
users who do `npx sentoagent init` from npm get... what exactly? The npm
package needs to either (a) ship the plugins as bundled assets or (b)
fetch them at runtime. Open question — flag for next session.

### Two-layer outbound for WhatsApp

**Decision:** copy OpenClaw's split — channel handles inbound + linked-number
reply automatically; agent-initiated outbound to other contacts goes through
a `send_whatsapp_to_contact` MCP tool with `confirm=true` default.

**Why:** matches user's product intuition ("agent only responds to me
unless I explicitly tell it to message someone else"), gives Claude a
natural place to draft + show + wait for approval, and keeps the channel
plugin focused on transport rather than UX policy.

**Difference from OpenClaw:** they put the outbound tool in a separate
binary (`wacli`). We embed it in the same MCP server. Simpler install
(one fewer dependency), at the cost of slightly less blast-radius isolation.
If we ever hit OpenClaw's "store is locked" issue, we can split later.

### Bot mode for LINE, companion mode for WhatsApp

**Decision:** default modes match transport class — LINE bot-mode (it has a
proper bot identity), WhatsApp companion-mode (no separate identity, must
ride on user's number).

**Why:** matches the discussion in the project plan — "transport type
determines interaction mode." Bot transports stay bot-first by default;
identity transports are companion-only.

## Risks + things to watch

1. **Baileys protocol changes.** OpenClaw pins exact (`7.0.0-rc.9`) and
   manually bumps. Plan for the same — pin exact in `package.json`, watch
   the Baileys repo for releases, test before bumping.
2. **WhatsApp account bans.** Real risk. Surface the warning in the CLI
   (done — see `whatsappTosAck` confirm in prompts.js) and in the website
   setup page (TODO — needs adding when we update the website).
3. **LINE webhook public URL.** Telegram can long-poll, LINE can't. For
   Mac-local installs we either need to recommend ngrok / Cloudflare Tunnel
   or label LINE as "VPS only" in docs.
4. **Plugin distribution path.** The local `plugins/` directory works for
   `git clone` users and Docker users, but the npm package shipped via
   `npx sentoagent init` doesn't currently bundle these. Needs solving
   before LINE or WhatsApp can ship in a release.

## Reference reading

- [openclaw/openclaw `extensions/whatsapp/`](https://github.com/openclaw/openclaw/tree/main/extensions/whatsapp) — MIT, primary architectural reference
- [WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys) — the WhatsApp library
- [LINE Messaging API docs](https://developers.line.biz/en/docs/messaging-api/) — official
- [`@line/bot-sdk`](https://github.com/line/line-bot-sdk-nodejs) — official Node SDK
- The discord plugin in `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/discord/` — the reference Sentō plugin

## Branch status

- Branch: `feat/whatsapp-line-channels`
- Base: `main` (off `ba374fd v1.0.3`)
- Mergeable to main: **NO** until plugin servers are functional. CLI will
  offer LINE/WhatsApp options but selecting them will result in a stub
  process exiting at first launch.
