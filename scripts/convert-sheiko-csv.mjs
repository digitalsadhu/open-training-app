import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_INPUT = '/Users/richard.walker@m10s.io/Documents/sheiko_program.csv';
const DEFAULT_OUTPUT = path.resolve('sheiko_program_planned.json');

const usage = () => `
Usage:
  npm run convert:sheiko -- [input.csv] [output.json]

Defaults:
  input:  ${DEFAULT_INPUT}
  output: ${DEFAULT_OUTPUT}
`.trim();

const parseArgs = argv => {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage());
    process.exit(0);
  }

  return {
    inputPath: argv[0] ? path.resolve(argv[0]) : DEFAULT_INPUT,
    outputPath: argv[1] ? path.resolve(argv[1]) : DEFAULT_OUTPUT
  };
};

const splitCsvLine = line => {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ';' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
};

const liftKeyFor = name => {
  const normalized = String(name || '').toLowerCase();
  if (normalized.includes('squat')) return 'squat';
  if (normalized.includes('bench')) return 'bench';
  if (normalized.includes('deadlift')) return 'deadlift';
  return normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
};

const muscleGroupsFor = name => {
  const normalized = String(name || '').toLowerCase();
  if (normalized.includes('squat')) return ['Legs', 'Glutes'];
  if (normalized.includes('bench')) return ['Chest', 'Arms'];
  if (normalized.includes('deadlift')) return ['Back', 'Legs', 'Glutes'];
  return ['Uncategorized'];
};

const parseScheme = value => {
  const match = String(value || '').match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) throw new Error(`Could not parse set scheme: "${value}"`);
  return { sets: Number(match[1]), reps: Number(match[2]) };
};

const parseWeight = value => {
  const match = String(value || '').match(/([0-9]+(?:\.[0-9]+)?)\s*kg/i);
  if (!match) throw new Error(`Could not parse weight: "${value}"`);
  return Number(match[1]);
};

const findWeekColumns = row =>
  row.flatMap((cell, column) => {
    const match = String(cell || '').match(/^Week\s+(\d+)$/i);
    return match ? [{ column, week: Number(match[1]) }] : [];
  });

const convertRows = rows => {
  const programName = (rows[0]?.[0] || 'Sheiko Program').trim();
  const sessions = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const weekColumns = findWeekColumns(rows[rowIndex] || []);
    if (weekColumns.length === 0) continue;

    const dayRow = rows[rowIndex + 1] || [];
    for (const { column: weekColumn, week } of weekColumns) {
      for (let offset = 0; offset < 3; offset += 1) {
        const column = weekColumn + offset;
        const dayMatch = String(dayRow[column] || '').match(/^Day\s+(\d+)$/i);
        if (!dayMatch) continue;

        const day = Number(dayMatch[1]);
        const entries = [];

        for (let exerciseRow = rowIndex + 2; exerciseRow < rows.length; exerciseRow += 3) {
          const name = rows[exerciseRow]?.[column] || '';
          const scheme = rows[exerciseRow + 1]?.[column] || '';
          const weight = rows[exerciseRow + 2]?.[column] || '';

          if (!name && !scheme && !weight) break;
          if (!name || !scheme || !weight) continue;

          const { sets, reps } = parseScheme(scheme);
          const targetWeight = parseWeight(weight);
          entries.push({
            name,
            liftKey: liftKeyFor(name),
            setType: 'reps_weight',
            muscleGroups: muscleGroupsFor(name),
            sets: Array.from({ length: sets }, () => ({
              targetReps: reps,
              targetWeight
            }))
          });
        }

        if (entries.length > 0) {
          sessions.push({
            id: `week-${week}-day-${day}`,
            week,
            day,
            name: `Week ${week} Day ${day}`,
            entries
          });
        }
      }
    }
  }

  sessions.sort((a, b) => a.week - b.week || a.day - b.day);
  if (sessions.length === 0) {
    throw new Error('No planned sessions were found. Expected rows containing "Week N" and "Day N" headings.');
  }

  return {
    programName,
    notes: 'Converted from Sheiko CSV. CSV weights are imported as explicit targetWeight values in kg.',
    durationWeeks: Math.max(...sessions.map(session => session.week)),
    loadRoundingKg: 2.5,
    sessions
  };
};

const main = async () => {
  const { inputPath, outputPath } = parseArgs(process.argv.slice(2));
  const csvText = await fs.readFile(inputPath, 'utf8');
  const rows = csvText.trimEnd().split(/\r?\n/).map(splitCsvLine);
  const program = convertRows(rows);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(program, null, 2)}\n`, 'utf8');

  console.log(`Wrote ${program.sessions.length} sessions to ${outputPath}`);
};

main().catch(error => {
  console.error(error?.message || String(error));
  process.exit(1);
});
