#!/usr/bin/env bun
/**
 * LINE channel for Claude Code.
 *
 * Runs an MCP server (stdio) for Claude Code's tool calls + a Hono HTTP
 * server that receives LINE's webhook POSTs. Inbound messages get buffered
 * to ~/.claude/channels/line/inbox/ as JSON files; Claude reads them via
 * the `list_unread` tool and replies via `send_message`.
 *
 * Status: foundation. Functional for basic send/receive against a real
 * LINE Messaging API channel. Pairing flow + allowlist gating + mention
 * triggering land in a follow-up commit.
 *
 * State layout:
 *   ~/.claude/channels/line/
 *   ├── .env                    LINE_CHANNEL_TOKEN, LINE_CHANNEL_SECRET, LINE_WEBHOOK_PORT
 *   ├── access.json             allowFrom, dmPolicy, mentionPatterns
 *   └── inbox/
 *       └── <timestamp>.json    pending inbound message envelopes
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { messagingApi, validateSignature } from "@line/bot-sdk";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  chmodSync,
  renameSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";

/* ----------------------------------------------------------------------- */
/* State paths + env                                                       */
/* ----------------------------------------------------------------------- */

const STATE_DIR =
  process.env.LINE_STATE_DIR ?? join(homedir(), ".claude", "channels", "line");
const ACCESS_FILE = join(STATE_DIR, "access.json");
const INBOX_DIR = join(STATE_DIR, "inbox");
const ENV_FILE = join(STATE_DIR, ".env");

// Load the channel's .env into process.env so the plugin can pick up
// LINE_CHANNEL_TOKEN / LINE_CHANNEL_SECRET / LINE_WEBHOOK_PORT. Real env
// wins over the file (so users can override per-launch).
try {
  chmodSync(ENV_FILE, 0o600);
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {
  /* .env may not exist yet during first install — handled below */
}

const TOKEN = process.env.LINE_CHANNEL_TOKEN;
const SECRET = process.env.LINE_CHANNEL_SECRET;
const WEBHOOK_PORT = Number(process.env.LINE_WEBHOOK_PORT ?? 8765);

if (!TOKEN || !SECRET) {
  process.stderr.write(
    `line channel: LINE_CHANNEL_TOKEN and LINE_CHANNEL_SECRET required\n` +
      `  set in ${ENV_FILE}\n` +
      `  format:\n` +
      `    LINE_CHANNEL_TOKEN=...\n` +
      `    LINE_CHANNEL_SECRET=...\n` +
      `    LINE_WEBHOOK_PORT=8765   # optional, defaults to 8765\n`
  );
  process.exit(1);
}

mkdirSync(INBOX_DIR, { recursive: true, mode: 0o700 });

/* ----------------------------------------------------------------------- */
/* Access control (minimal — full pairing flow lands next session)         */
/* ----------------------------------------------------------------------- */

type Access = {
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled";
  /** LINE user IDs (Uxxxx... format) authorized to message the agent. */
  allowFrom: string[];
};

function defaultAccess(): Access {
  return { dmPolicy: "open", allowFrom: [] };
}

function loadAccess(): Access {
  try {
    const raw = readFileSync(ACCESS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<Access>;
    return {
      dmPolicy: parsed.dmPolicy ?? "open",
      allowFrom: parsed.allowFrom ?? [],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return defaultAccess();
    // Don't crash on a corrupt file — move it aside and start fresh.
    try {
      renameSync(ACCESS_FILE, `${ACCESS_FILE}.corrupt-${Date.now()}`);
    } catch {
      /* ignore */
    }
    process.stderr.write(
      `line channel: access.json corrupt, moved aside. Starting open.\n`
    );
    return defaultAccess();
  }
}

function isAllowed(senderUserId: string): boolean {
  const access = loadAccess();
  if (access.dmPolicy === "disabled") return false;
  if (access.dmPolicy === "open") return true;
  return access.allowFrom.includes(senderUserId);
}

/* ----------------------------------------------------------------------- */
/* Inbox — inbound messages buffered to disk                               */
/* ----------------------------------------------------------------------- */

type InboundMessage = {
  /** Monotonic timestamp at write time, also used for the filename */
  ts: number;
  source: { userId: string; type: "user" | "group" | "room"; sourceId: string };
  /** LINE's reply token, valid for ~30 seconds */
  replyToken: string;
  text: string;
  /** Original LINE event for tools that want full fidelity */
  raw: unknown;
};

function writeInbox(msg: InboundMessage): void {
  const file = join(INBOX_DIR, `${msg.ts}-${msg.source.userId.slice(0, 8)}.json`);
  writeFileSync(file, JSON.stringify(msg, null, 2), { mode: 0o600 });
}

function listInbox(): InboundMessage[] {
  return readdirSync(INBOX_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(INBOX_DIR, f), "utf8")) as InboundMessage;
      } catch {
        return null;
      }
    })
    .filter((m): m is InboundMessage => m !== null)
    .sort((a, b) => a.ts - b.ts);
}

function clearInboxItem(ts: number, userId: string): void {
  const file = join(INBOX_DIR, `${ts}-${userId.slice(0, 8)}.json`);
  try {
    unlinkSync(file);
  } catch {
    /* already gone */
  }
}

/* ----------------------------------------------------------------------- */
/* LINE client (outbound)                                                  */
/* ----------------------------------------------------------------------- */

const lineClient = new messagingApi.MessagingApiClient({
  channelAccessToken: TOKEN,
});

async function sendText(toUserId: string, text: string): Promise<void> {
  await lineClient.pushMessage({
    to: toUserId,
    messages: [{ type: "text", text }],
  });
}

async function replyText(replyToken: string, text: string): Promise<void> {
  await lineClient.replyMessage({
    replyToken,
    messages: [{ type: "text", text }],
  });
}

/* ----------------------------------------------------------------------- */
/* Hono webhook receiver                                                   */
/* ----------------------------------------------------------------------- */

const app = new Hono();

app.post("/line/webhook", async (c) => {
  const signature = c.req.header("x-line-signature") ?? "";
  const body = await c.req.text();

  if (!validateSignature(body, SECRET, signature)) {
    return c.text("Invalid signature", 401);
  }

  let parsed: { events: Array<Record<string, unknown>> };
  try {
    parsed = JSON.parse(body);
  } catch {
    return c.text("Invalid JSON", 400);
  }

  for (const event of parsed.events ?? []) {
    if (event.type !== "message") continue;
    const message = event.message as { type: string; text?: string };
    if (message.type !== "text") continue;

    const source = event.source as {
      type: "user" | "group" | "room";
      userId: string;
      groupId?: string;
      roomId?: string;
    };

    if (!source.userId) continue;
    if (!isAllowed(source.userId)) {
      // Drop silently for now. Pairing flow will hook in here next session
      // to send a "to chat with this agent, ask the owner to pair you" reply.
      continue;
    }

    writeInbox({
      ts: Date.now(),
      source: {
        userId: source.userId,
        type: source.type,
        sourceId: source.groupId ?? source.roomId ?? source.userId,
      },
      replyToken: event.replyToken as string,
      text: message.text ?? "",
      raw: event,
    });
  }

  return c.text("ok");
});

serve({ fetch: app.fetch, port: WEBHOOK_PORT }, (info) => {
  process.stderr.write(
    `line channel: webhook listening on http://0.0.0.0:${info.port}/line/webhook\n` +
      `  point your LINE Channel webhook URL at: https://<your-host>/line/webhook\n`
  );
});

/* ----------------------------------------------------------------------- */
/* MCP server                                                              */
/* ----------------------------------------------------------------------- */

const server = new Server(
  { name: "line", version: "0.0.1" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_unread",
      description:
        "List unread inbound LINE messages waiting in the inbox. Returns messages oldest-first with sender info, text, and the reply token (valid ~30s).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "send_message",
      description:
        "Send a LINE text message to a user. Use 'reply_token' for replies within ~30s of receipt (free); use 'to_user_id' for proactive messages (counts against your monthly LINE quota). Pass exactly one.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Message body (max 5000 chars)" },
          reply_token: {
            type: "string",
            description:
              "From an inbox message — preferred, free of quota. Expires ~30s after receipt.",
          },
          to_user_id: {
            type: "string",
            description:
              "LINE user ID (Uxxxx...) for proactive push. Uses your push quota.",
          },
          clear_from_inbox: {
            type: "object",
            description:
              "Optional — pass {ts, user_id} from an inbox message to mark it processed.",
            properties: {
              ts: { type: "number" },
              user_id: { type: "string" },
            },
            additionalProperties: false,
          },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
    {
      name: "clear_inbox_item",
      description: "Mark an inbox message as processed — deletes the file from the inbox.",
      inputSchema: {
        type: "object",
        properties: {
          ts: { type: "number" },
          user_id: { type: "string" },
        },
        required: ["ts", "user_id"],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "list_unread") {
    const messages = listInbox();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(messages, null, 2),
        },
      ],
    };
  }

  if (name === "send_message") {
    const a = args as {
      text: string;
      reply_token?: string;
      to_user_id?: string;
      clear_from_inbox?: { ts: number; user_id: string };
    };
    if (!a.reply_token && !a.to_user_id) {
      throw new Error("send_message requires either reply_token or to_user_id");
    }
    if (a.reply_token && a.to_user_id) {
      throw new Error("send_message: pass reply_token OR to_user_id, not both");
    }

    if (a.reply_token) {
      await replyText(a.reply_token, a.text);
    } else if (a.to_user_id) {
      await sendText(a.to_user_id, a.text);
    }

    if (a.clear_from_inbox) {
      clearInboxItem(a.clear_from_inbox.ts, a.clear_from_inbox.user_id);
    }

    return {
      content: [{ type: "text", text: "sent" }],
    };
  }

  if (name === "clear_inbox_item") {
    const a = args as { ts: number; user_id: string };
    clearInboxItem(a.ts, a.user_id);
    return {
      content: [{ type: "text", text: "cleared" }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);

process.stderr.write("line channel: MCP server ready on stdio\n");

/* ----------------------------------------------------------------------- */
/* Graceful shutdown                                                       */
/* ----------------------------------------------------------------------- */

process.on("SIGINT", () => {
  process.stderr.write("line channel: SIGINT received, shutting down\n");
  process.exit(0);
});

process.on("SIGTERM", () => {
  process.stderr.write("line channel: SIGTERM received, shutting down\n");
  process.exit(0);
});

process.on("unhandledRejection", (err) => {
  process.stderr.write(`line channel: unhandled rejection: ${err}\n`);
});

process.on("uncaughtException", (err) => {
  process.stderr.write(`line channel: uncaught exception: ${err}\n`);
});
