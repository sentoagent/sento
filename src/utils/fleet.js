// Fleet self-organization. The whole point: an operator should NEVER have to know
// SENTO_FLEET_DIR or SENTO_FLEET_COUNCIL exist. Agents find each other, share one
// brain, and elect a curator among themselves — with no config, no election
// protocol, and no human in a loop that can silently fail.
//
// Why this file exists: `sento init` run N times on one box used to produce N
// isolated one-member fleets and zero council, with a success message every time.
// Nothing errored. Nothing warned. Months of learning went unshared.

import fs from "fs";
import os from "os";
import path from "path";

export const SHARED_FLEET_DIR = "/srv/sento-fleet";
const HOMES = "/home";
const STALE_COUNCIL_DAYS = 14;

// Every Sentō agent drops a .sento-config.json in its workspace. That's our registry —
// no service discovery, no daemon, just the filesystem telling the truth.
export function discoverAgents(homesDir = HOMES) {
  const found = [];
  let users = [];
  try { users = fs.readdirSync(homesDir); } catch { return found; }

  for (const user of users) {
    const cfg = path.join(homesDir, user, "workspace", ".sento-config.json");
    const dreamed = path.join(homesDir, user, "workspace", "dream-prompt.txt");
    if (!fs.existsSync(cfg) && !fs.existsSync(dreamed)) continue;
    let name = user;
    try {
      const parsed = JSON.parse(fs.readFileSync(cfg, "utf-8"));
      if (parsed.agentName) name = parsed.agentName;
    } catch { /* fall back to the unix user */ }
    found.push({ user, name, home: path.join(homesDir, user) });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

// A lone agent keeps a private fleet. The moment a sibling exists, they SHARE one —
// automatically. Adding a 10th agent joins the existing fleet with zero config.
export function resolveFleetDir(homesDir = HOMES) {
  if (process.env.SENTO_FLEET_DIR) return process.env.SENTO_FLEET_DIR;
  const agents = discoverAgents(homesDir);
  return agents.length > 1 ? SHARED_FLEET_DIR : path.join(os.homedir(), "sento-fleet");
}

// Deterministic council election. Every agent computes the SAME answer independently:
// no locks, no messages, no coordination. Rotates monthly so one stuck agent can't
// silently kill the fleet brain forever, but each curator gets ~4 consecutive weekly
// runs — enough to hold a consistent bar for what gets promoted.
export function electCurator(agents, date = new Date()) {
  if (!agents.length) return null;
  const names = agents.map((a) => (typeof a === "string" ? a : a.name)).sort();
  const monthIndex = date.getUTCFullYear() * 12 + date.getUTCMonth();
  return names[monthIndex % names.length];
}

// Liveness fallback: if the elected curator hasn't touched FLEET.md in 2 weeks,
// they're presumed stuck (we watched an agent freeze for hours undetected) and the
// NEXT agent in rotation takes over. A dead curator must not mean a dead fleet brain.
export function isStaleCouncil(fleetDir, days = STALE_COUNCIL_DAYS) {
  const fleetMd = path.join(fleetDir, "FLEET.md");
  try {
    const ageMs = Date.now() - fs.statSync(fleetMd).mtimeMs;
    return ageMs > days * 86400000;
  } catch {
    return false; // no FLEET.md yet — the elected curator will seed it
  }
}

// Called by the weekly council cron on EVERY agent. Only the curator acts; the rest
// exit silently. That's why the same cron can ship to every agent and the rotation
// still works with nobody reconfiguring anything.
export function shouldRunCouncil(myName, { date = new Date(), homesDir = HOMES, fleetDir } = {}) {
  const agents = discoverAgents(homesDir);
  if (agents.length <= 1) return false; // a fleet of one has nothing to curate

  const dir = fleetDir || resolveFleetDir(homesDir);
  const curator = electCurator(agents, date);
  if (curator === myName) return true;

  // Curator looks stuck → next agent in rotation steps up.
  if (isStaleCouncil(dir)) {
    const names = agents.map((a) => a.name).sort();
    const next = names[(names.indexOf(curator) + 1) % names.length];
    return next === myName;
  }
  return false;
}

// Fleet health, for `sento doctor`. Every check here maps to a real bug that ran
// silently in production: isolated fleets, a council that never ran, an empty ledger.
export function fleetHealth(myName, homesDir = HOMES) {
  const agents = discoverAgents(homesDir);
  const fleetDir = resolveFleetDir(homesDir);
  const issues = [];

  const isolated = agents.length > 1 && !fleetDir.startsWith(SHARED_FLEET_DIR) && !process.env.SENTO_FLEET_DIR;
  if (isolated) {
    issues.push(`${agents.length} agents on this box but you're writing to ${fleetDir} — you are a fleet of ONE. Nothing you learn reaches your siblings.`);
  }

  const curator = electCurator(agents, new Date());
  if (agents.length > 1 && isStaleCouncil(fleetDir)) {
    issues.push(`FLEET.md hasn't been curated in ${STALE_COUNCIL_DAYS}+ days (curator: ${curator}). Candidate facts are piling up unpromoted.`);
  }

  const episodes = path.join(os.homedir(), "workspace", "memory", "episodes.jsonl");
  const archive = path.join(os.homedir(), "workspace", "memory", "dreams", "episodes-archive.jsonl");
  let logged = 0;
  try { logged = fs.readFileSync(archive, "utf-8").split("\n").filter(Boolean).length; } catch { /* none */ }
  if (logged === 0 && fs.existsSync(episodes)) {
    issues.push("You have logged ZERO predictions, ever. Your nightly dream opens an empty ledger and learns nothing. Log predictions on uncertain calls — including the ones that feel routine.");
  }

  return { agents, fleetDir, curator, isCurator: curator === myName, issues };
}
