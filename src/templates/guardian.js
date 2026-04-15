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
  try { execFileSync('tmux', ['kill-session', '-t', SESSION], { timeout: 5000 }); } catch {}
  setTimeout(() => {
    try { execFileSync('tmux', ['kill-session', '-t', SESSION], { timeout: 5000 }); } catch {}
    setTimeout(() => {
      try { execFileSync('tmux', ['new-session', '-d', '-s', SESSION, START], { timeout: 10000 }); log('Restarted'); }
      catch (e) { log('Failed: ' + e.message); }
      setTimeout(() => { checkAndReapplyPatches(); }, 10000);
    }, 3000);
  }, 2000);
}

// ─── Health check ───
function check() {
  const s = ld(), now = Date.now();
  s.restarts = (s.restarts || []).filter(t => now - t < 1800000);

  if (!alive()) { log('Dead.'); notify('\\uD83D\\uDD04 **' + SESSION + '** went down. Restarting...'); restart(); s.restarts.push(now); s.status = 'restarting'; s.failCount = 0; sv(s); return; }

  const o = tm(); if (!o) { s.status = 'ok'; s.failCount = 0; sv(s); return; }
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
  const s = ld(); if (s.status !== 'failed') return;
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
        try { execFileSync('tmux', ['send-keys', '-t', SESSION, msg, 'Enter'], { timeout: 5000 }); } catch {}
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

// ─── Main loop ───
log('Guardian started');
setInterval(() => {
  loadSentoConfig();
  CHANNEL = detectChannel();
  check(); handleCommands(); checkPairResponse();
}, 30000);
check();
`;
}
