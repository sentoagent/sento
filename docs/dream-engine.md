# Sentō Dream Engine — Design & Build Plan

**Goal:** agents that actually learn (from real signals, not self-flattery), feel human (an evolving self + a culture), and get better safely (gated, non-destructive). Ships the July-2026 "dreaming" pattern the frontier converged on (OpenAI, Anthropic, OpenClaw, Letta) *plus* four things none of them have.

**Tagline:** *Learn together, think differently.*

---

## 0. The one principle that governs everything
A reflection loop only improves an agent when it's **closed by a real external signal** (test, tool result, P&L, a human correction). Pure "grade your own reasoning" with no signal *degrades* agents (DeepMind ICLR'24; corroborated by June-2026 arxiv on continual learning). So every write is backed by an outcome. Prediction-error is our self-generated real signal.

---

## 1. Three-tier memory (hard walls between tiers)

| Tier | Scope | Contains | Leaves the box? |
|---|---|---|---|
| **Private Self** | per-agent | persona, views, strategy, taste, calibration, own episodes | **Never** |
| **Fleet Brain** | per-owner (one person's agents) | that owner's *facts + verified skills* | **Never** — stays on their infra |
| **Community Codex** *(opt-in, later)* | all Sentō users | *sanitized generic tool/framework* lessons only | Only on explicit opt-in |

- **Framework is shared (npm); knowledge is private (files on your box).** A stranger installing Sentō gets the *capability*, their agents start blank and learn their own stuff. Nothing of yours leaks.
- **Fleet Brain** = facts/skills only ("Zoho returns custom fields keyed by label", "the Discord plugin drops bot messages"). Objective — no personal spin, safe to share *within one owner's fleet*.
- **Private Self** = everything that makes the agent *it*. Never shared, never overwritten by the collective.
- **SELF.md is persona-agnostic by construction** (learned in the prototype). Its anchor *points to CLAUDE.md* — the identity already entered at `sento setup` — instead of hard-coding a persona. So it auto-derives for ANY agent with **zero hand-seeding**; the dream only fills the evolving sections (views, calibration, narrative). This is what lets the whole engine be a one-shot setup step instead of per-agent handiwork.
- **Community Codex** = a future opt-in ecosystem layer: only tool/framework facts, classifier-walled + sanitized (strip names/paths/secrets/business specifics), community-curated. Off by default. Design the wall now, ship it off.

**File layout per agent (`~/workspace/memory/`):**
```
MEMORY.md            # index (loaded every session): principles + skill pointers. <200 lines, deduped.
SELF.md              # PRIVATE: persona anchor + evolving self-model (edges, mistakes, calibration, narrative)
PREP.md              # tomorrow's rehearsal (read first thing)
episodes.jsonl       # prediction -> outcome ledger (the learning signal)
dreams/YYYY-MM-DD.md # nightly dream log (audit trail)
fleet-candidates.md  # general facts proposed for the shared brain (weekly council reviews)
topics/*.md          # lazy-loaded detail files
```
Fleet brain lives in a shared collection (ClawMem) the whole fleet reads; per-agent private files never go there.

---

## 2. The Dream engine — phases
Fired by the guardian's idle window / Claude Code `post-session` hook, and a nightly cron. Heavy reflection spawns an Opus sub-agent (session stays Sonnet to save cost).

0. **Capture** (event-driven, during the day) — at each meaningful action, log an episode: `{intent, PREDICTION+confidence, outcome, surprise, affect_tag}`.
1. **Replay & score** — rank episodes by `surprise × importance × recency`. Replay the surprising ones hard; let routine confirmations decay (graceful forgetting is a feature).
2. **Reflect → distill** — from high-surprise episodes, extract a **principle** ("when X, do Y because Z"), outcome-cited. Facts/skills only pass the gate.
3. **Curate → write** — incremental, **non-destructive** ADD/UPDATE to MEMORY.md + skills/. Contradiction check: conflicts go to a queue / supersede-with-evidence, never silent overwrite.
4. **Self & metacognition** (PRIVATE) — update SELF.md: current edges, recurring mistakes, calibration by domain, and one line of first-person narrative ("how I changed today"). Persona anchor is sacred, never rewritten.
5. **Rehearsal** — simulate tomorrow (calendar / market / recurring tasks), pre-draft strategies → PREP.md.
6. **Collective sync** — general (non-strategy) facts → fleet-candidates.md. Weekly **council dream** merges/dedupes across the fleet and flags cross-agent patterns ("3 agents hit the same quirk → escalate a fix").

Morning: agent reads MEMORY.md + SELF.md + PREP.md + fleet brain → walks in prepared, self-aware, smarter from the whole fleet.

---

## 3. The prediction-error spine (why it actually learns)
Before a meaningful action, the agent writes a one-line **prediction + confidence**. After, it logs the actual. The **delta (surprise)** is the learning signal; big surprises consolidate hard.
- Real self-generated signal → beats naive self-reflection (which the June papers show degrades).
- Builds a **calibration curve** per agent per domain → the agent learns *where* it's usually right/wrong → knows when to trust itself vs. ask.
- The signal generalizes: a trader uses P&L (`calibration.mjs`); a personal assistant like **kai** uses **task outcomes + the user's corrections** — an equally real, self-generated signal. kai is the first prototype (personal, high-interaction, safe to experiment on).

---

## 4. Individuality (anti-homogenization) — the part that makes it human *and* better
Sharing knowledge must NOT make Jordan and Masa think alike (diversity = alpha; sameness = correlated risk + groupthink).
1. **Persona is sacred** — dream grows the self-narrative, never overwrites the core identity.
2. **Personal interpretation pass** — inheriting a shared *fact*, the agent forms *its own* take on it (through its persona/history) in private memory. Same fact, different view.
3. **Divergence monitor** — track correlation of agents' *views/positions*; if two converge too much, flag it and nudge each back to its edge.
4. **Council surfaces disagreement as signal, never forces consensus** — "Jordan bullish / Masa bearish on the same setup" is data, not a conflict.
5. **Per-agent calibration** → each earns confidence in different things → behavior naturally diverges.

Only **facts + verified skills** are shareable. **Views, strategy, taste, calibration** stay private. That wall is what preserves individuality.

---

## 5. Guardrails (non-negotiable)
- Prediction-error **is** the write-gate: only outcome-backed lessons enter durable memory.
- Fleet promotion needs a **second confirmation** (another agent or a verified outcome).
- **Non-destructive** writes only; contradiction queue instead of overwrite.
- Size caps (<200-line index) + spaced re-validation ("still true?") to fight context rot.
- No agent-authored claim auto-ingested as fact without an outcome/validation.
- Community Codex (later): classifier wall + sanitization + curation; opt-in only.

---

## 6. Grounding (why this is current, not 3-years-ago)
- Background "dreaming" reflection = the July-2026 convergent pattern (OpenAI Dreaming, Anthropic Dreaming/Managed Agents, OpenClaw Dreaming, Letta sleep-time).
- Non-destructive Reflector/Curator = ACE (ICLR'26).
- Principle-level, offline, gated > example-level/online = June-2026 continual-learning papers.
- Skills-as-saved-procedures = Voyager / Agent Workflow Memory.
- **New here (not in the frontier):** prediction-error write-gate, a *multi-agent* learning mesh that preserves individuality, an evolving Self + metacognition, and prospective rehearsal.

---

## 7. Build order (updated from the prototype)
1. **Prototype on the agents you actually USE** — high-interaction is the right test bed. *Lesson: a low-interaction agent (kai) generates too little signal to watch; the real learning shows on the daily-driver agents.* Ship the reusable, idempotent, additive component (`dream-retrofit.sh <user> <session>`): persona-agnostic SELF.md + PREP + fleet-candidates + dream cron + the CLAUDE "Dreaming" section. ✅ done: kai, jordan, mira, porter.
2. **Watch a few nights, tune the dream prompt.** Per-domain flavor later (traders lean on `calibration.mjs` for the prediction/outcome signal; assistants on user corrections). The generic prompt works for all as v1.
3. **Framework integration = the "fresh Sentō gets it automatically" step.** Convert the proven component into Sentō's setup: `src/steps/setup-dream.js` (scaffold + install cron), a `SELF.md` template, the CLAUDE "Dreaming" section in `claude-md.js`, and the dream cron in the crontab template. Then every NEW agent auto-gets the engine at `sento setup` (persona-agnostic anchor = zero config), and `sento update` retrofits any existing fleet. This is the same logic as `dream-retrofit.sh`, ported to the template system.
4. Stand up the **Fleet Brain** shared collection + weekly council + divergence monitor.
5. Community Codex: build the classifier wall + sanitizer; keep it off by default.

**Deployment note:** the dream cron fires regardless of restart; the *session-start* reads (SELF/PREP) + prediction-error awareness activate on each agent's next restart.
