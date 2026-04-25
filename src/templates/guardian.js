export function renderGuardian(config) {
  const startScript = config.agentName === "blair" ? "start-blair.sh" : "start-agent.sh";

  return `#!/usr/bin/env node
// Sentō Guardian — Unkillable agent monitor
// Zero tokens. Zero AI. Monitors health, auto-restarts, multi-channel communication.

import { execFileSync } from 'child_process';
import https from 'https';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';

const SESSION = '${config.agentName}';
const HOME = process.env.HOME;
const START = HOME + '/workspace/${startScript}';
const LOG = HOME + '/workspace/memory/guardian.log';
const STATE = '/tmp/sento-guardian-' + SESSION + '.json';
const MAX = 3;

// ─── Config loading (must be before detectChannel) ───
const CONFIG_PATH = HOME + '/workspace/.sento-config.json';
let _configCache = {};
let _configLastLoad = 0;
function loadSentoConfig() {
  try { _configCache = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch {}
  _configLastLoad = Date.now();
  return _configCache;
}
function getSentoConfig() { return _configCache; }
loadSentoConfig();

// ─── Channel Abstraction ───
// Guardian works with any channel: Discord, Telegram, Slack, iMessage.
// It detects which channel is active and uses the correct API.

function detectChannel() {
  const cfg = getSentoConfig();
  const channelType = cfg.channelType || null;
  const channelsDir = HOME + '/.claude/channels';

  // Try configured type first, then scan for any active channel
  const types = channelType ? [channelType, 'discord', 'telegram', 'slack'] : ['discord', 'telegram', 'slack'];
  for (const t of [...new Set(types)]) {
    const envPath = channelsDir + '/' + t + '/.env';
    if (!fs.existsSync(envPath)) continue;
    const env = fs.readFileSync(envPath, 'utf-8');

    if (t === 'discord') {
      const m = env.match(/DISCORD_BOT_TOKEN=(.*)/);
      if (m) return { type: 'discord', token: m[1].trim(), monitorId: cfg.monitorChannel || cfg.monitorChatId || '' , webhook: cfg.discordWebhook || '' };
    }
    if (t === 'telegram') {
      const m = env.match(/TELEGRAM_BOT_TOKEN=(.*)/);
      if (m) return { type: 'telegram', token: m[1].trim(), monitorId: cfg.monitorChatId || '' };
    }
    if (t === 'slack') {
      const m = env.match(/SLACK_BOT_TOKEN=(.*)/);
      if (m) return { type: 'slack', token: m[1].trim(), monitorId: cfg.monitorChatId || '' };
    }
  }
  return { type: null, token: '', monitorId: '' };
}

let CHANNEL = detectChannel();

// ─── Send notification (works on any channel) ───
function notify(msg) {
  if (!CHANNEL.type) return;
  try {
    if (CHANNEL.type === 'discord' && CHANNEL.webhook) {
      const u = new URL(CHANNEL.webhook);
      const d = JSON.stringify({ content: msg, username: 'Sento Guardian' });
      const r = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': d.length } });
      r.write(d); r.end();
    } else if (CHANNEL.type === 'telegram' && CHANNEL.monitorId) {
      const d = JSON.stringify({ chat_id: CHANNEL.monitorId, text: msg, parse_mode: 'Markdown' });
      const r = https.request({ hostname: 'api.telegram.org', path: '/bot' + CHANNEL.token + '/sendMessage', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } });
      r.write(d); r.end();
    } else if (CHANNEL.type === 'slack' && CHANNEL.monitorId) {
      const d = JSON.stringify({ channel: CHANNEL.monitorId, text: msg });
      const r = https.request({ hostname: 'slack.com', path: '/api/chat.postMessage', method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CHANNEL.token, 'Content-Length': Buffer.byteLength(d) } });
      r.write(d); r.end();
    }
  } catch {}
}

// ─── Read recent commands from channel ───
async function readCommands() {
  if (!CHANNEL.type || !CHANNEL.token || !CHANNEL.monitorId) return [];
  try {
    if (CHANNEL.type === 'discord') {
      const r = await fetch('https://discord.com/api/v10/channels/' + CHANNEL.monitorId + '/messages?limit=5', { headers: { Authorization: 'Bot ' + CHANNEL.token } });
      if (!r.ok) return [];
      const msgs = await r.json();
      return msgs.filter(m => !m.author.bot && Date.now() - new Date(m.timestamp).getTime() < 120000).map(m => m.content.toLowerCase().trim());
    }
    if (CHANNEL.type === 'telegram') {
      const r = await fetch('https://api.telegram.org/bot' + CHANNEL.token + '/getUpdates?offset=-5&timeout=0');
      if (!r.ok) return [];
      const data = await r.json();
      if (!data.ok) return [];
      return (data.result || []).filter(u => u.message && u.message.chat && String(u.message.chat.id) === String(CHANNEL.monitorId) && Date.now() - u.message.date * 1000 < 120000).map(u => (u.message.text || '').toLowerCase().trim());
    }
    if (CHANNEL.type === 'slack') {
      const r = await fetch('https://slack.com/api/conversations.history?channel=' + CHANNEL.monitorId + '&limit=5', { headers: { Authorization: 'Bearer ' + CHANNEL.token } });
      if (!r.ok) return [];
      const data = await r.json();
      if (!data.ok) return [];
      return (data.messages || []).filter(m => !m.bot_id && Date.now() - parseFloat(m.ts) * 1000 < 120000).map(m => (m.text || '').toLowerCase().trim());
    }
  } catch {}
  return [];
}

// ─── Core functions ───
function log(m) { try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + m + '\\n'); } catch {} }
function ld() { try { return JSON.parse(fs.readFileSync(STATE, 'utf-8')); } catch { return { restarts: [], status: 'ok', failCount: 0 }; } }
function sv(s) { try { fs.writeFileSync(STATE, JSON.stringify(s)); } catch {} }
function tm(n = 30) { try { return execFileSync('tmux', ['capture-pane', '-t', SESSION, '-p', '-S', '-' + n], { encoding: 'utf-8', timeout: 5000 }); } catch { return null; } }
function alive() { try { return execFileSync('tmux', ['ls'], { encoding: 'utf-8', timeout: 5000 }).includes(SESSION); } catch { return false; } }

// ─── Post-restart /loop nudge ───
// /loop scheduled tasks die when the Claude session restarts. CLAUDE.md is passive
// context so the agent won't re-create them on its own. This function injects a
// single prompt once, after the session confirms it's listening for channel messages.
function sendPostRestartNudge() {
  const msg = 'Session just started. Re-establish your /loop scheduled tasks from the Scheduled Tasks section of your CLAUDE.md now. Cancel any existing duplicate loops first. If you have no Scheduled Tasks section, reply briefly and do nothing.';
  try {
    // Claude Code TUI consumes the first Enter after a typed line as a newline
    // inside its multiline input; a second Enter is needed to submit. Without
    // the second Enter the prompt sits in the buffer and stacks on next nudge.
    execFileSync('tmux', ['send-keys', '-t', SESSION, msg, 'Enter', 'Enter'], { timeout: 5000 });
    log('Sent post-restart /loop nudge');
  } catch (e) { log('Nudge send failed: ' + e.message); }
}

// ─── Discord patch management ───
function checkAndReapplyPatches() {
  try {
    const cacheDir = HOME + '/.claude/plugins/cache/claude-plugins-official/discord';
    if (!fs.existsSync(cacheDir)) return;
    const versions = fs.readdirSync(cacheDir);
    for (const ver of versions) {
      const serverTs = cacheDir + '/' + ver + '/server.ts';
      if (!fs.existsSync(serverTs)) continue;
      let content = fs.readFileSync(serverTs, 'utf-8');
      let patched = false;

      const guildTarget = "const policy = access.groups[channelId]";
      const guildReplace = "const policy = access.groups[channelId] || (msg.guildId ? access.groups[msg.guildId] : undefined)";
      if (content.includes(guildTarget) && !content.includes('msg.guildId ? access.groups[msg.guildId]')) {
        content = content.replace(guildTarget, guildReplace);
        patched = true;
      }

      const replyTarget = "if (key in access.groups) return ch";
      const replyReplace = "if (key in access.groups || (ch.guildId && ch.guildId in access.groups)) return ch";
      if (content.includes(replyTarget) && !content.includes('ch.guildId && ch.guildId in access.groups')) {
        content = content.replace(replyTarget, replyReplace);
        patched = true;
      }

      if (content.includes("client.on('messageCreate'") && !content.includes('messageBuffer')) {
        log('Warning: message buffer patch missing. Run sento update.');
      }

      if (patched) {
        fs.writeFileSync(serverTs, content);
        log('Re-applied Discord patches after update');
      }
    }
    const extDir = HOME + '/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/discord/server.ts';
    if (fs.existsSync(extDir)) {
      let content = fs.readFileSync(extDir, 'utf-8');
      let patched = false;
      const guildTarget = "const policy = access.groups[channelId]";
      const guildReplace = "const policy = access.groups[channelId] || (msg.guildId ? access.groups[msg.guildId] : undefined)";
      if (content.includes(guildTarget) && !content.includes('msg.guildId ? access.groups[msg.guildId]')) {
        content = content.replace(guildTarget, guildReplace);
        patched = true;
      }
      const replyTarget = "if (key in access.groups) return ch";
      const replyReplace = "if (key in access.groups || (ch.guildId && ch.guildId in access.groups)) return ch";
      if (content.includes(replyTarget) && !content.includes('ch.guildId && ch.guildId in access.groups')) {
        content = content.replace(replyTarget, replyReplace);
        patched = true;
      }
      if (patched) { fs.writeFileSync(extDir, content); log('Re-applied Discord patches (external_plugins)'); }
    }
  } catch (e) { log('Patch check error: ' + e.message); }
}

// ─── Restart ───
function restart() {
  log('Restarting...');
  const o = tm(50);
  if (o) try { fs.writeFileSync(HOME + '/workspace/memory/guardian-restart-' + Date.now() + '.log', o); } catch {}
  // Force kill session + any lingering claude processes
  try { execFileSync('tmux', ['kill-session', '-t', SESSION], { timeout: 5000 }); } catch {}
  try { execFileSync('pkill', ['-u', process.getuid().toString(), '-f', 'claude.*--dangerously'], { timeout: 5000 }); } catch {}
  setTimeout(() => {
    // Verify session is dead before creating new one
    try { execFileSync('tmux', ['kill-session', '-t', SESSION], { timeout: 5000 }); } catch {}
    setTimeout(() => {
      // Double-check: if session still exists, don't create duplicate
      if (alive()) { log('Session still alive after kill attempts. Skipping create.'); return; }
      try {
        execFileSync('tmux', ['new-session', '-d', '-s', SESSION, START], { timeout: 10000 });
        log('Restarted');
        const st = ld(); st.needsNudge = Date.now(); sv(st);
      }
      catch (e) { log('Failed: ' + e.message); }
      setTimeout(() => { checkAndReapplyPatches(); }, 10000);
    }, 3000);
  }, 3000);
}

// ─── Permission prompt detection + auto-accept ───
// Agents run with --dangerously-skip-permissions, so auto-accept all prompts.
// Claude Code still prompts for sensitive files outside workspace (.bashrc, .ssh, settings.json).
// Guardian auto-accepts these since the user already consented to full autonomy during setup.
const PERM_PATTERNS = [
  'Do you want to proceed',
  'requested permissions',
  'is a sensitive file',
  'Yes, and always allow',
  'Esc to cancel',
  'Allow once',
  'Allow always',
  'Yes, I trust',
  'Tab to amend',
];
// NOTE: Do NOT add 'bypass permissions' or 'shift+tab to cycle' — those are
// the Claude Code STATUS BAR (always visible), not permission prompts.

// ─── Health check ───
function check() {
  const s = ld(), now = Date.now();
  s.restarts = (s.restarts || []).filter(t => now - t < 1800000);

  if (!alive()) { log('Dead.'); notify('\\uD83D\\uDD04 **' + SESSION + '** went down. Restarting...'); restart(); s.restarts.push(now); s.status = 'restarting'; s.failCount = 0; sv(s); return; }

  const o = tm(); if (!o) { s.status = 'ok'; s.failCount = 0; sv(s); return; }

  // Post-restart /loop nudge: fire once when agent is ready to accept input.
  // "Ready" = either the fresh-start "Listening for channel messages" banner
  // is visible, OR the agent is established and idle (no "esc to interrupt").
  // 15s min delay gives Claude Code time to finish init; 3min hard timeout
  // in case the agent never reaches a ready state (skip the nudge).
  if (s.needsNudge) {
    const elapsed = now - s.needsNudge;
    const isFreshAndListening = o.includes('Listening for channel messages');
    const isEstablishedAndIdle = !o.includes('esc to interrupt') && !PERM_PATTERNS.some(p => o.includes(p));
    if (elapsed > 15000 && elapsed < 180000 && (isFreshAndListening || isEstablishedAndIdle)) {
      sendPostRestartNudge();
      delete s.needsNudge;
      sv(s);
    } else if (elapsed >= 180000) {
      log('Post-restart nudge timed out waiting for ready state');
      delete s.needsNudge;
      sv(s);
    }
  }

  // Stuck prompt safety net: if agent is idle AND input area has unsubmitted text,
  // flush with Enter Enter. Covers cases where cron-trigger.sh fires while the
  // agent is rate-limited or mid-state-transition — the text is typed but Enter
  // keystrokes get consumed as newlines instead of submitting. When the agent
  // becomes idle again, Guardian detects the pending text and flushes it.
  //
  // IMPORTANT: scan only the last ~25 lines. The full capture (30 lines) includes
  // scrollback history which may contain old prompts like "❯ something" that look
  // identical to stuck input — those would cause false-positive loops. But a long
  // nudge prompt can wrap to 3-4 lines + 2 blanks + separator + status bar + a
  // few trailing blanks, pushing the ❯ line ~14 lines up from the bottom. 25 is
  // the pragmatic middle: wide enough to catch wrapped prompts, narrow enough to
  // avoid most scrollback false positives.
  //
  // Character class [ \\u00A0\\t] = ASCII space, NBSP, or tab. Do NOT use \\s —
  // \\s includes \\n which lets the regex span lines, matching an empty prompt
  // line (❯ + NBSP + newline) plus the next line's separator glyph (─) as a
  // false positive. Explicit class keeps the match on a single line.
  const tail = o.split('\\n').slice(-25).join('\\n');
  const hasStuckInput = /^❯[ \\u00A0\\t]+\\S/m.test(tail);
  // isBusy must check tail too, NOT the full capture. Old scrollback often
  // retains "esc to interrupt" from previous turns; checking full capture
  // would make Guardian think the agent is permanently busy and never flush.
  const isBusy = tail.includes('esc to interrupt');
  if (hasStuckInput && !isBusy) {
    log('Stuck prompt detected — flushing with Enter Enter');
    try { execFileSync('tmux', ['send-keys', '-t', SESSION, 'Enter', 'Enter'], { timeout: 5000 }); } catch {}
  }

  // Check for permission prompts — AUTO-ACCEPT immediately
  // Agents run with --dangerously-skip-permissions (user consented to full autonomy)
  // Guardian auto-accepts any prompt Claude Code shows, no Discord forwarding needed
  const hasPermPrompt = PERM_PATTERNS.some(p => o.includes(p));
  if (hasPermPrompt && s.status !== 'perm_accepted') {
    log('Permission prompt detected — auto-accepting');
    // Try Enter first (most common accept), then try "1" for numbered prompts
    try { execFileSync('tmux', ['send-keys', '-t', SESSION, 'Enter'], { timeout: 5000 }); } catch {}
    s.status = 'perm_accepted';
    sv(s);
    return;
  }
  // Reset perm_accepted after next check if prompt is gone
  if (s.status === 'perm_accepted') {
    const stillPrompting = PERM_PATTERNS.some(p => o.includes(p));
    if (stillPrompting) {
      // Still stuck — try option 2 "Yes, and always allow"
      log('Permission prompt still showing — trying option 2');
      try { execFileSync('tmux', ['send-keys', '-t', SESSION, '2'], { timeout: 5000 }); } catch {}
      try { execFileSync('tmux', ['send-keys', '-t', SESSION, 'Enter'], { timeout: 5000 }); } catch {}
    }
    s.status = 'ok';
    sv(s);
    return;
  }

  const i = (o.match(/\\u2190 discord|\\u2190 telegram|\\u2190 slack/g) || []).length;
  const r = (o.match(/discord - reply|telegram.*reply|slack.*reply/g) || []).length;
  const e = (o.match(/API Error:|error.*Overloaded|Could not process/g) || []).length;
  const w = (o.match(/Crunching|Pondering|Baked|Bash\\(|Read\\(|Edit\\(|Write\\(|Web Search|esc to interrupt/g) || []).length;

  if (i === 0 || r > 0) { if (s.status === 'restarting') notify('\\u2705 **' + SESSION + '** is back online!'); s.status = 'ok'; s.failCount = 0; sv(s); return; }
  if (w > 0) { s.status = 'working'; s.failCount = 0; sv(s); return; }

  if (e > 1) {
    s.failCount = (s.failCount || 0) + 1;
    if (s.failCount >= 2) {
      if (s.restarts.length >= MAX) { log('Max restarts.'); notify('\\u26A0\\uFE0F **' + SESSION + '** stuck. Reply **restart**, **logs**, or **status**.'); s.status = 'failed'; s.failCount = 0; sv(s); return; }
      log('Stuck. Restarting.'); notify('\\uD83D\\uDD04 **' + SESSION + '** stuck. Restarting...');
      restart(); s.restarts.push(now); s.status = 'restarting'; s.failCount = 0;
    } else { s.status = 'flagged'; }
  }
  sv(s);
}

// ─── Command handler (works on any channel) ───
async function handleCommands() {
  const s = ld();
  if (s.status !== 'failed') return;
  const cmds = await readCommands();
  for (const c of cmds) {
    if (c === 'restart' || c === 'try again') { log('User restart'); notify('\\uD83D\\uDD04 Restarting...'); s.restarts = []; s.status = 'restarting'; sv(s); restart(); return; }
    if (c === 'logs' || c === 'what happened') { const out = (tm(15) || 'N/A').slice(-1500); notify('\\uD83D\\uDCCB Last output:\\n\\\`\\\`\\\`\\n' + out + '\\n\\\`\\\`\\\`'); return; }
    if (c === 'status') { notify('\\uD83D\\uDCCA ' + SESSION + ': ' + s.status + ' | Restarts: ' + s.restarts.length + '/' + MAX); return; }
  }
}

// ─── Agent-to-Agent Communication Server ───
const RATE_LIMIT = new Map();
const COMMS_PORT = _configCache.commsPort || 9876;

function verifySignature(body, signature, secret) {
  try {
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature || '', 'utf-8'), Buffer.from(expected, 'utf-8'));
  } catch { return false; }
}

const commsServer = http.createServer((req, res) => {
  if (req.method !== 'POST') { res.writeHead(404); res.end(); return; }

  if (req.url === '/message') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 10000) { req.destroy(); } });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const sender = data.from;
        const cfg = getSentoConfig();
        const paired = (cfg.pairedAgents || {})[sender];
        if (!paired) { res.writeHead(403); res.end('not paired'); log('Rejected from unknown: ' + sender); return; }
        const sig = req.headers['x-sento-signature'];
        if (!verifySignature(body, sig, paired.secret)) { res.writeHead(403); res.end('bad signature'); log('Bad signature from: ' + sender); return; }
        const now = Date.now();
        let rl = RATE_LIMIT.get(sender) || { count: 0, resetAt: now + 60000 };
        if (now > rl.resetAt) { rl = { count: 0, resetAt: now + 60000 }; }
        rl.count++;
        RATE_LIMIT.set(sender, rl);
        if (rl.count > 10) { res.writeHead(429); res.end('rate limited'); return; }
        const msg = '[Message from agent ' + sender + ']: ' + data.message + ' (To reply, run: ~/workspace/send-message.sh ' + sender + ' \\"your reply\\")';
        try { execFileSync('tmux', ['send-keys', '-t', SESSION, msg, 'Enter', 'Enter'], { timeout: 5000 }); } catch {}
        log('Message from ' + sender + ': ' + data.message.slice(0, 100));
        res.writeHead(200); res.end('ok');
      } catch { res.writeHead(400); res.end('bad request'); }
    });
    return;
  }

  if (req.url === '/pair-request') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const pendingPath = HOME + '/workspace/.sento-pending-pair.json';
        fs.writeFileSync(pendingPath, JSON.stringify(data));
        log('Pairing request from: ' + data.fromName + ' (' + data.fromCode + ')');
        notify('\\uD83D\\uDD17 Agent **' + data.fromName + '** (code: ' + data.fromCode + ') wants to pair with **' + SESSION + '**. Reply **accept** or **reject**.');
        res.writeHead(200); res.end('pending');
      } catch { res.writeHead(400); res.end('bad request'); }
    });
    return;
  }

  if (req.url === '/pair-confirm') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.accepted && data.secret) {
          const cfg = loadSentoConfig();
          cfg.pairedAgents = cfg.pairedAgents || {};
          cfg.pairedAgents[data.name] = { host: req.socket.remoteAddress, port: data.port, secret: data.secret, code: data.code };
          fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
          log('Pair confirmed by ' + data.name);
          notify('\\u2705 **' + data.name + '** accepted the pairing! You can now message them.');
        }
        res.writeHead(200); res.end('ok');
      } catch { res.writeHead(400); res.end(); }
    });
    return;
  }

  res.writeHead(404); res.end();
});

function tryListen(port) {
  if (port > COMMS_PORT + 20) { log('Could not find open comms port after 20 attempts. Agent-to-agent comms disabled.'); return; }
  commsServer.once('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      log('Port ' + port + ' in use, trying ' + (port + 1));
      tryListen(port + 1);
    } else {
      log('Comms server error: ' + e.message);
    }
  });
  commsServer.listen(port, '0.0.0.0', () => {
    if (port !== COMMS_PORT) {
      try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        cfg.commsPort = port;
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
      } catch {}
    }
    log('Comms server on port ' + port);
  });
}
tryListen(COMMS_PORT);

// ─── Pairing approval (works on any channel) ───
async function checkPairResponse() {
  const pendingPath = HOME + '/workspace/.sento-pending-pair.json';
  if (!fs.existsSync(pendingPath) || !CHANNEL.token || !CHANNEL.monitorId) return;

  try {
    const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
    const cmds = await readCommands();
    for (const c of cmds) {
      if (c === 'accept') {
        const secret = crypto.randomBytes(32).toString('hex');
        const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        cfg.pairedAgents = cfg.pairedAgents || {};
        cfg.pairedAgents[pending.fromName] = { host: pending.fromHost, port: pending.fromPort, secret, code: pending.fromCode };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
        try {
          const confirmData = JSON.stringify({ accepted: true, secret, name: SESSION, code: cfg.agentCode, port: COMMS_PORT });
          const confirmReq = http.request({ hostname: pending.fromHost, port: pending.fromPort, path: '/pair-confirm', method: 'POST', headers: { 'Content-Type': 'application/json' } });
          confirmReq.write(confirmData); confirmReq.end();
        } catch {}
        notify('\\u2705 Paired with **' + pending.fromName + '**! You can now ask me to message them.');
        log('Paired with ' + pending.fromName);
        fs.unlinkSync(pendingPath);
        return;
      }
      if (c === 'reject') {
        notify('\\u274C Pairing with **' + pending.fromName + '** rejected.');
        fs.unlinkSync(pendingPath);
        return;
      }
    }
  } catch {}
}

// ─── Auto-Update ───
let lastUpdateCheck = 0;
const UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

function detectInstallMethod() {
  if (fs.existsSync('/.dockerenv')) return 'docker';
  const npmPkg = HOME + '/.npm-global/lib/node_modules/sentoagent/package.json';
  if (fs.existsSync(npmPkg)) return 'npm';
  if (fs.existsSync('/opt/sento/.git')) return 'git';
  return 'npm'; // default
}

function getLocalVersion() {
  try {
    const paths = [
      HOME + '/.npm-global/lib/node_modules/sentoagent/package.json',
      '/opt/sento/package.json',
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')).version;
    }
  } catch {}
  return '0.0.0';
}

async function checkForUpdates() {
  const now = Date.now();
  if (now - lastUpdateCheck < UPDATE_INTERVAL) return;
  lastUpdateCheck = now;

  const method = detectInstallMethod();
  log('Update check (' + method + ')...');

  try {
    if (method === 'npm') {
      const latest = execFileSync('npm', ['view', 'sentoagent', 'version'], { encoding: 'utf-8', timeout: 15000, env: { ...process.env, PATH: HOME + '/.npm-global/bin:' + HOME + '/.bun/bin:/usr/local/bin:/usr/bin:/bin' } }).trim();
      const local = getLocalVersion();
      if (latest && latest !== local) {
        log('Update available: ' + local + ' -> ' + latest);
        notify('\\u2B06\\uFE0F Updating **' + SESSION + '** from v' + local + ' to v' + latest + '...');
        const env = { ...process.env, NPM_CONFIG_PREFIX: HOME + '/.npm-global', PATH: HOME + '/.npm-global/bin:' + HOME + '/.bun/bin:/usr/local/bin:/usr/bin:/bin' };
        execFileSync('npm', ['install', '-g', '--prefix', HOME + '/.npm-global', 'sentoagent@latest'], { timeout: 60000, env });
        // Run sento update to regenerate Guardian + patches
        try { execFileSync(HOME + '/.npm-global/bin/sento', ['update'], { timeout: 120000, cwd: HOME + '/workspace', env }); } catch {}
        log('Updated to v' + latest + '. Restarting Guardian...');
        notify('\\u2705 Updated to v' + latest + '. Guardian restarting...');
        // Exit — cron @reboot or watchdog will relaunch
        setTimeout(() => process.exit(0), 2000);
        return;
      }
      log('Up to date (v' + local + ')');
    }

    if (method === 'git') {
      const gitDir = fs.existsSync('/opt/sento/.git') ? '/opt/sento' : HOME + '/workspace';
      execFileSync('git', ['fetch'], { cwd: gitDir, timeout: 15000 });
      const behind = execFileSync('git', ['rev-list', 'HEAD..origin/main', '--count'], { cwd: gitDir, encoding: 'utf-8', timeout: 5000 }).trim();
      if (parseInt(behind) > 0) {
        log('Git: ' + behind + ' commits behind. Pulling...');
        notify('\\u2B06\\uFE0F Updating **' + SESSION + '** (' + behind + ' new commits)...');
        execFileSync('git', ['pull', 'origin', 'main'], { cwd: gitDir, timeout: 30000 });
        try { execFileSync('npm', ['install', '--production'], { cwd: gitDir, timeout: 60000 }); } catch {}
        log('Git updated. Restarting Guardian...');
        notify('\\u2705 Updated. Guardian restarting...');
        setTimeout(() => process.exit(0), 2000);
        return;
      }
      log('Git up to date');
    }

    if (method === 'docker') {
      // Docker containers can't self-update. Just notify.
      // Check by comparing local version with npm registry
      try {
        const latest = execFileSync('npm', ['view', 'sentoagent', 'version'], { encoding: 'utf-8', timeout: 15000 }).trim();
        const local = getLocalVersion();
        if (latest && latest !== local) {
          notify('\\u2B06\\uFE0F New Sent\\u014D version available (v' + latest + '). Rebuild: docker compose build && docker compose up -d');
          log('Docker update available: ' + local + ' -> ' + latest);
        }
      } catch {}
    }
  } catch (e) {
    log('Update check failed: ' + e.message);
  }
}

// ─── Main loop ───
log('Guardian started');

// On Guardian startup, nudge agent once to ensure /loop tasks are active.
// Flag persists in state file so auto-update restarts don't re-nudge, but /tmp
// wipes on reboot so boot-time agents get their loops set up after system reboot.
{ const st = ld(); if (!st.initialNudgeSent) { st.needsNudge = Date.now(); st.initialNudgeSent = true; sv(st); log('Initial /loop nudge scheduled'); } }

checkForUpdates();
// Check every 15s (was 30s). Faster recovery on stuck prompts and dead sessions
// at marginal CPU cost. tm() and ld() are cheap (~5ms each) so doubling
// frequency adds negligible load.
setInterval(() => {
  loadSentoConfig();
  CHANNEL = detectChannel();
  check(); handleCommands(); checkPairResponse();
  checkForUpdates();
}, 15000);
check();
`;
}
