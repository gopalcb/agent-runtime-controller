'use strict';
/** Install an actual npm tarball into a disposable consumer and clean up every owned process. */
const assert = require('node:assert/strict');
const {execFile} = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const {promisify} = require('node:util');

const execute = promisify(execFile);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const tarball = path.resolve(process.argv[2] || 'gb-systems-visual-agent-builder-0.2.0.tgz');
const port = Number(process.env.RUNTIME_CONTROLLER_TEST_PORT || 14333);
const origin = `http://127.0.0.1:${port}`;

async function getJson(route) {
  const response = await fetch(`${origin}/api${route}`, {signal: AbortSignal.timeout(3000)});
  assert.equal(response.status, 200, `${route}: ${await response.clone().text()}`);
  return response.json();
}

async function assertFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise(resolve => server.close(resolve));
}

async function auditTarball() {
  const script = `import hashlib,json,sys,tarfile
with tarfile.open(sys.argv[1]) as package:
    names=set(package.getnames())
    manifest=json.load(package.extractfile('package/runtime-template/manifest.json'))
    invalid=[]
    for entry in manifest['files']:
        name='package/runtime-template/.codex/'+entry['path']
        if name not in names or hashlib.sha256(package.extractfile(name).read()).hexdigest()!=entry['sha256']:
            invalid.append(entry['path'])
    print(json.dumps({'invalid':invalid,'bytecode':[name for name in names if '__pycache__' in name or name.endswith('.pyc')],'entries':len(manifest['files'])}))
`;
  const {stdout} = await execute('python3', ['-c', script, tarball]);
  const audit = JSON.parse(stdout);
  assert.deepEqual(audit.invalid, [], 'Tarball must contain every manifest payload with its declared hash');
  assert.deepEqual(audit.bytecode, [], 'Tarball must not include local Python bytecode');
  return audit.entries;
}

async function waitForInstallation(project, owned) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const identity = await getJson('/identity');
    assert.equal(identity.service, 'runtime-controller');
    assert.equal(identity.version, '0.2.0');
    assert.equal(await fs.realpath(identity.project.root), project);
    owned.add(identity.pid);
    const bootstrap = await getJson('/bootstrap');
    const installation = bootstrap.installation;
    if (installation.ownerPid) owned.add(installation.ownerPid);
    if (installation.status === 'failed') throw new Error(`Installation failed: ${installation.error}`);
    if (installation.status === 'completed') return bootstrap;
    await delay(250);
  }
  throw new Error('Consumer installation did not complete within 120 seconds');
}

async function running(pid) {
  try {
    const {stdout} = await execute('ps', ['-p', String(pid), '-o', 'stat=']);
    return stdout.trim() !== '' && !stdout.trim().startsWith('Z');
  } catch (error) {
    if (error.code === 1) return false;
    throw error;
  }
}

async function cleanup(project, owned) {
  try {
    const identity = await getJson('/identity');
    if (await fs.realpath(identity.project.root) === project) owned.add(identity.pid);
  } catch { /* An already-stopped owned controller needs no action. */ }
  for (const pid of owned) {
    if (!await running(pid)) continue;
    const {stdout} = await execute('ps', ['-p', String(pid), '-o', 'command=']);
    assert.ok(stdout.includes(project) && (stdout.includes('visual-agent-builder.cjs') || stdout.includes('-m installer')),
      `Refusing to stop a process outside the fixture: ${pid}`);
    process.kill(pid, 'SIGTERM');
    for (let attempt = 0; attempt < 50 && await running(pid); attempt++) await delay(100);
    if (await running(pid)) {
      process.kill(pid, 'SIGKILL');
      for (let attempt = 0; attempt < 20 && await running(pid); attempt++) await delay(100);
    }
    assert.equal(await running(pid), false, `Owned process ${pid} remains alive`);
  }
  await fs.rm(project, {recursive: true, force: true});
}

async function main() {
  await fs.access(tarball);
  const templateEntries = await auditTarball();
  await assertFreePort();
  const project = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-controller-consumer-')));
  const owned = new Set();
  const environment = {...process.env, RUNTIME_CONTROLLER_NO_OPEN: '1', RUNTIME_CONTROLLER_PORT: String(port),
    RUNTIME_CONTROLLER_SKIP_SETUP: '0', RUNTIME_CONTROLLER_CHILD: '0', PYTHONDONTWRITEBYTECODE: '1',
    TMPDIR: path.join(project, '.tmp')};
  let report;
  try {
    await fs.mkdir(environment.TMPDIR);
    await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({name: 'runtime-controller-consumer-fixture',
      version: '1.0.0', private: true, overrides: {multer: '2.5.0'}}, null, 2));
    console.log('Installing tarball with real postinstall:', path.basename(tarball));
    const install = await execute('npm', ['install', '--foreground-scripts', '--ignore-scripts=false', '--no-fund', '--audit=false', tarball],
      {cwd: project, env: environment, timeout: 180000, maxBuffer: 4 * 1024 * 1024});
    assert.ok(install.stdout.includes('installer.bootstrap') || install.stdout.includes('controller/install'), 'Postinstall did not report its installation URL');
    const bootstrap = await waitForInstallation(project, owned);
    assert.equal(bootstrap.installation.progress, 100);
    assert.equal(bootstrap.installation.steps.find(step => step.id === 'browser').status, 'completed');
    const receipt = JSON.parse(await fs.readFile(path.join(project, '.codex/runtime-controller/launcher.json'), 'utf8'));
    assert.equal(receipt.port, port);
    for (const relative of ['AGENTS.md', '.agents/skills/python-development/SKILL.md', '.codex/runtime-controller/codex.py',
      '.codex/runtime-controller/memory/index.md', '.codex/tools/project_memory/memory.py']) {
      assert.ok((await fs.stat(path.join(project, relative))).isFile(), `Missing ${relative}`);
    }
    const packageRoot = path.join(project, 'node_modules/@gb-systems/visual-agent-builder');
    const ensureArgs = ['-m', 'installer.ensure', '--project', project, '--port', String(port), '--no-open'];
    const ensured = await Promise.all(Array.from({length: 3}, () => execute('python3', ensureArgs,
      {cwd: packageRoot, env: environment, timeout: 15000})));
    const identities = ensured.map(result => JSON.parse(result.stdout).identity);
    assert.ok(identities.every(identity => identity.pid === identities[0].pid));
    assert.ok(owned.has(identities[0].pid));
    const other = path.join(project, 'other-project');
    await fs.mkdir(other);
    const registered = await execute('python3', ['-m', 'installer.ensure', '--project', other, '--port', String(port), '--no-open'],
      {cwd: packageRoot, env: environment, timeout: 15000});
    assert.equal(JSON.parse(registered.stdout).active, false);
    assert.equal((await getJson('/identity')).project.root, project);
    const after = await getJson('/bootstrap');
    assert.ok(after.projects.some(item => item.root === other), 'Other project was not registered');
    const ui = await fetch(`${origin}/controller/install`);
    assert.equal(ui.status, 200);
    assert.ok((await ui.text()).includes('<app-root>'));
    const multer = JSON.parse(await fs.readFile(path.join(project, 'node_modules/multer/package.json'), 'utf8'));
    assert.equal(multer.version, '2.5.0');
    let audit;
    try {
      audit = await execute('npm', ['audit', '--omit=dev', '--json'], {cwd: project, env: environment, timeout: 60000, maxBuffer: 4 * 1024 * 1024});
    } catch (error) {
      if (typeof error.stdout !== 'string' || !error.stdout.trim().startsWith('{')) throw error;
      audit = error;
    }
    const findings = JSON.parse(audit.stdout);
    assert.ok(findings.metadata?.vulnerabilities, `Audit did not complete: ${JSON.stringify(findings.error)}`);
    report = {tarball: path.basename(tarball), version: '0.2.0', templateEntries, installation: bootstrap.installation.status,
      managedFiles: Object.keys(JSON.parse(await fs.readFile(path.join(project, '.codex/runtime-controller/managed.json'), 'utf8')).files).length,
      port, singletonPid: identities[0].pid, otherProjectRegisteredWithoutSwitch: true,
      browser: 'verified executable present', multer: multer.version, audit: findings.metadata.vulnerabilities};
  } finally {
    await cleanup(project, owned);
    console.log('Owned consumer processes stopped and temporary project removed.');
  }
  console.log(JSON.stringify({...report, cleanup: 'verified'}, null, 2));
}

main().catch(error => {console.error(error.stack || error); process.exitCode = 1;});
