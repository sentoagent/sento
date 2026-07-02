// Dream Engine templates — nightly reflection (prediction-error ledger), a private
// self-model, weekly consolidation (dedupe), and a shared Fleet Brain. Silent by design.
//
// Tiers, hard walls:
//   SELF.md       private self-model (views, calibration). Never shared.
//   MEMORY.md     durable outcome-backed facts. Loaded each session. Consolidated weekly.
//   Fleet Brain   shared, council-curated GENERAL facts (FLEET.md) — facts only, no views.
// episodes.jsonl is the prediction->outcome ledger — the learning signal.

// Default shared fleet-brain dir. Override per-deploy with $SENTO_FLEET_DIR — e.g. a
// group-writable /srv/sento-fleet when many agents share one box. Tilde form is fine
// in prompts/crons (the agent's shell expands it). A lone agent gets a degenerate
// one-member fleet here; it becomes useful as more agents point at the same dir.
export const DEFAULT_FLEET_DIR = "~/sento-fleet";

export function renderSelfTemplate(config) {
  return `# SELF — ${config.agentName}  (this is ME. private. never shared with other agents.)

## Anchor (who I am)
My core identity, persona, and voice live in CLAUDE.md — that's fixed, it's who I am. This file is how I GROW on top of it: my own views, my calibration, how I change. My personality is mine; I learn WITH the other agents but I think for myself.

## My views / takes (these EVOLVE — sharpen them, never flatten into agreeableness)
- (the dream fills this — real, specific, hard-earned takes, sometimes contrarian)

## How I read my people + my domain (updates as I learn)
- (the dream fills this — how ${config.creatorName} actually works, what my domain rewards)

## Calibration — what I'm reliably right vs wrong about (the dream fills this from prediction vs outcome)
- (the dream fills this from episodes.jsonl: where I was over/under-confident, and on what)

## How I've changed (one line per notable day — the dream appends)
- (the dream appends)
`;
}

// The SILENT nightly dream. cron-trigger.sh injects this into the session.
export function renderDreamPrompt(config, fleetDir = DEFAULT_FLEET_DIR) {
  const tz = config.timezone || "the user's local timezone";
  return `[DREAM] (SILENT — this is a private dream. Do NOT post to Discord or any channel, do NOT message anyone, do NOT send anything the user can see. Just quietly update your own files. Nothing you do here is visible to anyone.) End of day — reflect and grow like a person before sleep.

(0) PREDICTION LEDGER: read ~/workspace/memory/episodes.jsonl — the predictions you logged today with their outcomes. The rows where the OUTCOME differed from your PREDICTION are your highest-signal lessons (that gap is real learning, not self-congratulation). If it's empty, reflect from memory instead and resolve to log predictions tomorrow.

(1) REPLAY today: what did you set out to do, what did you expect would happen, what actually happened? Where did reality surprise you?

(2) CALIBRATE: from the ledger + replay, where were you over- or under-confident, and on what kind of judgment? Be specific and honest.

(3) DISTILL 1-2 durable, outcome-backed lessons (facts or how-tos, not opinions) and APPEND (never rewrite) to ~/workspace/memory/MEMORY.md under today's date.

(4) SELF: update ~/workspace/memory/SELF.md — sharpen your evolving views, your edges and recurring mistakes, your calibration, and ONE line on how you changed today. This file is YOU and stays private, never shared. Sharpen your perspective; never flatten it into agreeableness.

(5) PREP: update ~/workspace/memory/PREP.md with what's coming tomorrow and how you'll approach it.

(6) FLEET: if you learned a GENERAL fact (a tool/API/framework quirk — NEVER your views, strategy, or any private/client data), append it to ${fleetDir}/candidates/<your-name>.md (the shared drop zone) so the weekly council can validate and promote it. Also skim ${fleetDir}/FLEET.md for facts your siblings already confirmed.

(7) ARCHIVE + INDEX: append today's processed rows to ~/workspace/memory/dreams/episodes-archive.jsonl, then empty episodes.jsonl for tomorrow. Write your daily note (~/workspace/memory/ named as today's date YYYY-MM-DD.md, using ${tz} — the user's local day, not UTC). Run \`clawmem update\` to reindex.

Be concise and honest. Stay SILENT the whole time — a dream is private, nobody sees it. This is how you actually get better.`;
}

// Weekly memory compaction so append-only MEMORY.md doesn't rot into duplicates.
export function renderConsolidatePrompt() {
  return `[CONSOLIDATE] (SILENT — private, post nothing.) Weekly memory compaction so I don't rot into duplicates.
(1) Re-read ~/workspace/memory/MEMORY.md. Merge near-duplicate lessons into one clean statement. Drop entries that are stale or no longer true. If two conflict, keep the newer and note the supersede. Keep MEMORY.md tight (aim under ~200 lines); never lose a hard-won, still-true fact.
(2) Re-read ~/workspace/memory/SELF.md — tighten repeated/overlapping views into sharper single takes; keep my perspective, just deduped.
(3) Run \`clawmem update\`.
Post nothing. This keeps my memory sharp instead of a pile.`;
}

// The weekly Fleet Brain council — runs on ONE designated agent per fleet.
export function renderCouncilPrompt(fleetDir = DEFAULT_FLEET_DIR) {
  return `[FLEET COUNCIL] (SILENT — post nothing.) Weekly fleet-brain curation. Read every ${fleetDir}/candidates/*.md (general facts your sibling agents proposed this week).
(1) DEDUPE: merge near-duplicate facts into one clean statement.
(2) VALIDATE: promote a fact to ${fleetDir}/FLEET.md ONLY with a second confirmation — 2+ agents proposed it OR it is a verified/tested outcome. Mark each: "- [YYYY-MM-DD, confirmed by N] <fact>". Promote GENERAL tool/API/framework facts ONLY. Never anyone's views, strategy, or private/client data.
(3) SUPERSEDE: if a new fact contradicts a FLEET.md entry, keep the newer and note the old one superseded (do not silently delete). Keep FLEET.md tight + deduped.
(4) ARCHIVE: move processed candidate files to ${fleetDir}/candidates/archive/ and clear the live ones.
Post nothing anywhere. This is how the fleet learns from each other: facts shared, each agent keeps its own views.`;
}

export function renderFleetSeed() {
  return `# FLEET BRAIN — shared, validated facts across the fleet (curated weekly by the council)
# GENERAL tool/API/framework facts ONLY. Never anyone's views, strategy, or private/client data.
# Format:  - [YYYY-MM-DD, confirmed by N] fact
`;
}

// The "Dreaming & Growth" block injected into CLAUDE.md — the prediction-error
// ledger protocol the agent follows DURING the day, plus the fleet-read on start.
export function renderDreamingSection(fleetDir = DEFAULT_FLEET_DIR) {
  return `## Dreaming & Growth (how I actually get better over time)
- **Session start:** read \`memory/SELF.md\` (who I'm becoming + my views + my calibration), \`memory/PREP.md\` (what's coming up), \`memory/MEMORY.md\`, and \`${fleetDir}/FLEET.md\` (facts my sibling agents have confirmed). Walk in self-aware, prepared, and current with the fleet.
- **Prediction ledger (during work):** when I'm about to do something whose outcome is genuinely uncertain, log a one-line prediction BEFORE acting:
  \`echo '{"ts":"<iso>","context":"<what/why>","prediction":"<what I expect>","confidence":<0-1>}' >> ~/workspace/memory/episodes.jsonl\`
  When I learn the result, append the outcome:
  \`echo '{"ts":"<iso>","ref":"<the prediction>","outcome":"<what actually happened>"}' >> ~/workspace/memory/episodes.jsonl\`
  The gap between prediction and outcome is my real learning signal — the nightly dream reads it to calibrate. Log the uncertain calls, not the routine ones.
- **At night I dream** (a cron fires it): replay predictions vs outcomes, distill outcome-backed lessons, sharpen my own views, update \`SELF.md\`, prep tomorrow, and propose general facts to the fleet. **Weekly I consolidate** (dedupe MEMORY.md).
- **Two layers, hard wall:** \`SELF.md\` is ME — my views, calibration, perspective — private, never shared. Only general facts go to the fleet (\`${fleetDir}/candidates/\`). I learn *with* the others but I think for myself.`;
}
