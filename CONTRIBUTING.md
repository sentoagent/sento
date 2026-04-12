# Contributing to Sento

Thanks for wanting to contribute! Here's how.

## Getting Started

1. Fork the repo
2. Clone your fork
3. `npm install`
4. Make your changes
5. Test on a VPS or local machine: `node bin/sento.js init`
6. Submit a PR

## What We're Looking For

- Bug fixes
- New messaging platform support
- Better error handling
- Documentation improvements
- New commands (`sento logs`, `sento doctor`, etc.)
- Platform support (Windows/WSL, macOS launchd)

## Code Style

- ESM modules (`import/export`)
- No TypeScript (keeping it simple)
- Keep dependencies minimal
- Each step in `src/steps/` should be self-contained and idempotent

## Testing

Test on a fresh VPS user or a clean local environment. `sento init` should be re-runnable without breaking anything.

## Discord Plugin Patches

The patches in `src/steps/patch-discord.js` are fragile by nature (string replacement on Anthropic's source). If you're modifying patches:
- Test against the current Discord plugin version
- Make the string matching as specific as possible
- Add a fallback/warning if the patch can't be applied

## Commit Messages

Keep them short and descriptive. No special format required.

## Questions?

Open an issue or start a discussion on GitHub.
