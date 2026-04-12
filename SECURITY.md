# Security Policy

## Trust Model

Sento operates on a **single-user model**. Each agent runs under its own OS user account and has full shell access via `--dangerously-skip-permissions`. Anyone who can send messages in the configured channels (Discord, Telegram, etc.) can instruct the agent.

This means:
- Channel access = agent access. Use platform permissions to restrict who can message.
- DMs are blocked by default to prevent unauthorized access.
- Credentials are stored in plaintext on disk. Only run on machines you control.
- One agent per OS user is the recommended pattern.

## Reporting Vulnerabilities

If you find a security issue, please report it privately:

1. **Email:** security@sentoagent.com (or open a GitHub Security Advisory)
2. **GitHub:** Use the "Report a vulnerability" feature on the Security tab

Please include:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment
- Suggested fix (if any)

Do NOT open a public issue for security vulnerabilities.

## Out of Scope

- Prompt injection via messaging channels (by design, channel users are trusted operators)
- File access on the host machine (expected behavior with `--dangerously-skip-permissions`)
- Plaintext credential storage (documented limitation, encrypted storage planned for future)
