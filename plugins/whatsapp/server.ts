#!/usr/bin/env bun
/**
 * WhatsApp channel for Claude Code.
 *
 * WIP — scaffolding only. Not functional yet.
 *
 * Architecture plan (cribs heavily from OpenClaw's @openclaw/whatsapp at
 * github.com/openclaw/openclaw/tree/main/extensions/whatsapp — MIT licensed,
 * patterns reused with attribution):
 *
 * Two-layer split (the OpenClaw insight):
 * - INBOUND + REPLY ON LINKED NUMBER → automatic via Baileys socket here.
 *   Anyone allowlisted who messages the linked WhatsApp number gets a reply.
 * - AGENT-INITIATED OUTBOUND TO OTHER CONTACTS → separate MCP tool with
 *   confirm=true default. Agent must show a draft + wait for explicit
 *   user approval before sending. Tool name: send_whatsapp_to_contact.
 *
 * State dir: ~/.claude/channels/whatsapp/<accountId>/
 *   ├── .env                 (no token — Baileys uses session creds)
 *   ├── creds.json           (Baileys auth state, chmod 600)
 *   ├── creds.json.bak       (parse-before-clobber backup)
 *   ├── access.json          (allowFrom in E.164, dmPolicy, group rules)
 *   └── inbox/               (pending inbound messages)
 *
 * Auth options (mirror OpenClaw):
 * 1. QR code — first-run, Baileys emits 'qr' event, render to terminal +
 *    base64 PNG for web setup
 * 2. Pairing code — alternative for headless VPS where QR is awkward
 *
 * Identity normalization (CRITICAL — copy OpenClaw's identity.ts):
 * - WhatsApp uses @s.whatsapp.net JIDs (classic), @lid / @hosted.lid (new),
 *   plus E.164. Multi-device adds :N suffix to the JID. Always normalize
 *   before any "is this from me?" comparison or allowlist check.
 *
 * Reconnect policy (copy OpenClaw):
 * - initialMs: 2_000, maxMs: 30_000, factor: 1.8, jitter: 0.25, maxAttempts: 12
 * - On DisconnectReason.loggedOut → stop retrying, surface re-link prompt
 *
 * Group safety (copy OpenClaw's two-layer pattern):
 * - Membership allowlist: which groups bot listens in
 * - Sender policy within allowed group: who can issue commands
 * - Mention gating: required @mention or reply-to-bot
 * - Quote/reply explicitly does NOT grant authorization
 *
 * Rate limiting (NEW — OpenClaw lacks this, ban-risk concern):
 * - Per-recipient limit: max 1 outbound message per 10s per contact
 * - Per-account limit: max 30 outbound per minute
 *
 * MCP tools to expose:
 *   list_chats              — read recent chats
 *   fetch_messages          — read history of a chat
 *   reply                   — reply in the current chat (low friction)
 *   send_whatsapp_to_contact — send to a different contact (CONFIRM=TRUE)
 *   typing_indicator        — send typing
 *   react                   — emoji reaction
 *
 * Open questions for next session:
 * - Where do we surface QR code during `npx sentoagent init`? Stdout in tmux
 *   or open a localhost webpage?
 * - Pairing code default for VPS, QR default for Mac? Or always offer both?
 * - Do we want OpenClaw's pattern of separate `wacli` skill, or embed the
 *   confirmed-outbound tool directly in the WhatsApp plugin? Embedded is
 *   simpler (one fewer install step), separate is what OpenClaw chose.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
// import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// import {
//   makeWASocket,
//   useMultiFileAuthState,
//   DisconnectReason,
//   makeCacheableSignalKeyStore,
// } from "@whiskeysockets/baileys";
// import qrcodeTerminal from "qrcode-terminal";

const STATE_DIR_DEFAULT = "~/.claude/channels/whatsapp/<accountId>";

/* Placeholder — real implementation comes in next sessions. */
const server = new Server(
  { name: "whatsapp", version: "0.0.1" },
  { capabilities: { tools: {} } }
);

process.stderr.write(
  "whatsapp channel: WIP scaffolding — plugin not yet functional.\n" +
    "  See plugins/whatsapp/README.md for the implementation plan.\n" +
    `  State dir target: ${STATE_DIR_DEFAULT}\n`
);
process.exit(1);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _unused = server;
