#!/usr/bin/env node
// Sentō — reply-delivery enforcer (Stop hook).
//
// THE BUG THIS EXISTS FOR:
// The channel plugins deliver a message ONLY when the agent calls the `reply` tool.
// Text the agent *writes* is not sent anywhere — it prints to a tmux pane nobody is
// watching. So an agent can be alive, correct, and reasoning perfectly, "answer" a
// question by writing the answer, and the human sees SILENCE and concludes it's dead.
// It is invisible from both ends: the human sees no reply, the agent believes it spoke.
//
// We first "fixed" this with an instruction in CLAUDE.md. But an instruction is a rule
// someone has to REMEMBER — which is the exact failure class as every other bug in this
// system (an env var nobody set, a council nobody designated, a ledger nobody logged).
// A rule that depends on memory is a better-odds bet, not a guarantee.
//
// This hook makes forgetting IMPOSSIBLE. It blocks the stop and hands the reason back
// to the model, so the agent cannot finish its turn until the message is actually sent.
//
// SAFETY — why this can't break the silent dream:
// It only fires when a human is genuinely waiting, detected by the `<channel ...>`
// marker on the triggering user turn. The nightly dream and cron tasks have no such
// marker (they're injected locally and are SILENT by design), so they are never blocked.

const fs = require("fs");

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let payload = {};
  try { payload = JSON.parse(raw); } catch { process.exit(0); }

  // Loop guard: if we already blocked once this turn, let the agent stop.
  if (payload.stop_hook_active) process.exit(0);

  const tp = payload.transcript_path;
  if (!tp || !fs.existsSync(tp)) process.exit(0);

  let rows;
  try {
    rows = fs.readFileSync(tp, "utf8").split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { process.exit(0); }

  let calledReply = false;
  let wroteText = false;
  let chatId = null;

  // Walk backwards to the user turn that started this exchange.
  for (let i = rows.length - 1; i >= 0; i--) {
    const msg = rows[i].message;
    if (!msg) continue;

    if (msg.role === "assistant") {
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      for (const b of blocks) {
        if (b.type === "tool_use" && /__reply$/.test(b.name || "")) calledReply = true;
        if (b.type === "text" && (b.text || "").trim().length > 0) wroteText = true;
      }
      continue;
    }

    if (msg.role === "user") {
      // Is this turn from a human on a channel? Tool RESULTS are also role:user — skip those.
      const s = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content || "");
      if (/"type":"tool_result"|tool_result/.test(s)) continue;
      const m = s.match(/<channel[^>]*chat_id=\\?"(\d+)\\?"/);
      if (m) chatId = m[1];
      break; // reached the start of this turn either way
    }
  }

  // A human is waiting, the agent produced words, and it never actually spoke them.
  if (chatId && wroteText && !calledReply) {
    process.stderr.write(
      "STOP BLOCKED — you never called the `reply` tool, so NOTHING you just wrote was delivered.\n\n" +
      "Your text went to a terminal nobody is watching. The person who messaged you is looking at " +
      "silence right now and will conclude you are broken.\n\n" +
      "Call `mcp__plugin_discord_discord__reply` with chat_id=\"" + chatId + "\" and your answer as `text`. Do it now, then finish.\n\n" +
      "Thinking is free. Speaking costs a tool call. If you did not call `reply`, you did not speak."
    );
    process.exit(2); // exit 2 = block the stop; stderr is fed back to the model
  }

  process.exit(0);
});
