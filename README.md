# Sentō 戦闘

[![npm version](https://img.shields.io/npm/v/sentoagent.svg?color=gold)](https://www.npmjs.com/package/sentoagent)
[![npm downloads](https://img.shields.io/npm/dm/sentoagent.svg)](https://www.npmjs.com/package/sentoagent)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-20%2B-brightgreen.svg)](https://nodejs.org)
[![GitHub stars](https://img.shields.io/github/stars/sentoagent/sento.svg?style=social)](https://github.com/sentoagent/sento)

Agents sent to fight your battles.

Self-improving AI agents that run 24/7. Controlled through Discord, Telegram, Slack, or iMessage. One command to set up. They learn, adapt, and get better over time.

**Works with your Claude subscription (Pro, Max, Team, or Enterprise). No API keys, no per-token billing, no surprise costs.** Other agent frameworks require pay-per-use API keys. Sentō runs on your existing Claude plan — flat rate, unlimited usage.

Built by Gabriel Gil. Powered by Claude Code.

## Quick Start

```bash
npx sentoagent init
```

That's it. The interactive setup walks you through everything.

## Demo

<!-- TODO: replace with asciinema cast link and Discord screenshot after recording -->

A 60-second walkthrough of `init` → first message → agent response is coming. In the meantime, the full flow is reproducible from the [Quick Start](#quick-start): run `npx sentoagent init`, pick Discord, paste a bot token, and DM the agent `hi` — the onboarding conversation begins immediately.

## What It Does

- **Chat on Discord, Telegram, Slack, or iMessage** — responds in your channels
- **Read, write, and edit code** — full filesystem access
- **Git operations** — commit, push, create branches, make PRs
- **Browse the web** — Playwright gives it a real browser
- **Persistent memory** — remembers everything across sessions (ClawMem)
- **Self-improving** — auto-creates reusable skills after complex tasks
- **Scheduled tasks** — cron jobs for reports, reminders, automations
- **Auto-restart** — survives crashes and reboots
- **Self-healing** — watchdog detects stuck agents and auto-restarts them
- **Skill sharing** — export and import skills between agents
- **First-run onboarding** — the agent interviews you and personalizes itself

## Requirements

- **Node.js 20+**
- **A Claude subscription** (Pro, Max, Team, or Enterprise) — no API keys needed, uses your existing plan
- **A bot token** for your messaging platform (Discord, Telegram, or Slack)

## Commands

After init, the `sento` command is available (run `source ~/.bashrc` or open a new terminal):

```bash
# Setup
npx sentoagent init       # Set up a new agent (first time only)
sento update              # Update Claude Code, plugins, CLI, and patches

# Monitor
sento status              # Check if your agent is running and healthy
sento logs                # View agent output (last 30 lines)
sento logs -n 100         # View more lines
sento logs --watchdog     # View auto-restart history

# Configure
sento config              # Change model, tokens, keys, settings
sento channels            # Add/remove communication channels (Discord, Telegram, Slack)

# Skills
sento skills              # List installed plugins and custom skills
sento skills install      # Install a plugin from the marketplace
sento skills export       # Export a custom skill to share
sento skills import       # Import a skill from another agent

# Process Control
sento start               # Start the agent
sento stop                # Stop the agent
sento restart             # Restart the agent

# Agent-to-Agent Communication
sento pair                # Pair with another agent
sento agents              # List your agent code and paired agents

# Diagnostics
sento doctor              # Check for issues (12 checks)
sento doctor --fix        # Auto-fix what's possible
```

## How It Works

1. `sento init` installs Claude Code, 17 plugins, persistent memory, and browser automation
2. You pick a name, personality, and messaging channel
3. The agent launches in tmux and comes online
4. First message triggers an onboarding conversation where the agent learns about you
5. It updates its own config based on your answers and starts working

## Platforms

- **Linux (VPS)** — fully supported, auto-restart on reboot
- **Docker** — `docker compose up -d` (see docker-compose.yml)
- **macOS** — works, manual restart after reboot
- **Windows** — use WSL (Windows Subsystem for Linux)

## Docker Quick Start

```bash
# Clone the repo
git clone https://github.com/sentoagent/sento.git && cd sento

# Build the image
docker build -t sento .

# Run with Discord
docker run -d \
  --name my-agent \
  -e CLAUDE_TOKEN="sk-ant-oat01-..." \
  -e AGENT_NAME="myagent" \
  -e CHANNELS="discord" \
  -e DISCORD_BOT_TOKEN="your-bot-token" \
  -e SERVER_ID="your-server-id" \
  -e AGENT_ROLE="General-purpose assistant" \
  -e AGENT_PERSONALITY="Chill, helpful" \
  -e AGENT_LANGUAGE="English" \
  -e AGENT_CREATOR="Your Name" \
  -e AGENT_TIMEZONE="America/New_York" \
  sento

# Watch the setup (takes a few minutes on first run)
docker logs -f my-agent

# Once you see "Starting myagent (channels: discord)...", the bot is live!
```

**Multi-channel:**
```bash
-e CHANNELS="discord,telegram" \
-e DISCORD_BOT_TOKEN="..." \
-e TELEGRAM_BOT_TOKEN="..." \
-e TELEGRAM_CHAT_ID="your-chat-id" \
```

**Telegram only:**
```bash
-e CHANNELS="telegram" \
-e TELEGRAM_BOT_TOKEN="..." \
-e TELEGRAM_CHAT_ID="your-chat-id" \
```

> **About `CLAUDE_TOKEN`:** This is your Claude Code **OAuth token** (prefix `sk-ant-oat01-`), not an Anthropic API key. It authenticates Claude Code against your existing Claude subscription — no per-token billing. Get it by running `claude setup-token` locally after signing into Claude Code, or copy it from `~/.claude/.credentials.json`. Treat it like a password.

> **First run takes a few minutes.** Docker installs plugins, ClawMem, and generates embeddings. Watch progress with `docker logs -f my-agent`. Subsequent starts are fast.

Multi-agent? Just add more services to `docker-compose.yml`. Each agent gets its own container, volumes, and port.

## Security

- Credentials are stored in plaintext on disk (`~/.bashrc`, `~/workspace/start-agent.sh`). Only run on a machine you control.
- The agent runs with `--dangerously-skip-permissions`, giving it full shell access. It can read, write, and delete any file your user account has access to.
- Anyone who can send messages in the configured channels can instruct the agent. Use Discord's channel permissions or the `allowFrom` config (see below) to restrict access.
- DMs are blocked by default (`dmPolicy: "allowlist"`) to prevent exploitation.

### External Services Contacted

Sentō only makes network calls to:

- **Anthropic** (`api.anthropic.com`) — Claude Code uses your subscription
- **Your chosen messaging platform** — Discord, Telegram, Slack, or iMessage (Apple) APIs
- **npm registry** (`registry.npmjs.org`) — on first run, to install the 17 plugins listed in the architecture section
- **GitHub** (`api.github.com`) — only when you use git operations or install plugins from the marketplace
- **Context7** (`context7.com`) — only when the agent looks up library documentation
- **Google Generative Language API** — only if you provide a `GEMINI_KEY` for memory embeddings (optional)
- **Any URL you ask it to browse** — Playwright opens real web pages on demand

No telemetry. No analytics. Sentō does not phone home. Guardian and Watchdog make zero network calls.

### Restricting who can message the agent

The agent reads an allow-list from `~/.claude/channels/<platform>/access.json`. Example restricting a Discord channel to two user IDs:

```json
{
  "dmPolicy": "allowlist",
  "allowFrom": [],
  "groups": {
    "123456789012345678": {
      "requireMention": false,
      "allowFrom": ["USER_ID_1", "USER_ID_2"]
    }
  }
}
```

An empty `allowFrom: []` means "anyone with channel access." Run `npx sentoagent channels` to edit interactively.

## Disclaimers

- **Not affiliated with Anthropic.** Sentō is an independent tool that uses Claude Code.
- **API costs apply.** Using Claude Code requires a paid Anthropic plan. Usage may incur additional costs per Anthropic's pricing.
- **Third-party software.** Sentō installs and configures Claude Code, ClawMem, Playwright, and other packages governed by their respective licenses.
- **Plugin patches.** Sentō patches Claude Code channel plugins (Discord guild matching + message buffer, Telegram message buffer). Run `sento update` after Claude Code updates to re-apply patches.

## Architecture

```
Your phone/PC (Discord, Telegram, Slack)
    |
    v
Claude Code (on your machine, in tmux)
    |
    +-- Messaging Plugin (Discord/Telegram/Slack/iMessage)
    +-- ClawMem (persistent memory)
    +-- Playwright (browser automation)
    +-- Context7 (docs lookup)
    +-- 17 Plugins (skills, code review, etc.)
    +-- CLAUDE.md (agent identity + rules)
    +-- ~/workspace/skills/custom/ (self-created skills)
    +-- Cron jobs (scheduled tasks)
    +-- Watchdog (auto-restart on stuck/errors every 5 min)
```

## Auto-Recovery (Guardian + Watchdog)

Sentō agents are designed to never go down. Two layers of protection:

**Guardian Bot** — A lightweight Node.js process that runs alongside the agent:
- Monitors agent health every 30 seconds
- Auto-restarts when the agent is stuck or crashed
- Sends notifications on Discord, Telegram, or Slack: "Restarting..." → "Back online!"
- If auto-restart fails, lets you fix it from your messaging app. Reply "restart", "logs", or "status"
- You never need to open a terminal to fix your agent
- Zero tokens, zero AI calls

**Watchdog** — A bash cron job (every 5 minutes) as a backup:
- Catches edge cases the Guardian misses
- Detects unanswered messages with API errors
- Saves agent state before restarting
- Stops after 3 failed restarts and alerts the owner

To set up Guardian notifications, run `sento config` → Set Discord webhook.

## Agent-to-Agent Communication

Sentō agents can message each other securely — the first agent framework with this feature.

**How it works:**
1. Each agent gets a unique code (e.g. `SENTO-A3F8K2D1`) during setup
2. Share your code with another agent's owner
3. They run `sento pair` and enter your code
4. Your agent asks you to accept — reply "accept" on Discord
5. Both agents are paired. Tell either one: "Message [agent] about X"

**Security:**
- HMAC-SHA256 signed messages — rejects tampering
- Both sides must accept pairing — no one-sided access
- Rate limited — max 10 messages per minute
- Text only — receiving agent decides what to do with the message
- On-demand by default — agents only communicate when you tell them to

## License

MIT

## Links

- [GitHub](https://github.com/sentoagent/sento)
- [Issues](https://github.com/sentoagent/sento/issues)
