#!/usr/bin/env bun
/**
 * LINE channel for Claude Code.
 *
 * Runs an MCP server (stdio) for Claude Code's tool calls + a Hono HTTP
 * server that receives LINE's webhook POSTs. Inbound messages get buffered
 * to ~/.claude/channels/line/inbox/ as JSON files; Claude reads them via
 * the `list_unread` tool and replies via `send_message`.
 *
 * Access control mirrors the discord plugin's pattern:
 *   - dmPolicy: "pairing" (default) — unknown senders get a 6-char code,
 *     owner approves via /line:access skill, then sender lands in allowFrom
 *   - dmPolicy: "allowlist" — only listed user IDs can talk to the agent
 *   - dmPolicy: "open" — anyone who finds the webhook URL can talk
 *   - dmPolicy: "disabled" — channel is up but rejects all inbound
 *
 * Mention gating in groups/rooms:
 *   - 1:1 chats (source.type === "user") always trigger
 *   - groups/rooms require either:
 *     a) bot is mentioned via LINE's mention.mentionees containing botUserId
 *     b) the owner approves the group's `requireMention: false` policy
 *
 * Reply-token expiry fallback:
 *   LINE reply tokens die ~30s after receipt. send_message tries reply
 *   first; on 400/401 from the reply API it falls back to push and logs
 *   a stderr warning so the user knows their free quota was eaten.
 *
 * State layout:
 *   ~/.claude/channels/line/
 *   ├── .env                LINE_CHANNEL_TOKEN, LINE_CHANNEL_SECRET, LINE_WEBHOOK_PORT
 *   ├── access.json         dmPolicy, allowFrom, groups, pending, mentionPatterns
 *   ├── approved/           channel-server polls to send "you're in" confirms
 *   └── inbox/              <ts>-<uid>.json — pending inbound message envelopes
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
import { randomBytes } from "crypto";

/* ----------------------------------------------------------------------- */
/* State paths + env                                                       */
/* ----------------------------------------------------------------------- */

const STATE_DIR =
  process.env.LINE_STATE_DIR ?? join(homedir(), ".claude", "channels", "line");
const ACCESS_FILE = join(STATE_DIR, "access.json");
const INBOX_DIR = join(STATE_DIR, "inbox");
const APPROVED_DIR = join(STATE_DIR, "approved");
const ENV_FILE = join(STATE_DIR, ".env");

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
const STATIC = process.env.LINE_ACCESS_MODE === "static";

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
mkdirSync(APPROVED_DIR, { recursive: true, mode: 0o700 });

/* ----------------------------------------------------------------------- */
/* Access control                                                          */
/* ----------------------------------------------------------------------- */

type PendingEntry = {
  senderId: string;
  /** LINE source ID — could be user, group, or room. Where to send confirms. */
  chatId: string;
  createdAt: number;
  expiresAt: number;
};

type GroupPolicy = {
  requireMention: boolean;
  allowFrom: string[];
};

type Access = {
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled";
  allowFrom: string[];
  /** Keyed on group/room ID. */
  groups: Record<string, GroupPolicy>;
  pending: Record<string, PendingEntry>;
  /** Optional regexes to match in group messages instead of LINE's mentionees. */
  mentionPatterns?: string[];
};

function defaultAccess(): Access {
  return { dmPolicy: "pairing", allowFrom: [], groups: {}, pending: {} };
}

function readAccessFile(): Access {
  try {
    const raw = readFileSync(ACCESS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<Access>;
    return {
      dmPolicy: parsed.dmPolicy ?? "pairing",
      allowFrom: parsed.allowFrom ?? [],
      groups: parsed.groups ?? {},
      pending: parsed.pending ?? {},
      mentionPatterns: parsed.mentionPatterns,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return defaultAccess();
    try {
      renameSync(ACCESS_FILE, `${ACCESS_FILE}.corrupt-${Date.now()}`);
    } catch {
      /* ignore */
    }
    process.stderr.write(
      `line channel: access.json corrupt, moved aside. Starting from defaults (pairing mode).\n`
    );
    return defaultAccess();
  }
}

// In static mode, access is snapshotted at boot — pairing requires runtime
// mutation, so it's downgraded to allowlist with a warning.
const BOOT_ACCESS: Access | null = STATIC
  ? (() => {
      const a = readAccessFile();
      if (a.dmPolicy === "pairing") {
        process.stderr.write(
          `line channel: static mode — dmPolicy "pairing" downgraded to "allowlist"\n`
        );
        a.dmPolicy = "allowlist";
      }
      a.pending = {};
      return a;
    })()
  : null;

function loadAccess(): Access {
  return BOOT_ACCESS ?? readAccessFile();
}

function saveAccess(a: Access): void {
  if (STATIC) return;
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const tmp = ACCESS_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(a, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, ACCESS_FILE);
}

const PAIRING_TTL_MS = 10 * 60_000; // 10 minutes
const PAIRING_CODE_ALPHABET = "abcdefghijkmnopqrstuvwxyz"; // no 'l' (looks like 1)
const PAIRING_CODE_LEN = 5;

function newPairingCode(): string {
  const bytes = randomBytes(PAIRING_CODE_LEN);
  let out = "";
  for (let i = 0; i < PAIRING_CODE_LEN; i++) {
    out += PAIRING_CODE_ALPHABET[bytes[i] % PAIRING_CODE_ALPHABET.length];
  }
  return out;
}

function pruneExpired(a: Access): boolean {
  const now = Date.now();
  let changed = false;
  for (const [code, p] of Object.entries(a.pending)) {
    if (p.expiresAt < now) {
      delete a.pending[code];
      changed = true;
    }
  }
  return changed;
}

/** Emit a pairing code for an unknown sender, persist to access.json. */
function issuePairingCode(senderId: string, chatId: string): string {
  const a = loadAccess();
  pruneExpired(a);
  // Reuse an existing code if this sender already has a pending pairing,
  // so spamming the bot doesn't create N codes for the same person.
  for (const [code, p] of Object.entries(a.pending)) {
    if (p.senderId === senderId) return code;
  }
  let code = newPairingCode();
  while (a.pending[code]) code = newPairingCode();
  const now = Date.now();
  a.pending[code] = {
    senderId,
    chatId,
    createdAt: now,
    expiresAt: now + PAIRING_TTL_MS,
  };
  saveAccess(a);
  return code;
}

/* ----------------------------------------------------------------------- */
/* Inbox — inbound messages buffered to disk                               */
/* ----------------------------------------------------------------------- */

type InboundMessage = {
  ts: number;
  source: { userId: string; type: "user" | "group" | "room"; sourceId: string };
  /** LINE's reply token, valid for ~30 seconds. */
  replyToken: string;
  text: string;
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

async function sendText(toId: string, text: string): Promise<void> {
  await lineClient.pushMessage({
    to: toId,
    messages: [{ type: "text", text }],
  });
}

/**
 * Reply via free-quota reply API, falling back to push if the reply token
 * has expired. LINE returns 400 with a specific error for expired tokens —
 * we don't try to distinguish, just push and stderr-warn.
 */
async function replyOrPush(
  replyToken: string,
  fallbackToId: string,
  text: string
): Promise<{ via: "reply" | "push"; warning?: string }> {
  try {
    await lineClient.replyMessage({
      replyToken,
      messages: [{ type: "text", text }],
    });
    return { via: "reply" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `line channel: reply failed (${msg}); falling back to push (eats quota)\n`
    );
    await sendText(fallbackToId, text);
    return {
      via: "push",
      warning: `reply token expired or invalid (${msg}); used push instead`,
    };
  }
}

/* ----------------------------------------------------------------------- */
/* Approved-pairings poller — sends "you're in" confirms                   */
/* ----------------------------------------------------------------------- */

// /line:access drops files in APPROVED_DIR named <senderId> with the chatId
// as contents. We poll, send the confirm, and delete the file.
setInterval(() => {
  let files: string[] = [];
  try {
    files = readdirSync(APPROVED_DIR);
  } catch {
    return;
  }
  for (const f of files) {
    const senderId = f;
    let chatId: string;
    try {
      chatId = readFileSync(join(APPROVED_DIR, f), "utf8").trim();
    } catch {
      continue;
    }
    if (!chatId) continue;
    sendText(chatId, "you're paired — say something to get started")
      .then(() => {
        try {
          unlinkSync(join(APPROVED_DIR, f));
        } catch {
          /* ignore */
        }
      })
      .catch((err) => {
        process.stderr.write(
          `line channel: failed to send pairing confirm to ${senderId}: ${err}\n`
        );
      });
  }
}, 5_000).unref();

/* ----------------------------------------------------------------------- */
/* Mention gating                                                          */
/* ----------------------------------------------------------------------- */

let cachedBotUserId: string | null = null;

async function getBotUserId(): Promise<string | null> {
  if (cachedBotUserId) return cachedBotUserId;
  try {
    const info = await lineClient.getBotInfo();
    cachedBotUserId = info.userId;
    return cachedBotUserId;
  } catch (err) {
    process.stderr.write(
      `line channel: getBotInfo failed: ${err}. Mention gating may be loose.\n`
    );
    return null;
  }
}

/**
 * Returns true if the message in a group/room counts as "for the bot".
 * - mentionees array contains the bot's userId, OR
 * - any of the configured mentionPatterns matches the text body.
 */
function isMentioned(
  message: { text?: string; mention?: { mentionees?: Array<{ userId?: string; type?: string }> } },
  botUserId: string | null,
  mentionPatterns: string[] | undefined
): boolean {
  const mentionees = message.mention?.mentionees ?? [];
  if (botUserId && mentionees.some((m) => m.userId === botUserId)) return true;
  if (mentionees.some((m) => m.type === "all")) return true;
  if (message.text && mentionPatterns) {
    for (const pattern of mentionPatterns) {
      try {
        if (new RegExp(pattern, "i").test(message.text)) return true;
      } catch {
        /* invalid pattern, skip */
      }
    }
  }
  return false;
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

  // Resolve bot userId once per batch — it's needed for mention gating in groups
  const botUserId = await getBotUserId();

  for (const event of parsed.events ?? []) {
    if (event.type !== "message") continue;
    const message = event.message as {
      type: string;
      text?: string;
      mention?: { mentionees?: Array<{ userId?: string; type?: string }> };
    };
    if (message.type !== "text") continue;

    const source = event.source as {
      type: "user" | "group" | "room";
      userId?: string;
      groupId?: string;
      roomId?: string;
    };
    if (!source.userId) continue;

    const access = loadAccess();
    const chatId = source.groupId ?? source.roomId ?? source.userId;
    const replyToken = event.replyToken as string;

    // Access policy
    if (access.dmPolicy === "disabled") continue;

    if (access.dmPolicy === "pairing") {
      if (!access.allowFrom.includes(source.userId)) {
        // Issue pairing code, reply with instructions, drop the message
        const code = issuePairingCode(source.userId, chatId);
        try {
          await lineClient.replyMessage({
            replyToken,
            messages: [
              {
                type: "text",
                text:
                  `Hi! To chat with this agent, ask the owner to run:\n` +
                  `  /line:access pair ${code}\n\n` +
                  `(code expires in 10 minutes)`,
              },
            ],
          });
        } catch (err) {
          process.stderr.write(`line channel: pairing reply failed: ${err}\n`);
        }
        continue;
      }
    }

    if (access.dmPolicy === "allowlist") {
      if (!access.allowFrom.includes(source.userId)) continue;
    }

    // Group/room mention gating
    if (source.type !== "user") {
      const groupPolicy = access.groups[chatId];
      const requireMention = groupPolicy?.requireMention ?? true;
      if (requireMention && !isMentioned(message, botUserId, access.mentionPatterns)) {
        continue;
      }
      // Per-group allowFrom (independent of top-level allowFrom)
      if (groupPolicy?.allowFrom?.length && !groupPolicy.allowFrom.includes(source.userId)) {
        continue;
      }
    }

    writeInbox({
      ts: Date.now(),
      source: {
        userId: source.userId,
        type: source.type,
        sourceId: chatId,
      },
      replyToken,
      text: message.text ?? "",
      raw: event,
    });
  }

  return c.text("ok");
});

app.get("/line/health", (c) => c.json({ status: "ok", port: WEBHOOK_PORT }));

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
        "List unread inbound LINE messages from the inbox. Returns oldest-first " +
        "with sender info, text, and reply token (valid ~30s after receipt).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "send_message",
      description:
        "Send a LINE text message. Pass `reply_token` (free, ~30s window) OR " +
        "`to_id` (push, counts against quota). On reply-token expiry, falls back " +
        "to push automatically and returns a warning.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Message body (max 5000 chars)" },
          reply_token: {
            type: "string",
            description: "From an inbox message — preferred. Expires ~30s after receipt.",
          },
          to_id: {
            type: "string",
            description:
              "User ID, group ID, or room ID to push to. Required if no reply_token.",
          },
          clear_from_inbox: {
            type: "object",
            description: "Optional — pass {ts, user_id} from an inbox message to mark processed.",
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
      content: [{ type: "text", text: JSON.stringify(messages, null, 2) }],
    };
  }

  if (name === "send_message") {
    const a = args as {
      text: string;
      reply_token?: string;
      to_id?: string;
      clear_from_inbox?: { ts: number; user_id: string };
    };
    if (!a.reply_token && !a.to_id) {
      throw new Error("send_message requires either reply_token or to_id");
    }

    let result: { via: "reply" | "push"; warning?: string };
    if (a.reply_token && a.to_id) {
      result = await replyOrPush(a.reply_token, a.to_id, a.text);
    } else if (a.reply_token) {
      // Without a fallback ID we can't gracefully recover from token expiry —
      // surface the error so Claude can re-fetch the inbox and try push next time
      try {
        await lineClient.replyMessage({
          replyToken: a.reply_token,
          messages: [{ type: "text", text: a.text }],
        });
        result = { via: "reply" };
      } catch (err) {
        throw new Error(
          `reply failed (${err}). Pass to_id alongside reply_token to enable push fallback.`
        );
      }
    } else if (a.to_id) {
      await sendText(a.to_id, a.text);
      result = { via: "push" };
    } else {
      throw new Error("unreachable");
    }

    if (a.clear_from_inbox) {
      clearInboxItem(a.clear_from_inbox.ts, a.clear_from_inbox.user_id);
    }

    return {
      content: [
        {
          type: "text",
          text: result.warning
            ? `sent via ${result.via} (warning: ${result.warning})`
            : `sent via ${result.via}`,
        },
      ],
    };
  }

  if (name === "clear_inbox_item") {
    const a = args as { ts: number; user_id: string };
    clearInboxItem(a.ts, a.user_id);
    return { content: [{ type: "text", text: "cleared" }] };
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);

process.stderr.write("line channel: MCP server ready on stdio\n");

/* ----------------------------------------------------------------------- */
/* Process lifecycle                                                       */
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
