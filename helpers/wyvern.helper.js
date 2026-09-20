'use strict';

const solver = require('javascript-lp-solver');

const STATS = ['speed', 'acceleration', 'altitude', 'energy',
  'handling', 'toughness', 'boost', 'training'];

// Level-1 material bonuses, in the stat order above. Each item supplies 12
// limit points, split between its affected stats. Star quality does not change
// these bonuses. Higher-level materials are deliberately outside this model.
// Cross-checked against Wynnbreeder's app.js and the measured table at:
// https://forums.wynncraft.com/threads/mount-information-collection-thread.324089/
const MATERIALS = [
  { id: 'ingot', name: 'Copper Ingot',  points: [0, 0, 0, 4, 0, 8, 0, 0] },
  { id: 'gem',   name: 'Copper Gem',    points: [4, 0, 0, 2, 0, 0, 0, 6] },
  { id: 'wood',  name: 'Oak Wood',      points: [2, 6, 0, 0, 0, 4, 0, 0] },
  { id: 'paper', name: 'Oak Paper',     points: [0, 0, 8, 0, 0, 0, 4, 0] },
  { id: 'string',name: 'Wheat String',  points: [0, 2, 0, 0, 4, 0, 6, 0] },
  { id: 'grain', name: 'Wheat Grains',  points: [8, 0, 4, 0, 0, 0, 0, 0] },
  { id: 'oil',   name: 'Gudgeon Oil',   points: [0, 0, 2, 0, 6, 0, 0, 4] },
  { id: 'meat',  name: 'Gudgeon Meat',  points: [0, 4, 0, 8, 0, 0, 0, 0] },
];

// Input limits protect the bot from oversized or unreasonable requests.
// MAX_STAT is a calculator limit, not a claim about the game's maximum.
const MAX_JSON_LENGTH = 6000;
const MAX_STAT = 10000;
const SEARCH_MS = 250;
const isObject = value => value !== null && typeof value === 'object'
  && !Array.isArray(value);
const sum = values => values.reduce((total, value) => total + value, 0);

function parseWyvern(input) {
  if (typeof input !== 'string' || input.length > MAX_JSON_LENGTH) {
    throw new RangeError('Paste one wyvern export of at most 6,000 characters.');
  }

  // Accept a normal paste, Discord bold, inline code, or a JSON code block.
  let text = input.trim();
  if (text.startsWith('**') && text.endsWith('**')) text = text.slice(2, -2).trim();
  if (text.startsWith('```') && text.endsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  } else if (text.startsWith('`') && text.endsWith('`')) {
    text = text.slice(1, -1);
  }

  let raw;
  try { raw = JSON.parse(text); } catch {
    throw new RangeError('That is not valid JSON. Paste one complete wyvern export at a time.');
  }
  if (!isObject(raw) || raw.type !== 'wyvern' || !isObject(raw.stats)) {
    throw new RangeError('Paste a wyvern export containing type: "wyvern" and a stats object.');
  }
  if (Object.keys(raw.stats).some(key => !STATS.includes(key))) {
    throw new RangeError('This export contains an unsupported stat. Paste a wyvern export.');
  }

  const stats = {};
  const missing = [];
  for (const key of STATS) {
    if (!Object.hasOwn(raw.stats, key)) {
      // Some exports omit stats. Do not silently invent their values.
      missing.push(key);
      continue;
    }
    const stat = raw.stats[key];
    if (!isObject(stat) || ['value', 'limit', 'maxValue'].some(field =>
      !Number.isSafeInteger(stat[field]) || stat[field] < 0 || stat[field] > MAX_STAT)) {
      throw new RangeError(key + ': value, limit, and maxValue must be integers from 0 to 10,000.');
    }
    if (stat.value > stat.limit || stat.limit > stat.maxValue) {
      throw new RangeError(key + ': expected value <= limit <= maxValue. Copy the stats again.');
    }
    stats[key] = { value: stat.value, limit: stat.limit, maxValue: stat.maxValue };
  }
  if (missing.length === STATS.length) {
    throw new RangeError('The export contains no usable wyvern stats.');
  }

  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Wyvern',
    color: typeof raw.color === 'string' ? raw.color : null,
    potential: Number.isSafeInteger(raw.potential) && raw.potential >= 0
      && raw.potential <= MAX_STAT * STATS.length ? raw.potential : null,
    stats, missing,
  };
}

function suppliedBy(counts) {
  return STATS.map((_, stat) => MATERIALS.reduce(
    (total, material, i) => total + counts[i] * material.points[stat], 0));
}

// Build a valid starting plan. Also used if the optimization reaches its time
// limit without returning a usable whole-item solution.
function quickPlan(need) {
  let remaining = [...need];
  const counts = MATERIALS.map(() => 0);
  while (remaining.some(value => value > 0)) {
    const gains = MATERIALS.map(material => sum(
      material.points.map((points, i) => Math.min(points, remaining[i]))));
    const best = gains.indexOf(Math.max(...gains));
    counts[best]++;
    remaining = remaining.map((value, i) => Math.max(0, value - MATERIALS[best].points[i]));
  }
  return counts;
}

function calculateFeeding(wyvern) {
  // Feeding raises LIMITS. Training raises current values. The top-level
  // energy.value (e.g. 302/307 charge) is not the energy stat's feeding limit.
  const need = STATS.map(key => wyvern.stats[key]
    ? wyvern.stats[key].maxValue - wyvern.stats[key].limit : 0);
  let counts = quickPlan(need);
  let fallback = false;

  if (sum(need) > 0) {
    const model = {
      optimize: 'items', opType: 'min',
      constraints: {}, variables: {}, ints: {},
      options: { timeout: SEARCH_MS, tolerance: 0, exitOnCycles: true },
    };
    STATS.forEach((key, i) => { model.constraints[key] = { min: need[i] }; });
    for (const material of MATERIALS) {
      model.variables[material.id] = { items: 1 };
      STATS.forEach((key, i) => { model.variables[material.id][key] = material.points[i]; });
      model.ints[material.id] = 1; // A material count must be a whole number.
    }

    try {
      const result = solver.Solve(model);
      const values = MATERIALS.map(material => result[material.id] ?? 0);
      const candidate = values.map(value => Math.round(value));

      // Independently verify the result before showing it. Floating-point
      // solver output must never become negative, fractional, or insufficient.
      const valid = result.feasible && result.bounded
        && values.every((value, i) => Number.isFinite(value)
          && candidate[i] >= 0 && Number.isSafeInteger(candidate[i])
          && Math.abs(value - candidate[i]) < 0.000001)
        && suppliedBy(candidate).every((points, i) => points >= need[i]);
      if (valid && sum(candidate) <= sum(counts)) counts = candidate;
      else fallback = true;
    } catch {
      fallback = true;
    }
  }

  const supplied = suppliedBy(counts);
  return {
    need, supplied, total: sum(counts), fallback,
    materials: MATERIALS.map((material, i) => ({ ...material, count: counts[i] }))
      .filter(material => material.count > 0),
  };
}

module.exports = { STATS, MATERIALS, MAX_JSON_LENGTH, parseWyvern, calculateFeeding };