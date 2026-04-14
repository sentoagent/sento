#!/usr/bin/env bun
/**
 * LINE channel for Claude Code.
 *
 * WIP — scaffolding only. Not functional yet.
 *
 * Architecture plan (mirrors the discord plugin in claude-plugins-official):
 * - MCP server over stdio transport, exposes tools: fetch_messages, send_message,
 *   react, typing_indicator.
 * - Long-running Hono HTTP server listens on $LINE_WEBHOOK_PORT for LINE's POST
 *   webhooks. Inbound events get buffered to ~/.claude/channels/line/inbox/.
 * - State dir: ~/.claude/channels/line/
 *   ├── .env           (LINE_CHANNEL_TOKEN, LINE_CHANNEL_SECRET, webhook port)
 *   ├── access.json    (allowFrom, dmPolicy — same shape as discord)
 *   └── inbox/         (pending messages)
 *
 * Setup UX (during `npx sentoagent init`):
 * 1. User creates a LINE channel at developers.line.biz, gets token + secret
 * 2. Sentō prints their webhook URL (e.g. https://their-vps.com/line/webhook)
 * 3. User pastes that URL into the LINE console
 * 4. First message from user = pairing exchange, same as discord
 *
 * Webhook-vs-long-poll: LINE only does webhooks, so the host must be publicly
 * reachable. On a VPS with a domain + reverse proxy, trivial. For local Mac
 * installs, doc a ngrok/Cloudflare Tunnel setup or recommend VPS.
 *
 * Open questions for next session:
 * - Reuse discord's access.json shape verbatim, or fork? Probably reuse.
 * - Pairing flow: same pairing code pattern as discord, or LINE-specific?
 * - LINE Flex Messages for rich output? Plain text first, Flex later.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
// import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// import { messagingApi } from "@line/bot-sdk";
// import { Hono } from "hono";

const STATE_DIR_DEFAULT = "~/.claude/channels/line";

/* Placeholder — real implementation comes in next session. */
const server = new Server(
  { name: "line", version: "0.0.1" },
  { capabilities: { tools: {} } }
);

process.stderr.write(
  "line channel: WIP scaffolding — plugin not yet functional.\n" +
    "  See plugins/line/README.md for the implementation plan.\n" +
    `  State dir target: ${STATE_DIR_DEFAULT}\n`
);
process.exit(1);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _unused = server;
