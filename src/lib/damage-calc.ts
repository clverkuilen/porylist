/**
 * Pokémon damage formula (Gen 6+ baseline).
 *
 * Damage = ((((2L/5 + 2) * Power * (Atk/Def)) / 50) + 2) * Mods
 *
 * Mods (applied multiplicatively, in spec order):
 *   Targets * Weather * Critical * RandomRoll(0.85–1.00)
 *   * STAB * TypeEffectiveness * Burn * Other (screens, items)
 *
 * This implementation is intentionally simplified for a UI calculator:
 *   - Base stats only (no EVs/IVs/nature inputs)
 *   - Single-target moves (no spread reduction)
 *   - A small whitelist of common modifiers (weather, screens, burn,
 *     a handful of items)
 *   - No abilities, no Z-moves/Tera/Dynamax
 */

import { computeTypeEffectiveness } from "@/lib/type-chart";

export interface DamageStats {
  /** Base stat for the relevant offensive stat (atk for physical, spa for special) */
  offense: number;
  /** Base stat for the relevant defensive stat (def for physical, spd for special) */
  defense: number;
}

export type Weather = "none" | "sun" | "rain" | "sand" | "snow";

export interface DamageInput {
  level: number;
  /** Move base power. Use 0 for status moves. */
  power: number;
  /** "physical" | "special" — status moves return 0 damage. */
  category: "physical" | "special" | "status";
  /** Move's type (lowercase: "fire", "water", …) */
  moveType: string;
  /** Attacker's types (for STAB) */
  attackerTypes: string[];
  /** Defender's types (for effectiveness) */
  defenderTypes: string[];
  /** Attacker offense + defender defense base stats */
  stats: DamageStats;
  /** Stat-stage boost on the offensive stat, –6…+6 */
  offenseBoost?: number;
  /** Stat-stage boost on the defensive stat, –6…+6 */
  defenseBoost?: number;
  /** Critical hit (Gen 6+: 1.5×, ignores defense boost) */
  critical?: boolean;
  /** Burn halves physical damage (except Guts users — not modeled) */
  burned?: boolean;
  weather?: Weather;
  /** Reflect (physical) or Light Screen (special) up */
  screen?: boolean;
  /** Item slug, drawn from a small whitelist below */
  attackerItem?: string;
  defenderItem?: string;
  /** Calculation generation (only affects critical hit multiplier). Defaults 9. */
  generation?: number;
}

export interface DamageResult {
  minDamage: number;
  maxDamage: number;
  /** Effectiveness multiplier (e.g. 2.0, 0.5, 0). */
  effectiveness: number;
  /** True if STAB was applied. */
  stab: boolean;
  /** Step-by-step modifier breakdown for the "show your work" view. */
  modifierLines: Array<{ label: string; value: number }>;
}

// Stat boost: standard stage multiplier table
function stageMultiplier(stage: number): number {
  const s = Math.max(-6, Math.min(6, stage | 0));
  if (s >= 0) return (2 + s) / 2;
  return 2 / (2 - s);
}

const ITEM_BOOSTS: Record<string, { attackerMul?: number; type?: string }> = {
  "life-orb":     { attackerMul: 1.3 },
  "choice-band":  { attackerMul: 1.5 },     // physical-only — the UI surfaces this
  "choice-specs": { attackerMul: 1.5 },     // special-only
  "muscle-band":  { attackerMul: 1.1 },
  "wise-glasses": { attackerMul: 1.1 },
  "expert-belt":  { attackerMul: 1.2 },     // technically only when SE, simplified
  "charcoal":          { attackerMul: 1.2, type: "fire" },
  "mystic-water":      { attackerMul: 1.2, type: "water" },
  "miracle-seed":      { attackerMul: 1.2, type: "grass" },
  "magnet":            { attackerMul: 1.2, type: "electric" },
  "never-melt-ice":    { attackerMul: 1.2, type: "ice" },
  "black-belt":        { attackerMul: 1.2, type: "fighting" },
  "poison-barb":       { attackerMul: 1.2, type: "poison" },
  "soft-sand":         { attackerMul: 1.2, type: "ground" },
  "sharp-beak":        { attackerMul: 1.2, type: "flying" },
  "twisted-spoon":     { attackerMul: 1.2, type: "psychic" },
  "silver-powder":     { attackerMul: 1.2, type: "bug" },
  "hard-stone":        { attackerMul: 1.2, type: "rock" },
  "spell-tag":         { attackerMul: 1.2, type: "ghost" },
  "dragon-fang":       { attackerMul: 1.2, type: "dragon" },
  "black-glasses":     { attackerMul: 1.2, type: "dark" },
  "metal-coat":        { attackerMul: 1.2, type: "steel" },
  "silk-scarf":        { attackerMul: 1.2, type: "normal" },
};

export const ATTACKER_ITEMS = Object.keys(ITEM_BOOSTS);

export function calculateDamage(input: DamageInput): DamageResult {
  const {
    level, power, category, moveType, attackerTypes, defenderTypes, stats,
    offenseBoost = 0, defenseBoost = 0,
    critical = false, burned = false, weather = "none", screen = false,
    attackerItem, generation = 9,
  } = input;

  const lines: Array<{ label: string; value: number }> = [];

  if (category === "status" || power <= 0) {
    return { minDamage: 0, maxDamage: 0, effectiveness: 1, stab: false, modifierLines: lines };
  }

  // Effective stats with stages
  // Critical hits ignore the defender's positive boosts and the attacker's negative boosts.
  const effOffenseStage = critical && offenseBoost < 0 ? 0 : offenseBoost;
  const effDefenseStage = critical && defenseBoost > 0 ? 0 : defenseBoost;
  const effOffense = stats.offense * stageMultiplier(effOffenseStage);
  const effDefense = stats.defense * stageMultiplier(effDefenseStage);

  // Base damage
  const base = Math.floor(
    Math.floor(((2 * level) / 5 + 2) * power * (effOffense / effDefense)) / 50,
  ) + 2;

  // STAB
  const stab = attackerTypes.includes(moveType);
  const stabMul = stab ? 1.5 : 1;
  if (stab) lines.push({ label: "STAB", value: 1.5 });

  // Type effectiveness
  const effMap = computeTypeEffectiveness(defenderTypes, generation);
  const effectiveness = effMap[moveType] ?? 1;
  if (effectiveness !== 1) lines.push({ label: `Type (${effectivenessLabel(effectiveness)})`, value: effectiveness });

  // Critical hit — Gen 6+ is 1.5×, Gen 2–5 was 2×, Gen 1 used a separate formula we ignore.
  const critMul = critical ? (generation >= 6 ? 1.5 : 2) : 1;
  if (critical) lines.push({ label: `Critical (×${critMul})`, value: critMul });

  // Burn
  const burnMul = burned && category === "physical" ? 0.5 : 1;
  if (burnMul !== 1) lines.push({ label: "Burn", value: burnMul });

  // Weather: Sun ×1.5 Fire / ×0.5 Water (and vice versa for Rain).
  let weatherMul = 1;
  if (weather === "sun"  && moveType === "fire")  weatherMul = 1.5;
  if (weather === "sun"  && moveType === "water") weatherMul = 0.5;
  if (weather === "rain" && moveType === "water") weatherMul = 1.5;
  if (weather === "rain" && moveType === "fire")  weatherMul = 0.5;
  if (weatherMul !== 1) lines.push({ label: `Weather (${weather})`, value: weatherMul });

  // Screens halve damage (assume single-battle, no Aurora Veil distinction)
  const screenMul = screen && !critical ? 0.5 : 1;
  if (screenMul !== 1) lines.push({ label: "Screen", value: screenMul });

  // Items — only multipliers, and type-specific items only when the move matches
  let itemMul = 1;
  if (attackerItem && ITEM_BOOSTS[attackerItem]) {
    const item = ITEM_BOOSTS[attackerItem];
    if (item.attackerMul) {
      const typeOk = !item.type || item.type === moveType;
      // Skip Choice Band for special, Choice Specs for physical
      const categoryOk =
        (attackerItem !== "choice-band"  || category === "physical") &&
        (attackerItem !== "choice-specs" || category === "special");
      if (typeOk && categoryOk) {
        itemMul = item.attackerMul;
        lines.push({ label: `Item (${attackerItem})`, value: itemMul });
      }
    }
  }

  const totalMul = stabMul * effectiveness * critMul * burnMul * weatherMul * screenMul * itemMul;
  const finalBase = base * totalMul;

  // Random roll 0.85 – 1.00, in 16 increments. We just report min/max.
  return {
    minDamage: Math.max(effectiveness === 0 ? 0 : 1, Math.floor(finalBase * 0.85)),
    maxDamage: Math.max(effectiveness === 0 ? 0 : 1, Math.floor(finalBase * 1.0)),
    effectiveness,
    stab,
    modifierLines: lines,
  };
}

export function effectivenessLabel(mult: number): string {
  if (mult === 0) return "no effect";
  if (mult >= 4) return "4×";
  if (mult >= 2) return "2×";
  if (mult <= 0.25) return "¼×";
  if (mult <= 0.5) return "½×";
  return "1×";
}

/** "OHKO", "2HKO", … based on the maximum-roll fraction of defender HP. */
export function knockoutLabel(maxDamage: number, defenderHp: number): { label: string; chance: "guaranteed" | "possible" | "no" } {
  if (defenderHp <= 0) return { label: "—", chance: "no" };
  const pctMax = (maxDamage / defenderHp) * 100;
  if (pctMax >= 100) return { label: "OHKO", chance: "guaranteed" };
  if (pctMax >= 50) return { label: "2HKO", chance: pctMax >= 100 ? "guaranteed" : "possible" };
  if (pctMax >= 33.34) return { label: "3HKO", chance: "possible" };
  if (pctMax >= 25) return { label: "4HKO", chance: "possible" };
  if (pctMax >= 20) return { label: "5HKO", chance: "possible" };
  return { label: `${Math.ceil(100 / pctMax)}HKO`, chance: "possible" };
}
