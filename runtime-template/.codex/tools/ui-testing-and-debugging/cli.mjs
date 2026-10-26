#!/usr/bin/env node
/** Gate requirements and journal agent-observed Computer Use cycles; never drives the GUI itself. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateRequirements, validateCycle, assess } from './validation.mjs';

const home = dirname(fileURLToPath(import.meta.url));
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
const fingerprint = r => createHash('sha256').update(JSON.stringify(r)).digest('hex');

export function main(args) {
  const [command, target, input] = args;
  if (!target || !['init', 'check', 'start', 'record', 'status'].includes(command)) throw new Error('Usage: node cli.mjs init RUN_DIR | check REQUIREMENTS.json | start RUN_DIR REQUIREMENTS.json | record RUN_DIR CYCLE.json | status RUN_DIR');
  const directory = resolve(target);
  if (command === 'init') {
    mkdirSync(directory, { recursive: true });
    save(join(directory, 'requirements.json'), read(join(home, 'templates/requirements.json')));
    return { status: 'DRAFT', next: 'Fill requirements.json, then check and start a new run directory.' };
  }
  if (command === 'check') return { status: 'READY', requirements: validateRequirements(read(directory)).project };
  if (command === 'start') {
    if (!input) throw new Error('requirements path required');
    const r = validateRequirements(read(resolve(input)));
    mkdirSync(directory, { recursive: true });
    save(join(directory, 'run.json'), { requirements: r, fingerprint: fingerprint(r), startedAt: new Date().toISOString() });
    return { status: 'NOT_TESTED', next: 'Read docs/testing.md and docs/debugging.md; preflight Computer Use and gather evidence.' };
  }
  const run = read(join(directory, 'run.json'));
  const r = validateRequirements(run.requirements);
  if (run.fingerprint !== fingerprint(r)) throw new Error('requirements changed: start a new run');
  const files = readdirSync(directory).filter(f => /^cycle-\d{4}\.json$/.test(f)).sort();
  const cycles = files.map(f => {
    const c = read(join(directory, f));
    if (c.fingerprint !== run.fingerprint) throw new Error('cycle requirements fingerprint mismatch');
    return validateCycle(c, r, directory);
  });
  if (command === 'record') {
    if (!input) throw new Error('cycle path required');
    const cycle = validateCycle(read(resolve(input)), r, directory);
    if (cycles.length && Date.parse(cycle.observedAt) <= Date.parse(cycles.at(-1).observedAt)) throw new Error('each cycle needs a later observation time; do not submit the same pass twice');
    save(join(directory, `cycle-${String(files.length + 1).padStart(4, '0')}.json`), { ...cycle, fingerprint: run.fingerprint, recordedAt: new Date().toISOString() });
    cycles.push(cycle);
  }
  const status = assess(cycles, r.cleanPasses);
  return { status, project: r.project, revision: r.appRevision, cycles: cycles.length, requiredCleanPasses: r.cleanPasses };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = main(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
    if (['UNSTABLE', 'BLOCKED', 'NOT_TESTED', 'RETEST_REQUIRED'].includes(result.status)) process.exitCode = 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
