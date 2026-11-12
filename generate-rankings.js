import { readFile, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const archivePath = process.argv[2];
if (!archivePath) {
  console.error('Usage: node generate-rankings.js path/to/data_pack.zip');
  process.exit(2);
}

function extractZipEntry(zip, requestedName) {
  const endMin = Math.max(0, zip.length - 65_557);
  let end = -1;
  for (let offset = zip.length - 22; offset >= endMin; offset--) {
    if (zip.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw new Error('Invalid ZIP: end record not found');
  const count = zip.readUInt16LE(end + 10);
  let cursor = zip.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP directory');
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    if (name === requestedName) {
      if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Invalid ZIP entry: ${name}`);
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = zip.subarray(dataOffset, dataOffset + compressedSize);
      if (method === 0) return compressed.toString('utf8');
      if (method === 8) return inflateRawSync(compressed).toString('utf8');
      throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`Missing data file in ZIP: ${requestedName}`);
}

function* csvRows(text) {
  const lines = text.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  for (let lineNumber = 1; lineNumber < lines.length; lineNumber++) {
    const line = lines[lineNumber];
    if (!line) continue;
    const values = parseCsvLine(line);
    const row = Object.create(null);
    headers.forEach((header, index) => { row[header] = values[index] ?? ''; });
    yield row;
  }
}

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { value += '"'; i++; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === ',' && !quoted) {
      values.push(value); value = '';
    } else if (char === '"' && value === '') quoted = true;
    else value += char;
  }
  values.push(value);
  return values;
}

const zip = await readFile(archivePath);
const matches = new Map();
for (const row of csvRows(extractZipEntry(zip, 'Data Pack/matches.csv'))) {
  matches.set(row.match_id, {
    firstOvers: numberOrNull(row.first_inn_revised_overs),
    secondOvers: numberOrNull(row.second_inn_revised_overs),
    revisedTarget: numberOrNull(row.revised_target),
  });
}
const competitions = new Map();
for (const row of csvRows(extractZipEntry(zip, 'Data Pack/competitions.csv'))) {
  competitions.set(row.comp_id, row.match_format);
}

const deliveries = [];
let sequence = 0;
for (const row of csvRows(extractZipEntry(zip, 'Data Pack/ball_by_ball.csv'))) {
  const innings = numberOrNull(row.innings);
  const match = matches.get(row.match_id);
  if ((innings !== 1 && innings !== 2) || !match) continue;
  const extras = (row.extras_type || '').trim().toLowerCase();
  const runs = numberOrNull(row.runs) ?? 0;
  const extraOne = numberOrNull(row.extras1_runs) ?? 0;
  const extraTwo = numberOrNull(row.extras_2_runs) ?? 0;
  const teamRuns = runs + extraOne + extraTwo;
  const wicket = String(row.is_wicket).toLowerCase() === 'true';
  const legal = extras !== 'wide' && extras !== 'overstep';
  deliveries.push({
    matchId: row.match_id, innings, match,
    inningsBall: numberOrNull(row.innings_ball_num) ?? 0,
    overId: numberOrNull(row.overid) ?? 0,
    overBall: numberOrNull(row.over_ball_num) ?? 0,
    sequence: sequence++, extras, legal, faced: extras !== 'wide',
    strikerId: numberOrNull(row.striker_id), striker: row.striker_name,
    bowlerId: numberOrNull(row.bowler_id), bowler: row.bowler_name,
    runs, teamRuns,
    wicket,
    batterOut: wicket && numberOrNull(row.dismissed_player_id) === numberOrNull(row.striker_id),
    bowlerWicket: wicket && !new Set(['runout', 'retire out', 'retired hurt', 'obstracting the field', 'obstructing the field']).has((row.dismissal_type || '').toLowerCase()),
    bowlerRuns: teamRuns - (['byes', 'legbyes', 'penalty'].includes(extras) ? extraOne + extraTwo : 0),
  });
}

deliveries.sort((a, b) => Number(a.matchId) - Number(b.matchId) || a.innings - b.innings || a.inningsBall - b.inningsBall || a.overId - b.overId || a.overBall - b.overBall || a.sequence - b.sequence);
const firstTotals = new Map();
for (const delivery of deliveries) {
  if (delivery.innings === 1) firstTotals.set(delivery.matchId, (firstTotals.get(delivery.matchId) ?? 0) + delivery.teamRuns);
}

let currentMatch = '';
let currentInnings = 0;
let legalBefore = 0;
let wicketsBefore = 0;
let runsBefore = 0;
const matchIds = new Set();
let pressureDeliveries = 0;
for (const delivery of deliveries) {
  if (delivery.matchId !== currentMatch || delivery.innings !== currentInnings) {
    currentMatch = delivery.matchId;
    currentInnings = delivery.innings;
    legalBefore = 0; wicketsBefore = 0; runsBefore = 0;
  }
  matchIds.add(delivery.matchId);
  const allocation = Math.min(delivery.innings === 1 ? delivery.match.firstOvers ?? 120 : delivery.match.secondOvers ?? 120, 120);
  const ballsLeft = Math.max(allocation - legalBefore, 0);
  const wicketsLeft = Math.max(10 - wicketsBefore, 0);
  const target = delivery.innings === 2 && delivery.match.revisedTarget !== null
    ? delivery.match.revisedTarget : (firstTotals.get(delivery.matchId) ?? 0) + 1;
  const rrr = ballsLeft === 0 ? Number.NaN : (target - runsBefore) * 6 / ballsLeft;
  const deathPhase = legalBefore >= Math.max(allocation - 30, 0);
  delivery.pressure = delivery.innings === 2
    ? rrr >= 9 || (legalBefore >= 60 && wicketsLeft <= 5) || deathPhase
    : deathPhase && wicketsLeft <= 5;
  if (delivery.pressure) pressureDeliveries++;
  if (delivery.legal) legalBefore++;
  if (delivery.wicket) wicketsBefore++;
  runsBefore += delivery.teamRuns;
}

function playerRows(role) {
  const batting = role === 'batters';
  const records = new Map();
  for (const d of deliveries) {
    const id = batting ? d.strikerId : d.bowlerId;
    const name = batting ? d.striker : d.bowler;
    const counts = batting ? d.faced : d.legal;
    if (id === null || !Number.isFinite(id) || !counts || !name) continue;
    let row = records.get(id);
    if (!row) {
      row = { player_id: id, player: name, ordinary_balls: 0, pressure_balls: 0, ordinary_runs: 0, pressure_runs: 0, ordinary_wickets: 0, pressure_wickets: 0, matches: new Set(), pressure_matches_set: new Set() };
      records.set(id, row);
    }
    row.matches.add(d.matchId);
    const pressure = d.pressure;
    const key = pressure ? 'pressure' : 'ordinary';
    row[`${key}_balls`]++;
    row[`${key}_runs`] += batting ? d.runs : d.bowlerRuns;
    row[`${key}_wickets`] += batting ? Number(d.batterOut) : Number(d.bowlerWicket);
    if (pressure) row.pressure_matches_set.add(d.matchId);
  }
  const minOrdinary = batting ? 200 : 180;
  const rows = [...records.values()].map((row) => {
    const { pressure_balls: pn, ordinary_balls: on } = row;
    const pressure_rate = pn ? (row.pressure_runs / pn) * (batting ? 100 : 6) : null;
    const ordinary_rate = on ? (row.ordinary_runs / on) * (batting ? 100 : 6) : null;
    const pressure_wicket_rate = pn ? row.pressure_wickets / pn * 100 : null;
    const ordinary_wicket_rate = on ? row.ordinary_wickets / on * 100 : null;
    const pressureMatches = row.pressure_matches_set.size;
    const eligible = pn >= 60 && on >= minOrdinary && pressureMatches >= 8;
    const raw = batting
      ? (pressure_rate - ordinary_rate) - .6 * (pressure_wicket_rate - ordinary_wicket_rate)
      : (ordinary_rate - pressure_rate) * (100 / 6) + .6 * (pressure_wicket_rate - ordinary_wicket_rate);
    const rawAdvantage = pn && on ? raw : null;
    const score = rawAdvantage === null ? null : rawAdvantage * pn / (pn + 60);
    return {
      player_id: row.player_id, player: row.player,
      rank: null, eligible,
      eligibility_note: eligible ? 'Qualified sample' : `Needs ${Math.max(60 - pn, 0)} pressure balls, ${Math.max(minOrdinary - on, 0)} ordinary balls, and ${Math.max(8 - pressureMatches, 0)} pressure matches`,
      ordinary_balls: on, pressure_balls: pn,
      ordinary_rate, pressure_rate,
      ordinary_wicket_rate, pressure_wicket_rate,
      raw_advantage: rawAdvantage, adjusted_score: score,
      matches: row.matches.size, pressure_matches: pressureMatches,
    };
  });
  rows.sort((a, b) => {
    if (a.eligible !== b.eligible) return Number(b.eligible) - Number(a.eligible);
    if (a.eligible) return b.adjusted_score - a.adjusted_score || b.pressure_balls - a.pressure_balls;
    return b.pressure_balls - a.pressure_balls || b.ordinary_balls - a.ordinary_balls || a.player.localeCompare(b.player);
  });
  let rank = 0;
  for (const row of rows) if (row.eligible) row.rank = ++rank;
  return rows;
}

const batters = playerRows('batters');
const bowlers = playerRows('bowlers');
const rankings = { batters, bowlers };
const summary = {
  matches: matchIds.size,
  pressureDeliveries,
  eligibleBatters: batters.filter(row => row.eligible).length,
  eligibleBowlers: bowlers.filter(row => row.eligible).length,
  totalBatters: batters.length,
  totalBowlers: bowlers.length,
};
await writeFile(resolve(ROOT, 'data', 'rankings.json'), `${JSON.stringify(rankings)}\n`);
await writeFile(resolve(ROOT, 'data', 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

for (const [kind, rows] of [['batter', batters], ['bowler', bowlers]]) {
  const csvRows = rows.map(({ pressure_matches_set, ...row }) => row);
  const keys = Object.keys(csvRows[0]);
  const escape = value => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  await writeFile(resolve(ROOT, `${kind}_leaderboard.csv`), `${[keys.join(','), ...csvRows.map(row => keys.map(key => escape(row[key])).join(','))].join('\n')}\n`);
  const top = rows.filter(row => row.eligible).slice(0, 10);
  await writeFile(resolve(ROOT, `${kind}_top10.csv`), `${[keys.join(','), ...top.map(row => keys.map(key => escape(row[key])).join(','))].join('\n')}\n`);
}

console.log(`Built all-player directory: ${batters.length} batters (${summary.eligibleBatters} qualified), ${bowlers.length} bowlers (${summary.eligibleBowlers} qualified).`);

function numberOrNull(value) {
  if (value === undefined || value === null || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
