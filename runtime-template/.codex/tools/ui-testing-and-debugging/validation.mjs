/** Requirement and evidence validation for the Computer Use run journal. */
import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const requiredKinds = ['visual', 'flow', 'keyboard', 'console', 'network'];
export function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || /TODO|TBD|REPLACE/i.test(value)) {
    throw new Error(`${label} must be explicit and nonempty (no placeholders)`);
  }
}
export function validateRequirements(r) {
  for (const key of ['project', 'scope', 'appRevision', 'startCommand', 'testData', 'designBaseline']) text(r[key], key);
  const url = new URL(r.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('baseUrl must be HTTP(S)');
  if (!Array.isArray(r.viewports) || !r.viewports.length) throw new Error('viewports required');
  const names = new Set();
  for (const v of r.viewports) {
    text(v.name, 'viewport name');
    if (names.has(v.name)) throw new Error('duplicate viewport');
    names.add(v.name);
    if (![v.width, v.height].every(n => Number.isInteger(n) && n > 0)) throw new Error('viewport dimensions must be positive integers');
  }
  if (!Array.isArray(r.scenarios) || !r.scenarios.length) throw new Error('scenarios required');
  const ids = new Set();
  for (const s of r.scenarios) {
    for (const key of ['id', 'kind', 'startState', 'actions', 'expected']) text(s[key], `scenario ${key}`);
    if (ids.has(s.id)) throw new Error('duplicate scenario id');
    ids.add(s.id);
    if (!requiredKinds.includes(s.kind)) throw new Error('unknown scenario kind');
    if (!Array.isArray(s.viewports) || !s.viewports.length || new Set(s.viewports).size !== s.viewports.length || s.viewports.some(v => !names.has(v))) throw new Error('scenario needs known, unique viewports');
  }
  for (const kind of requiredKinds) if (!r.scenarios.some(s => s.kind === kind)) throw new Error(`missing ${kind} scenario; describe N/A expectation explicitly if inapplicable`);
  if (!Number.isInteger(r.cleanPasses) || r.cleanPasses < 2) throw new Error('cleanPasses must be an integer >= 2');
  return r;
}
export function validateCycle(c, r, directory) {
  if (c.driver !== 'computer-use') throw new Error('driver must be computer-use; supplementary checks are separate');
  text(c.revision, 'revision');
  if (c.revision !== r.appRevision) throw new Error('cycle revision differs from requirements');
  text(c.observedAt, 'observedAt');
  if (!Number.isFinite(Date.parse(c.observedAt))) throw new Error('observedAt must be a date');
  if (!Array.isArray(c.openDefects) || c.openDefects.some(d => typeof d !== 'string' || !d.trim())) throw new Error('openDefects must be an array of descriptions');
  if (!Array.isArray(c.results)) throw new Error('results required');
  const expected = r.scenarios.flatMap(s => s.viewports.map(v => `${s.id}@${v}`));
  const seen = new Set();
  for (const result of c.results) {
    const key = `${result.scenario}@${result.viewport}`;
    if (!expected.includes(key) || seen.has(key)) throw new Error(`unknown or duplicate result ${key}`);
    seen.add(key);
    if (!['PASS', 'FAIL', 'BLOCKED', 'NA'].includes(result.status)) throw new Error('invalid result status');
    text(result.actual, 'actual outcome or N/A reason');
    if (!Array.isArray(result.evidence) || !result.evidence.length) throw new Error(`evidence required for ${key}`);
    for (const file of result.evidence) {
      text(file, 'evidence path');
      const path = resolve(directory, file);
      if (isAbsolute(file) || relative(directory, path).startsWith('..') || !existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0 || relative(realpathSync(directory), realpathSync(path)).startsWith('..')) throw new Error(`evidence must be a nonempty file inside run: ${file}`);
    }
  }
  if (seen.size !== expected.length) throw new Error('every scenario/viewport needs a result, including blocked checks');
  return c;
}
export function assess(cycles, cleanPasses) {
  if (!cycles.length) return 'NOT_TESTED';
  const latest = cycles.at(-1);
  if (latest.results.some(r => r.status === 'FAIL') || latest.openDefects.length) return 'UNSTABLE';
  if (latest.results.some(r => r.status === 'BLOCKED')) return 'BLOCKED';
  const clean = c => !c.openDefects.length && c.results.every(r => r.status === 'PASS' || r.status === 'NA') && c.results.some(r => r.status === 'PASS');
  return cycles.length >= cleanPasses && cycles.slice(-cleanPasses).every(clean) ? 'STABLE' : 'RETEST_REQUIRED';
}
