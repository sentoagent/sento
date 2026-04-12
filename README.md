# Sentō 戦闘

Agents sent to fight your battles.

Self-improving AI agents that run 24/7. Controlled through Discord, Telegram, Slack, or iMessage. One command to set up. They learn, adapt, and get better over time.

Built by Gabriel Gil. Powered by Claude Code.

## Quick Start

```bash
npx sento init
```

That's it. The interactive setup walks you through everything.

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
- **A Claude plan with API access** (Max, Team, or Enterprise)
- **A bot token** for your messaging platform (Discord, Telegram, or Slack)

## Commands

```bash
# Setup
npx sento init           # Set up a new agent
npx sento update         # Update Claude Code, plugins, and patches

# Monitor
npx sento status         # Check if your agent is running and healthy
npx sento logs           # View agent output (last 30 lines)
npx sento logs -n 100    # View more lines
npx sento logs --watchdog # View auto-restart history

# Configure
npx sento config         # Change model, tokens, keys, settings
npx sento channels       # Add/remove Discord channels or servers

# Skills
npx sento skills         # List installed plugins and custom skills
npx sento skills install # Install a plugin from the marketplace
npx sento skills export  # Export a custom skill to share
npx sento skills import  # Import a skill from another agent

# Process Control
npx sento start          # Start the agent
npx sento stop           # Stop the agent
npx sento restart        # Restart the agent

# Agent-to-Agent Communication
npx sento pair           # Pair with another agent
npx sento agents         # List your agent code and paired agents

# Diagnostics
npx sento doctor         # Check for issues (12 checks)
npx sento doctor --fix   # Auto-fix what's possible
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

# Set your tokens in .env
echo "CLAUDE_TOKEN=sk-ant-oat01-..." > .env
echo "BOT_TOKEN=your-discord-bot-token" >> .env
echo "SERVER_ID=your-discord-server-id" >> .env

# Launch
docker compose up -d
```

Multi-agent? Just add more services to `docker-compose.yml`. Each agent gets its own container, volumes, and port.

## Security

- Credentials are stored in plaintext on disk (`~/.bashrc`, `~/workspace/start-agent.sh`). Only run on a machine you control.
- The agent runs with `--dangerously-skip-permissions`, giving it full shell access. It can read, write, and delete any file your user account has access to.
- Anyone who can send messages in the configured channels can instruct the agent. Use Discord's channel permissions or the `allowFrom` config to restrict access.
- DMs are blocked by default to prevent exploitation.

## Disclaimers

- **Not affiliated with Anthropic.** Sentō is an independent tool that uses Claude Code.
- **API costs apply.** Using Claude Code requires a paid Anthropic plan. Usage may incur additional costs per Anthropic's pricing.
- **Third-party software.** Sentō installs and configures Claude Code, ClawMem, Playwright, and other packages governed by their respective licenses.
- **Plugin patches.** Sentō patches the Claude Code Discord plugin to support server-wide channel matching and message buffering. Run `sento update` after Claude Code updates to re-apply patches.

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
- Sends Discord notifications: "Restarting..." → "Back online!"
- If auto-restart fails, lets you fix it FROM DISCORD — reply "restart", "logs", or "status"
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
