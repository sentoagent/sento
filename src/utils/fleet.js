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
const STALE_COUNCIL_DAYS = 14;

// Discovery is via a SHARED REGISTRY — never by walking /home.
//
// Agent homes are 0700 by design: SELF.md is private and must never be readable by a
// sibling. So any discovery that scans /home either silently finds nothing (each agent
// sees only itself -> a permanent fleet of one) or requires tearing down the very
// privacy wall the system rests on. Both are wrong. Instead agents announce themselves
// in the shared fleet dir — the one place they're already permitted to meet.
export function registerSelf(name, fleetDir = SHARED_FLEET_DIR) {
  try {
    const registry = path.join(fleetDir, "agents");
    fs.mkdirSync(registry, { recursive: true });
    fs.writeFileSync(path.join(registry, name), new Date().toISOString() + "\n");
    return true;
  } catch {
    return false; // solo agent, no shared dir — a fleet of one
  }
}

export function discoverAgents(fleetDir = SHARED_FLEET_DIR) {
  try {
    return fs
      .readdirSync(path.join(fleetDir, "agents"))
      .filter((f) => !f.startsWith("."))
      .sort()
      .map((name) => ({ name }));
  } catch {
    return [];
  }
}

// A lone agent keeps a private fleet. The moment a sibling registers, they SHARE one —
// automatically. Adding a 10th agent joins the existing fleet with zero config.
export function resolveFleetDir() {
  if (process.env.SENTO_FLEET_DIR) return process.env.SENTO_FLEET_DIR;
  // If the shared registry is reachable and has siblings, we're part of a fleet.
  const shared = discoverAgents(SHARED_FLEET_DIR);
  if (shared.length > 1) return SHARED_FLEET_DIR;
  // Can we even join one? (writable /srv means we're on a shared box.)
  try {
    fs.mkdirSync(path.join(SHARED_FLEET_DIR, "agents"), { recursive: true });
    return SHARED_FLEET_DIR;
  } catch {
    return path.join(os.homedir(), "sento-fleet");
  }
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
export function shouldRunCouncil(myName, { date = new Date(), fleetDir } = {}) {
  const dir0 = fleetDir || resolveFleetDir();
  registerSelf(myName, dir0);
  const agents = discoverAgents(dir0);
  if (agents.length <= 1) return false; // a fleet of one has nothing to curate

  const dir = dir0;
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
export function fleetHealth(myName) {
  const fleetDir = resolveFleetDir();
  registerSelf(myName, fleetDir);
  const agents = discoverAgents(fleetDir);
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
