#!/usr/bin/env node
/**
 * fetch-data.mjs
 *
 * Downloads and strips PokeAPI data into public/data/ for static serving.
 * Run with:  node scripts/fetch-data.mjs
 *
 * Re-running is safe — existing files are skipped unless --force is passed.
 * Use --force to re-fetch everything, or --force=pokemon to re-fetch one type.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../public/data");
const BASE = "https://pokeapi.co/api/v2";
const CONCURRENCY = 10; // parallel requests at once
const RETRY_LIMIT = 3;
const RETRY_DELAY_MS = 1000;

const forceArg = process.argv.find((a) => a.startsWith("--force"));
const FORCE = forceArg != null;
const FORCE_TYPE = forceArg?.includes("=") ? forceArg.split("=")[1] : null;

// ─── Utilities ────────────────────────────────────────────────────────────────

function shouldForce(type) {
  if (!FORCE) return false;
  if (!FORCE_TYPE) return true;
  return FORCE_TYPE === type;
}

async function fetchJson(url, attempt = 1) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return await res.json();
  } catch (err) {
    if (attempt < RETRY_LIMIT) {
      await sleep(RETRY_DELAY_MS * attempt);
      return fetchJson(url, attempt + 1);
    }
    throw err;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function save(relPath, data) {
  const full = path.join(OUT, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(data));
}

function exists(relPath) {
  return fs.existsSync(path.join(OUT, relPath));
}

/** Run tasks with limited concurrency, showing a progress bar. */
async function pool(label, items, fn) {
  let done = 0;
  const total = items.length;
  const errors = [];

  function printProgress() {
    process.stdout.write(`\r  ${label}: ${done}/${total}`);
  }

  printProgress();

  const queue = [...items];
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      try {
        await fn(item);
      } catch (err) {
        errors.push({ item, err });
      }
      done++;
      printProgress();
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write(`\r  ${label}: ${done}/${total} ✓\n`);

  if (errors.length > 0) {
    console.warn(`  ⚠ ${errors.length} errors in ${label}:`);
    for (const { item, err } of errors.slice(0, 5)) {
      console.warn(`    ${String(item).slice(0, 60)}: ${err.message}`);
    }
  }
}

function extractId(url) {
  const m = url.match(/\/(\d+)\/?$/);
  return m ? m[1] : null;
}

// Only keep version groups that Porylist actually uses — drops ~60% of vgd entries
const SUPPORTED_VERSION_GROUPS = new Set([
  "red-blue", "yellow",
  "gold-silver", "crystal",
  "ruby-sapphire", "emerald", "firered-leafgreen", "colosseum", "xd",
  "diamond-pearl", "platinum", "heartgold-soulsilver",
  "black-white", "black-2-white-2",
  "x-y", "omega-ruby-alpha-sapphire",
  "sun-moon", "ultra-sun-ultra-moon", "lets-go-pikachu-lets-go-eevee",
  "sword-shield", "brilliant-diamond-and-shining-pearl", "legends-arceus",
  "scarlet-violet",
]);

// ─── Strip functions ───────────────────────────────────────────────────────────

function stripPokemon(p) {
  return {
    id: p.id,
    name: p.name,
    height: p.height,
    weight: p.weight,
    types: p.types.map((t) => ({
      slot: t.slot,
      type: { name: t.type.name },
    })),
    past_types: (p.past_types ?? []).map((pt) => ({
      generation: { name: pt.generation.name },
      types: pt.types.map((t) => ({
        slot: t.slot,
        type: { name: t.type.name },
      })),
    })),
    stats: p.stats.map((s) => ({
      base_stat: s.base_stat,
      effort: s.effort,
      stat: { name: s.stat.name },
    })),
    abilities: p.abilities.map((a) => ({
      ability: { name: a.ability.name },
      is_hidden: a.is_hidden,
      slot: a.slot,
    })),
    moves: p.moves
      .map((m) => ({
        move: { name: m.move.name },
        version_group_details: m.version_group_details
          .filter((vgd) => SUPPORTED_VERSION_GROUPS.has(vgd.version_group.name))
          .map((vgd) => ({
            level_learned_at: vgd.level_learned_at,
            move_learn_method: { name: vgd.move_learn_method.name },
            version_group: { name: vgd.version_group.name },
          })),
      }))
      .filter((m) => m.version_group_details.length > 0),
    species: { name: p.species.name },
  };
}

function stripSpecies(s) {
  return {
    capture_rate: s.capture_rate,
    base_happiness: s.base_happiness,
    growth_rate: { name: s.growth_rate.name },
    gender_rate: s.gender_rate,
    color: { name: s.color.name },
    is_baby: s.is_baby,
    is_legendary: s.is_legendary,
    is_mythical: s.is_mythical,
    evolves_from_species: s.evolves_from_species
      ? { name: s.evolves_from_species.name }
      : null,
    genera: s.genera.map((g) => ({
      genus: g.genus,
      language: { name: g.language.name },
    })),
    egg_groups: s.egg_groups.map((eg) => ({ name: eg.name })),
    flavor_text_entries: s.flavor_text_entries.map((ft) => ({
      flavor_text: ft.flavor_text,
      language: { name: ft.language.name },
      version: { name: ft.version.name },
    })),
    evolution_chain: { url: s.evolution_chain.url },
  };
}

function stripForm(f) {
  return {
    id: f.id,
    name: f.name,
    form_name: f.form_name,
    is_default: f.is_default,
    is_mega: f.is_mega,
    version_group: f.version_group ? { name: f.version_group.name } : null,
    names: (f.names ?? []).map((n) => ({
      name: n.name,
      language: { name: n.language.name },
    })),
    // Also include types/stats/abilities so forms work correctly
    types: (f.types ?? []).map((t) => ({
      slot: t.slot,
      type: { name: t.type.name },
    })),
    stats: (f.stats ?? []).map((s) => ({
      base_stat: s.base_stat,
      effort: s.effort,
      stat: { name: s.stat.name },
    })),
    abilities: (f.abilities ?? []).map((a) => ({
      ability: { name: a.ability.name },
      is_hidden: a.is_hidden,
      slot: a.slot,
    })),
    past_types: (f.past_types ?? []).map((pt) => ({
      generation: { name: pt.generation.name },
      types: pt.types.map((t) => ({
        slot: t.slot,
        type: { name: t.type.name },
      })),
    })),
  };
}

function stripMove(m) {
  return {
    id: m.id,
    name: m.name,
    type: { name: m.type.name },
    damage_class: { name: m.damage_class.name },
    power: m.power,
    accuracy: m.accuracy,
    pp: m.pp,
    effect_chance: m.effect_chance,
    effect_entries: (m.effect_entries ?? [])
      .filter((e) => e.language.name === "en")
      .map((e) => ({
        short_effect: e.short_effect,
        language: { name: e.language.name },
      })),
    flavor_text_entries: (m.flavor_text_entries ?? [])
      .filter((e) => e.language.name === "en")
      .map((e) => ({
        flavor_text: e.flavor_text,
        language: { name: e.language.name },
        version_group: { name: e.version_group.name },
      })),
    names: (m.names ?? [])
      .filter((n) => n.language.name === "en")
      .map((n) => ({
        name: n.name,
        language: { name: n.language.name },
      })),
    machines: (m.machines ?? []).map((mc) => ({
      machine: { url: mc.machine.url },
      version_group: { name: mc.version_group.name },
    })),
  };
}

function stripAbility(a) {
  return {
    id: a.id,
    name: a.name,
    effect_entries: (a.effect_entries ?? [])
      .filter((e) => e.language.name === "en")
      .map((e) => ({
        short_effect: e.short_effect,
        language: { name: e.language.name },
      })),
    flavor_text_entries: (a.flavor_text_entries ?? [])
      .filter((e) => e.language.name === "en")
      .map((e) => ({
        flavor_text: e.flavor_text,
        language: { name: e.language.name },
        version_group: { name: e.version_group.name },
      })),
  };
}

function stripMachine(m) {
  return {
    item: { name: m.item.name },
    move: { name: m.move.name },
  };
}

function stripEvolutionChain(ec) {
  function stripLink(link) {
    return {
      species: { name: link.species.name, url: link.species.url },
      evolution_details: (link.evolution_details ?? []).map((d) => ({
        trigger: { name: d.trigger.name },
        min_level: d.min_level,
        item: d.item ? { name: d.item.name } : null,
        held_item: d.held_item ? { name: d.held_item.name } : null,
        min_happiness: d.min_happiness,
        min_beauty: d.min_beauty,
        min_affection: d.min_affection,
        time_of_day: d.time_of_day,
        known_move: d.known_move ? { name: d.known_move.name } : null,
        known_move_type: d.known_move_type ? { name: d.known_move_type.name } : null,
        location: d.location ? { name: d.location.name } : null,
        gender: d.gender,
        needs_overworld_rain: d.needs_overworld_rain,
        relative_physical_stats: d.relative_physical_stats,
        trade_species: d.trade_species ? { name: d.trade_species.name } : null,
        turn_upside_down: d.turn_upside_down,
      })),
      evolves_to: (link.evolves_to ?? []).map(stripLink),
    };
  }
  return { chain: stripLink(ec.chain) };
}

function stripEncounters(list) {
  return list.map((e) => ({
    location_area: { name: e.location_area.name },
    version_details: (e.version_details ?? []).map((vd) => ({
      encounter_details: (vd.encounter_details ?? []).map((ed) => ({
        chance: ed.chance,
        condition_values: (ed.condition_values ?? []).map((cv) => ({ name: cv.name })),
        max_level: ed.max_level,
        method: { name: ed.method.name },
        min_level: ed.min_level,
      })),
      version: { name: vd.version.name },
    })),
  }));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🔄 Porylist data fetcher\n");
  fs.mkdirSync(OUT, { recursive: true });

  // ── 1. Full Pokémon list ───────────────────────────────────────────────────
  console.log("📋 Fetching Pokémon list...");
  const listPath = "pokemon.json";
  let list;
  if (!exists(listPath) || shouldForce("list")) {
    list = await fetchJson(`${BASE}/pokemon?limit=10000&offset=0`);
    save(listPath, { count: list.count, results: list.results.map((r) => ({ name: r.name, url: r.url })) });
    console.log(`  Saved ${list.results.length} entries\n`);
  } else {
    list = JSON.parse(fs.readFileSync(path.join(OUT, listPath), "utf8"));
    console.log(`  Skipped (${list.results.length} entries already cached)\n`);
  }

  // All base-form names (id ≤ 10000, i.e. no alternate-form variants in the main list)
  const baseNames = list.results
    .filter((r) => {
      const id = extractId(r.url);
      return id && Number(id) <= 10000;
    })
    .map((r) => r.name);

  // ── 2. Pokémon details ─────────────────────────────────────────────────────
  console.log("🐾 Fetching Pokémon details...");
  const pokemonData = {};

  await pool("pokemon", baseNames, async (name) => {
    const filePath = `pokemon/${name}.json`;
    if (!exists(filePath) || shouldForce("pokemon")) {
      const raw = await fetchJson(`${BASE}/pokemon/${name}`);
      const stripped = stripPokemon(raw);
      save(filePath, stripped);
      pokemonData[name] = stripped;
    } else {
      pokemonData[name] = JSON.parse(fs.readFileSync(path.join(OUT, filePath), "utf8"));
    }
  });
  console.log();

  // Collect unique sets from pokemon data
  const speciesNames = new Set();
  const moveNames = new Set();
  const abilityNames = new Set();
  const formNames = new Set();

  for (const p of Object.values(pokemonData)) {
    speciesNames.add(p.species.name);
    for (const m of p.moves) moveNames.add(m.move.name);
    for (const a of p.abilities) abilityNames.add(a.ability.name);
  }

  // ── 3. Pokémon species ─────────────────────────────────────────────────────
  console.log("📖 Fetching species data...");
  const evolutionChainUrls = new Set();

  await pool("species", [...speciesNames], async (name) => {
    const filePath = `pokemon-species/${name}.json`;
    if (!exists(filePath) || shouldForce("species")) {
      const raw = await fetchJson(`${BASE}/pokemon-species/${name}`);
      const stripped = stripSpecies(raw);
      save(filePath, stripped);
      evolutionChainUrls.add(stripped.evolution_chain.url);
    } else {
      const cached = JSON.parse(fs.readFileSync(path.join(OUT, filePath), "utf8"));
      evolutionChainUrls.add(cached.evolution_chain.url);
    }
  });
  console.log();

  // ── 4. Encounters ──────────────────────────────────────────────────────────
  console.log("🗺  Fetching encounter data...");

  await pool("encounters", baseNames, async (name) => {
    // Encounters are keyed by pokemon ID
    const pkmn = pokemonData[name];
    if (!pkmn) return;
    const filePath = `pokemon/${pkmn.id}/encounters.json`;
    if (!exists(filePath) || shouldForce("encounters")) {
      const raw = await fetchJson(`${BASE}/pokemon/${pkmn.id}/encounters`);
      save(filePath, stripEncounters(raw));
    }
  });
  console.log();

  // ── 5. Alternate forms ─────────────────────────────────────────────────────
  // Collect form names from the all-entries list (entries with id > 10000 are forms)
  console.log("🔀 Fetching alternate form data...");
  const allEntries = await fetchJson(`${BASE}/pokemon?limit=10000&offset=0`);
  const altForms = allEntries.results.filter((r) => {
    const id = extractId(r.url);
    return id && Number(id) > 10000;
  });

  await pool("forms", altForms, async ({ name }) => {
    const filePath = `pokemon/${name}.json`;
    if (!exists(filePath) || shouldForce("forms")) {
      const raw = await fetchJson(`${BASE}/pokemon/${name}`);
      const stripped = stripPokemon(raw);
      save(filePath, stripped);
      formNames.add(name);
    }
  });

  // Also fetch pokemon-form metadata for alternate forms
  await pool("form-meta", altForms, async ({ name }) => {
    const filePath = `pokemon-form/${name}.json`;
    if (!exists(filePath) || shouldForce("forms")) {
      try {
        const raw = await fetchJson(`${BASE}/pokemon-form/${name}`);
        save(filePath, stripForm(raw));
      } catch {
        // Some forms don't have a /pokemon-form/ entry — skip silently
      }
    }
  });

  // Also fetch form metadata for base pokemon (needed for mega/regional display)
  await pool("form-meta-base", baseNames, async (name) => {
    const filePath = `pokemon-form/${name}.json`;
    if (!exists(filePath) || shouldForce("forms")) {
      try {
        const raw = await fetchJson(`${BASE}/pokemon-form/${name}`);
        save(filePath, stripForm(raw));
      } catch {
        // skip
      }
    }
  });
  console.log();

  // ── 6. Moves ───────────────────────────────────────────────────────────────
  console.log("⚔️  Fetching move data...");
  const machineUrls = new Set();

  await pool("moves", [...moveNames], async (name) => {
    const filePath = `move/${name}.json`;
    if (!exists(filePath) || shouldForce("moves")) {
      const raw = await fetchJson(`${BASE}/move/${name}`);
      const stripped = stripMove(raw);
      save(filePath, stripped);
      for (const mc of stripped.machines) machineUrls.add(mc.machine.url);
    } else {
      const cached = JSON.parse(fs.readFileSync(path.join(OUT, filePath), "utf8"));
      for (const mc of cached.machines) machineUrls.add(mc.machine.url);
    }
  });
  console.log();

  // ── 7. Abilities ───────────────────────────────────────────────────────────
  console.log("✨ Fetching ability data...");

  await pool("abilities", [...abilityNames], async (name) => {
    const filePath = `ability/${name}.json`;
    if (!exists(filePath) || shouldForce("abilities")) {
      const raw = await fetchJson(`${BASE}/ability/${name}`);
      save(filePath, stripAbility(raw));
    }
  });
  console.log();

  // ── 8. Machines (TM/HM) ───────────────────────────────────────────────────
  console.log("💿 Fetching machine (TM/HM) data...");

  await pool("machines", [...machineUrls], async (url) => {
    const id = extractId(url);
    if (!id) return;
    const filePath = `machine/${id}.json`;
    if (!exists(filePath) || shouldForce("machines")) {
      const raw = await fetchJson(url);
      save(filePath, stripMachine(raw));
    }
  });
  console.log();

  // ── 9. Evolution chains ────────────────────────────────────────────────────
  console.log("🔗 Fetching evolution chains...");

  await pool("evolution-chains", [...evolutionChainUrls], async (url) => {
    const id = extractId(url);
    if (!id) return;
    const filePath = `evolution-chain/${id}.json`;
    if (!exists(filePath) || shouldForce("evolution")) {
      const raw = await fetchJson(url);
      save(filePath, stripEvolutionChain(raw));
    }
  });
  console.log();

  // ── Done ───────────────────────────────────────────────────────────────────
  console.log("✅ All data fetched!\n");

  // Print summary of what was written
  function countFiles(dir) {
    const full = path.join(OUT, dir);
    if (!fs.existsSync(full)) return 0;
    return fs.readdirSync(full, { recursive: true }).filter((f) => f.endsWith(".json")).length;
  }

  const totalSize = getFolderSize(OUT);
  console.log("📊 Summary:");
  console.log(`  Pokémon:          ${countFiles("pokemon")} files`);
  console.log(`  Species:          ${countFiles("pokemon-species")} files`);
  console.log(`  Forms:            ${countFiles("pokemon-form")} files`);
  console.log(`  Moves:            ${countFiles("move")} files`);
  console.log(`  Abilities:        ${countFiles("ability")} files`);
  console.log(`  Machines:         ${countFiles("machine")} files`);
  console.log(`  Evolution chains: ${countFiles("evolution-chain")} files`);
  console.log(`  Total size:       ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
}

function getFolderSize(dir) {
  let size = 0;
  try {
    for (const entry of fs.readdirSync(dir, { recursive: true })) {
      try {
        const stat = fs.statSync(path.join(dir, entry));
        if (stat.isFile()) size += stat.size;
      } catch {}
    }
  } catch {}
  return size;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
