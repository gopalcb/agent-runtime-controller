import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../cli.mjs';
import { assess, validateRequirements, validateCycle } from '../validation.mjs';

const requirements = () => ({
  project: 'fixture', scope: 'local button and feedback', appRevision: 'abc123',
  baseUrl: 'http://127.0.0.1:4200', startCommand: 'npm start', testData: 'no account; refresh resets',
  designBaseline: 'centered card with no overflow', cleanPasses: 2,
  viewports: [{ name: 'desktop', width: 1440, height: 900 }],
  scenarios: ['visual', 'flow', 'keyboard', 'console', 'network'].map(kind => ({
    id: kind, kind, startState: 'fresh reload', actions: `inspect ${kind}`, expected: 'matches contract', viewports: ['desktop'],
  })),
});
const cycle = () => ({ driver: 'computer-use', revision: 'abc123', observedAt: new Date().toISOString(), openDefects: [],
  results: requirements().scenarios.map(s => ({ scenario: s.id, viewport: 'desktop', status: 'PASS', actual: 'observed contract', evidence: ['observation.md'] })),
});

test('gate rejects unresolved requirements, duplicate IDs, invalid dimensions and missing coverage', () => {
  assert.doesNotThrow(() => validateRequirements(requirements()));
  for (const mutate of [r => r.scope = 'TODO', r => r.viewports[0].width = 0, r => r.scenarios.pop(), r => r.scenarios[1].id = 'visual', r => r.cleanPasses = 1]) {
    const r = requirements(); mutate(r); assert.throws(() => validateRequirements(r));
  }
});
test('stability needs two clean cycles, latest blocker/failure and open defects override success', () => {
  const c = cycle();
  assert.equal(assess([], 2), 'NOT_TESTED');
  assert.equal(assess([c], 2), 'RETEST_REQUIRED');
  assert.equal(assess([c, c], 2), 'STABLE');
  const failed = cycle(); failed.results[0].status = 'FAIL';
  assert.equal(assess([c, c, failed], 2), 'UNSTABLE');
  assert.equal(assess([failed, c], 2), 'RETEST_REQUIRED');
  const blocked = cycle(); blocked.results[0].status = 'BLOCKED';
  assert.equal(assess([c, c, blocked], 2), 'BLOCKED');
  const defects = cycle(); defects.openDefects.push('unfixed alignment');
  assert.equal(assess([c, defects], 2), 'UNSTABLE');
  const na = cycle(); na.results.forEach(r => r.status = 'NA');
  assert.notEqual(assess([na, na], 2), 'STABLE');
});
test('journal freezes requirements and verifies complete evidence and matching revisions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ui-journal-'));
  try {
    const config = join(dir, 'requirements.json');
    const input = join(dir, 'input.json');
    writeFileSync(config, JSON.stringify(requirements()));
    assert.equal(main(['check', config]).status, 'READY');
    assert.equal(main(['start', dir, config]).status, 'NOT_TESTED');
    assert.throws(() => main(['start', dir, config]), /EEXIST/);
    const c = cycle();
    assert.throws(() => validateCycle(c, requirements(), dir), /evidence/);
    writeFileSync(join(dir, 'observation.md'), 'Sanitized observed outcomes');
    assert.doesNotThrow(() => validateCycle(c, requirements(), dir));
    const incomplete = cycle(); incomplete.results.pop();
    assert.throws(() => validateCycle(incomplete, requirements(), dir), /every scenario/);
    const changed = cycle(); changed.revision = 'new-source';
    assert.throws(() => validateCycle(changed, requirements(), dir), /revision differs/);
    const escaped = cycle(); escaped.results[0].evidence = ['../outside'];
    assert.throws(() => validateCycle(escaped, requirements(), dir), /evidence/);
    writeFileSync(input, JSON.stringify(c));
    assert.equal(main(['record', dir, input]).status, 'RETEST_REQUIRED');
    assert.throws(() => main(['record', dir, input]), /later observation time/);
    c.observedAt = new Date(Date.parse(c.observedAt) + 1000).toISOString();
    writeFileSync(input, JSON.stringify(c));
    assert.equal(main(['record', dir, input]).status, 'STABLE');
    const blocked = cycle(); blocked.results[0].status = 'BLOCKED';
    blocked.observedAt = new Date(Date.parse(c.observedAt) + 1000).toISOString();
    writeFileSync(input, JSON.stringify(blocked));
    assert.equal(main(['record', dir, input]).status, 'BLOCKED');
    const run = JSON.parse(readFileSync(join(dir, 'run.json'))); run.requirements.appRevision = 'edited';
    writeFileSync(join(dir, 'run.json'), JSON.stringify(run));
    assert.throws(() => main(['status', dir]), /requirements changed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
