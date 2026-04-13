export function renderGuardian(config) {
  const startScript = config.agentName === "blair" ? "start-blair.sh" : "start-agent.sh";

  return `#!/usr/bin/env node
// Sentō Guardian — Unkillable agent monitor
// Zero tokens. Zero AI. Monitors health, auto-restarts, Discord communication.

import { execFileSync } from 'child_process';
import https from 'https';
import fs from 'fs';

const SESSION = '${config.agentName}';
const HOME = process.env.HOME;
const START = HOME + '/workspace/${startScript}';
const LOG = HOME + '/workspace/memory/guardian.log';
const STATE = '/tmp/sento-guardian-' + SESSION + '.json';
const MAX = 3;

function loadDiscordConfig() {
  let wh = '', bt = '', mc = '';
  try {
    const c = HOME + '/workspace/.sento-config.json';
    if (fs.existsSync(c)) { const d = JSON.parse(fs.readFileSync(c, 'utf-8')); wh = d.discordWebhook || ''; mc = d.monitorChannel || ''; }
    const e = HOME + '/.claude/channels/discord/.env';
    if (fs.existsSync(e)) { const m = fs.readFileSync(e, 'utf-8').match(/DISCORD_BOT_TOKEN=(.*)/); if (m) bt = m[1].trim(); }
  } catch {}
  return { wh, bt, mc };
}
let { wh: WH, bt: BT, mc: MC } = loadDiscordConfig();

function log(m) { try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + m + '\\n'); } catch {} }
function ld() { try { return JSON.parse(fs.readFileSync(STATE, 'utf-8')); } catch { return { restarts: [], status: 'ok', failCount: 0 }; } }
function sv(s) { try { fs.writeFileSync(STATE, JSON.stringify(s)); } catch {} }

function wh(m) {
  if (!WH) return;
  try {
    const u = new URL(WH);
    const d = JSON.stringify({ content: m, username: 'Sento Guardian' });
    const r = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': d.length } });
    r.write(d); r.end();
  } catch {}
}

function tm(n = 30) { try { return execFileSync('tmux', ['capture-pane', '-t', SESSION, '-p', '-S', '-' + n], { encoding: 'utf-8', timeout: 5000 }); } catch { return null; } }
function alive() { try { return execFileSync('tmux', ['ls'], { encoding: 'utf-8', timeout: 5000 }).includes(SESSION); } catch { return false; } }

function restart() {
  log('Restarting...');
  const o = tm(50);
  if (o) try { fs.writeFileSync(HOME + '/workspace/memory/guardian-restart-' + Date.now() + '.log', o); } catch {}
  // Always try to kill first, even if we think it's dead (prevents race conditions)
  try { execFileSync('tmux', ['kill-session', '-t', SESSION], { timeout: 5000 }); } catch {}
  // Wait for kill to take effect, then try again to be sure
  setTimeout(() => {
    try { execFileSync('tmux', ['kill-session', '-t', SESSION], { timeout: 5000 }); } catch {}
    setTimeout(() => {
      try { execFileSync('tmux', ['new-session', '-d', '-s', SESSION, START], { timeout: 10000 }); log('Restarted'); }
      catch (e) { log('Failed: ' + e.message); }
    }, 3000);
  }, 2000);
}

function check() {
  const s = ld(), now = Date.now();
  s.restarts = (s.restarts || []).filter(t => now - t < 1800000);

  if (!alive()) { log('Dead.'); wh('\\uD83D\\uDD04 **' + SESSION + '** went down. Restarting...'); restart(); s.restarts.push(now); s.status = 'restarting'; s.failCount = 0; sv(s); return; }

  const o = tm(); if (!o) { s.status = 'ok'; s.failCount = 0; sv(s); return; }
  const i = (o.match(/\\u2190 discord|\\u2190 telegram|\\u2190 slack/g) || []).length;
  const r = (o.match(/discord - reply|telegram.*reply|slack.*reply/g) || []).length;
  const e = (o.match(/API Error:|error.*Overloaded|Could not process/g) || []).length;
  const w = (o.match(/Crunching|Pondering|Baked|Bash\\(|Read\\(|Edit\\(|Write\\(|Web Search|esc to interrupt/g) || []).length;

  if (i === 0 || r > 0) { if (s.status === 'restarting') wh('\\u2705 **' + SESSION + '** is back online!'); s.status = 'ok'; s.failCount = 0; sv(s); return; }
  if (w > 0) { s.status = 'working'; s.failCount = 0; sv(s); return; }

  if (e > 1) {
    s.failCount = (s.failCount || 0) + 1;
    if (s.failCount >= 2) {
      if (s.restarts.length >= MAX) { log('Max restarts.'); wh('\\u26A0\\uFE0F **' + SESSION + '** stuck. Reply **restart**, **logs**, or **status**.'); s.status = 'failed'; s.failCount = 0; sv(s); return; }
      log('Stuck. Restarting.'); wh('\\uD83D\\uDD04 **' + SESSION + '** stuck. Restarting...');
      restart(); s.restarts.push(now); s.status = 'restarting'; s.failCount = 0;
    } else { s.status = 'flagged'; }
  }
  sv(s);
}

async function discord() {
  const s = ld(); if (s.status !== 'failed' || !BT || !MC) return;
  try {
    const r = await fetch('https://discord.com/api/v10/channels/' + MC + '/messages?limit=5', { headers: { Authorization: 'Bot ' + BT } });
    if (!r.ok) return;
    const ms = await r.json();
    for (const m of ms) {
      if (m.author.bot) continue;
      const c = m.content.toLowerCase().trim();
      if (Date.now() - new Date(m.timestamp).getTime() > 120000) continue;
      if (c === 'restart' || c === 'try again') { log('User restart'); wh('\\uD83D\\uDD04 Restarting...'); s.restarts = []; s.status = 'restarting'; sv(s); restart(); return; }
      if (c === 'logs' || c === 'what happened') { const out = (tm(15) || 'N/A').slice(-1500); wh('\\uD83D\\uDCCB Last output:\\n\\\`\\\`\\\`\\n' + out + '\\n\\\`\\\`\\\`'); return; }
      if (c === 'status') { wh('\\uD83D\\uDCCA ' + SESSION + ': ' + s.status + ' | Restarts: ' + s.restarts.length + '/' + MAX); return; }
    }
  } catch {}
}

// ─── Agent-to-Agent Communication Server ───
import http from 'http';
import crypto from 'crypto';

const CONFIG_PATH = HOME + '/workspace/.sento-config.json';
const RATE_LIMIT = new Map();

// Config cache — reloaded every 30 seconds (not on every message)
let _configCache = {};
let _configLastLoad = 0;
function loadSentoConfig() {
  try { _configCache = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch {}
  _configLastLoad = Date.now();
  return _configCache;
}
function getSentoConfig() { return _configCache; }

loadSentoConfig(); // Initial load
const COMMS_PORT = _configCache.commsPort || 9876;

function verifySignature(body, signature, secret) {
  try {
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature || '', 'utf-8'), Buffer.from(expected, 'utf-8'));
  } catch { return false; }
}

const commsServer = http.createServer((req, res) => {
  if (req.method !== 'POST') { res.writeHead(404); res.end(); return; }

  // POST /message — receive a message from a paired agent
  if (req.url === '/message') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 10000) { req.destroy(); } });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const sender = data.from;

        // Use cached config (reloaded every 30s by the main loop)
        const cfg = getSentoConfig();
        const paired = (cfg.pairedAgents || {})[sender];

        if (!paired) { res.writeHead(403); res.end('not paired'); log('Rejected from unknown: ' + sender); return; }

        // Verify HMAC signature
        const sig = req.headers['x-sento-signature'];
        if (!verifySignature(body, sig, paired.secret)) { res.writeHead(403); res.end('bad signature'); log('Bad signature from: ' + sender); return; }

        // Rate limit (10 per minute)
        const now = Date.now();
        let rl = RATE_LIMIT.get(sender) || { count: 0, resetAt: now + 60000 };
        if (now > rl.resetAt) { rl = { count: 0, resetAt: now + 60000 }; }
        rl.count++;
        RATE_LIMIT.set(sender, rl);
        if (rl.count > 10) { res.writeHead(429); res.end('rate limited'); return; }

        // Pipe message with reply instructions
        const msg = '[Message from agent ' + sender + ']: ' + data.message + ' (To reply, run: ~/workspace/send-message.sh ' + sender + ' \\"your reply\\")';
        try { execFileSync('tmux', ['send-keys', '-t', SESSION, msg, 'Enter'], { timeout: 5000 }); } catch {}

        log('Message from ' + sender + ': ' + data.message.slice(0, 100));
        res.writeHead(200); res.end('ok');
      } catch { res.writeHead(400); res.end('bad request'); }
    });
    return;
  }

  // POST /pair-request — receive a pairing request
  if (req.url === '/pair-request') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        // Store pending pair request — Guardian will ask user via Discord webhook
        const pendingPath = HOME + '/workspace/.sento-pending-pair.json';
        fs.writeFileSync(pendingPath, JSON.stringify(data));
        log('Pairing request from: ' + data.fromName + ' (' + data.fromCode + ')');
        wh('\\uD83D\\uDD17 Agent **' + data.fromName + '** (code: ' + data.fromCode + ') wants to pair with **' + SESSION + '**. Reply **accept** or **reject**.');
        res.writeHead(200); res.end('pending');
      } catch { res.writeHead(400); res.end('bad request'); }
    });
    return;
  }

  // POST /pair-confirm — receive confirmation from accepted pair
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
          wh('\\u2705 **' + data.name + '** accepted the pairing! You can now message them.');
        }
        res.writeHead(200); res.end('ok');
      } catch { res.writeHead(400); res.end(); }
    });
    return;
  }

  res.writeHead(404); res.end();
});

try {
  commsServer.listen(COMMS_PORT, '0.0.0.0', () => {
    log('Comms server on port ' + COMMS_PORT);
  });
} catch (e) {
  log('Comms server failed: ' + e.message);
}

// Check for pairing responses in Discord
async function checkPairResponse() {
  const pendingPath = HOME + '/workspace/.sento-pending-pair.json';
  if (!fs.existsSync(pendingPath) || !BT || !MC) return;

  try {
    const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
    const r = await fetch('https://discord.com/api/v10/channels/' + MC + '/messages?limit=5', { headers: { Authorization: 'Bot ' + BT } });
    if (!r.ok) return;
    const msgs = await r.json();
    for (const m of msgs) {
      if (m.author.bot) continue;
      const c = m.content.toLowerCase().trim();
      if (Date.now() - new Date(m.timestamp).getTime() > 300000) continue; // 5 min window

      if (c === 'accept') {
        // Generate shared secret
        const secret = crypto.randomBytes(32).toString('hex');

        // Save to our config
        const cfg = JSON.parse(fs.readFileSync(HOME + '/workspace/.sento-config.json', 'utf-8'));
        cfg.pairedAgents[pending.fromName] = { host: pending.fromHost, port: pending.fromPort, secret, code: pending.fromCode };
        fs.writeFileSync(HOME + '/workspace/.sento-config.json', JSON.stringify(cfg, null, 2));

        // Send confirmation back to the requesting agent
        try {
          const confirmData = JSON.stringify({ accepted: true, secret, name: SESSION, code: cfg.agentCode, port: COMMS_PORT });
          const confirmReq = http.request({ hostname: pending.fromHost, port: pending.fromPort, path: '/pair-confirm', method: 'POST', headers: { 'Content-Type': 'application/json' } });
          confirmReq.write(confirmData); confirmReq.end();
        } catch {}

        wh('\\u2705 Paired with **' + pending.fromName + '**! You can now ask me to message them.');
        log('Paired with ' + pending.fromName);
        fs.unlinkSync(pendingPath);
        return;
      }
      if (c === 'reject') {
        wh('\\u274C Pairing with **' + pending.fromName + '** rejected.');
        fs.unlinkSync(pendingPath);
        return;
      }
    }
  } catch {}
}

log('Guardian started');
setInterval(() => {
  // Reload configs every 30s (picks up new pairings, webhook changes, etc.)
  loadSentoConfig();
  ({ wh: WH, bt: BT, mc: MC } = loadDiscordConfig());
  check(); discord(); checkPairResponse();
}, 30000);
check();
`;
}
