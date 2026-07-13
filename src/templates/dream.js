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
(2) VALIDATE: promote a fact to ${fleetDir}/FLEET.md only if it carries its own evidence. In a fleet of SPECIALISTS, cross-confirmation almost never happens — only one agent touches ads, only one touches trading, only one touches the mail flow. So "wait for a 2nd agent to independently discover this" would leave good facts rotting in candidates/ forever. The real bar: **was it actually OBSERVED or TESTED, and does the fact state its evidence inline?** (e.g. "…(Observed: moving images to CSS backgrounds dropped image-search impressions ~79%)"). A fact with a receipt is promotable on one proposer. A confident assertion with no receipt is NOT — send it back. Mark each: "- [YYYY-MM-DD, confirmed by N] <fact>". Promote GENERAL tool/API/framework facts ONLY. Never anyone's views, strategy, or private/client data.
(3) SUPERSEDE: if a new fact contradicts a FLEET.md entry, keep the newer and note the old one superseded (do not silently delete). Keep FLEET.md tight + deduped.
(4) ARCHIVE: move processed candidate files to ${fleetDir}/candidates/archive/ and clear the live ones.
Post nothing anywhere. This is how the fleet learns from each other: facts shared, each agent keeps its own views.`;
}

// The council guard. This SAME script ships to every agent's cron. At run time it
// elects the curator deterministically (monthly rotation over the sorted agent list)
// and only that agent fires the council prompt — everyone else exits silently.
//
// No designation, no locks, no election protocol, no operator config: every agent
// computes the same answer from the same filesystem. Add or remove an agent and the
// rotation reshuffles itself. If the curator is stuck (FLEET.md untouched 14+ days),
// the next agent in line takes over — a frozen agent must not mean a dead fleet brain.
export function renderCouncilGuard(config, fleetDir = DEFAULT_FLEET_DIR) {
  return `#!/bin/bash
# Sentō fleet council — self-electing. Runs on every agent; only the curator acts.
ME="${config.agentName}"
FLEET_DIR="${fleetDir}"

SHOULD_RUN=$(node -e '
const fs=require("fs"),path=require("path");
const me=process.argv[1], fleetDir=process.argv[2];
const agents=[];
for (const u of (()=>{try{return fs.readdirSync("/home")}catch{return[]}})()) {
  const ws=path.join("/home",u,"workspace");
  if(!fs.existsSync(path.join(ws,"dream-prompt.txt"))) continue;
  let name=u;
  try{const c=JSON.parse(fs.readFileSync(path.join(ws,".sento-config.json"),"utf8"));if(c.agentName)name=c.agentName;}catch{}
  agents.push(name);
}
if(agents.length<=1){console.log("no");process.exit(0)}   // a fleet of one has nothing to curate
agents.sort();
const d=new Date(), mi=d.getUTCFullYear()*12+d.getUTCMonth();
const curator=agents[mi%agents.length];
if(curator===me){console.log("yes");process.exit(0)}
// Liveness fallback: curator looks stuck -> next in rotation steps up.
let stale=false;
try{stale=(Date.now()-fs.statSync(path.join(fleetDir,"FLEET.md")).mtimeMs)>14*86400000}catch{}
const next=agents[(agents.indexOf(curator)+1)%agents.length];
console.log(stale && next===me ? "yes" : "no");
' "$ME" "$FLEET_DIR')

[ "$SHOULD_RUN" = "yes" ] || exit 0
exec ~/workspace/cron-trigger.sh "$ME" "$(cat ~/workspace/council-prompt.txt)"
`;
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
- **Prediction ledger (during work) — MANDATORY, and it applies to me even if my work feels routine.** Before I do something whose outcome I will later find out, I log a one-line prediction FIRST:
  \`echo '{"ts":"<iso>","context":"<what/why>","prediction":"<what I expect>","confidence":<0-1>}' >> ~/workspace/memory/episodes.jsonl\`
  When I learn the result, I append the outcome — **especially when I was wrong**:
  \`echo '{"ts":"<iso>","ref":"<the prediction>","outcome":"<what actually happened>"}' >> ~/workspace/memory/episodes.jsonl\`
  **"Log the uncertain calls" does NOT mean "my job is routine so I log nothing."** That reading is how an agent goes months without learning anything: the dream fires nightly, opens an empty ledger, resolves to start tomorrow, and never does. **The calls I feel most certain about are exactly the ones where being wrong is invisible to me.** Concretely: log it whenever I resolve an ambiguity, pick between two plausible options, use a fallback or a name variant to find a match, or state that something will work before it's been run.
  **The test: if I did real work today and my ledger has zero entries, I got this wrong.**
- **At night I dream** (a cron fires it): replay predictions vs outcomes, distill outcome-backed lessons, sharpen my own views, update \`SELF.md\`, prep tomorrow, and propose general facts to the fleet. **Weekly I consolidate** (dedupe MEMORY.md).
- **Two layers, hard wall:** \`SELF.md\` is ME — my views, calibration, perspective — private, never shared. Only general facts go to the fleet (\`${fleetDir}/candidates/\`). I learn *with* the others but I think for myself.`;
}
