#!/usr/bin/env node
/** Build/control the local blue overlay without changing OS pointer preferences. */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const directory = dirname(fileURLToPath(import.meta.url));
export const runtime = join(directory, '.runtime');
export const binary = join(runtime, 'PointerOverlay');
const pidPath = join(runtime, 'desktop.pid');
export const disabledPath = join(runtime, 'disabled');

export function build() {
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const result = spawnSync('/usr/bin/swiftc', ['-O', join(directory, 'PointerOverlay.swift'), '-o', binary], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Swift compilation failed');
  return binary;
}
function processRunning() {
  if (!existsSync(pidPath)) return null;
  const pid = Number(readFileSync(pidPath, 'utf8'));
  if (!Number.isInteger(pid) || pid <= 0) return null;
  // Check identity as well as PID to avoid terminating a reused unrelated process.
  const check = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  return check.status === 0 && check.stdout.trim() === `${binary} desktop` ? pid : null;
}
export function control(command) {
  if (command === 'build') return { binary: build() };
  if (!['on', 'off', 'status'].includes(command)) throw new Error('Usage: node pointer.mjs build|on|off|status');
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  let pid = processRunning();
  if (command === 'on') {
    if (!existsSync(binary)) build();
    if (existsSync(disabledPath)) unlinkSync(disabledPath);
    if (!pid) {
      const fd = openSync(join(runtime, 'desktop.log'), 'a', 0o600);
      try {
        const child = spawn(binary, ['desktop'], { detached: true, stdio: ['ignore', fd, fd] });
        child.on('error', error => console.error(error.message));
        child.unref();
        pid = child.pid;
        if (!pid) throw new Error('Desktop overlay did not start');
        writeFileSync(pidPath, String(pid), { mode: 0o600 });
      } finally { closeSync(fd); }
    }
  }
  if (command === 'off') {
    writeFileSync(disabledPath, 'disabled\n', { mode: 0o600 });
    if (pid) process.kill(pid, 'SIGTERM');
    if (existsSync(pidPath)) unlinkSync(pidPath);
    pid = null;
  }
  return { desktop: pid ? 'running' : 'stopped', pid, computerUseFrames: existsSync(disabledPath) ? 'disabled' : 'enabled on wrapped MCP connections', reconnect: 'Existing native MCP connections must reconnect to use the wrapper.' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(control(process.argv[2]), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
