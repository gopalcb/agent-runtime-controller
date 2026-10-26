#!/usr/bin/env node
/** Transparently forward native Computer Use MCP; decorate successful coordinate-action frames.
 * The signed runtime stays intact. Never log tool arguments, typed text or screenshot data.
 */
import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { binary, directory, runtime, disabledPath, build } from './pointer.mjs';

const execute = promisify(execFile);
export function imageSize(block) {
  const bytes = Buffer.from(block.data, 'base64');
  if (block.mimeType === 'image/png' && bytes.length >= 24) return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let index = 2;
  while (index + 8 < bytes.length) {
    if (bytes[index++] !== 0xff) return null;
    const marker = bytes[index++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    const length = bytes.readUInt16BE(index);
    if (length < 2 || index + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return [bytes.readUInt16BE(index + 5), bytes.readUInt16BE(index + 3)];
    index += length;
  }
  return null;
}
export class PointerTracker {
  constructor() { this.points = new Map(); this.sizes = new Map(); }
  target(request, result) {
    if (result?.isError || !Array.isArray(result?.content)) return null;
    const app = request?.app;
    if (!app) return null;
    const firstImage = result.content.find(c => c.type === 'image');
    const size = firstImage && imageSize(firstImage);
    const previousSize = this.sizes.get(app);
    if (size) {
      if (previousSize && size.toString() !== previousSize.toString()) this.points.delete(app);
      this.sizes.set(app, size);
    }
    let point = this.points.get(app);
    if (request.name === 'click') {
      if (!Number.isFinite(request.x) || !Number.isFinite(request.y)) {
        // AX activation provides no location; suppress the marker instead of guessing.
        this.points.delete(app);
        return null;
      }
      point = { x: request.x, y: request.y, phase: 'click' };
    } else if (request.name === 'drag' && Number.isFinite(request.to_x) && Number.isFinite(request.to_y)) {
      point = { x: request.to_x, y: request.to_y, phase: 'click' };
    } else if (point) {
      point = { ...point, phase: ['press_key', 'type_text'].includes(request.name) ? 'keyboard' : 'idle' };
    }
    if (!point || !size || point.x < 0 || point.y < 0 || point.x >= size[0] || point.y >= size[1]) return null;
    this.points.set(app, point);
    return point;
  }
}
export async function enhanceResult(result, point, render = renderImage) {
  if (!point || result?.isError) return result;
  return { ...result, content: await Promise.all(result.content.map(c => c.type === 'image' ? render(c, point) : c)) };
}
export async function renderImage(block, point) {
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  const temp = await mkdtemp(join(runtime, 'frame-'));
  try {
    const input = join(temp, 'input.image');
    const output = join(temp, 'output.png');
    await writeFile(input, Buffer.from(block.data, 'base64'), { mode: 0o600 });
    await execute(binary, ['render', input, output, String(point.x), String(point.y), point.phase, '--png'], { timeout: 5000 });
    const image = await readFile(output);
    return { ...block, mimeType: 'image/png', data: image.toString('base64') };
  } finally { await rm(temp, { recursive: true, force: true }); }
}
export function requestMetadata(message) {
  if (message.method !== 'tools/call') return null;
  const args = message.params?.arguments ?? {};
  // Explicit allowlist: no key contents, typed text, selections or other payloads retained.
  return { name: message.params?.name, app: args.app, x: args.x, y: args.y, to_x: args.to_x, to_y: args.to_y };
}
export async function runProxy() {
  if (!existsSync(binary)) build();
  const codexHome = process.env.CODEX_HOME || resolve(directory, '../../..');
  const native = spawn(join(codexHome, 'local-plugins/computer-use/bin/computer-use-client-launcher'), ['mcp'], { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });
  const requests = new Map();
  const tracker = new PointerTracker();
  let sequence = Promise.resolve();
  let frameNumber = 0;
  const input = createInterface({ input: process.stdin });
  input.on('line', line => {
    try {
      const message = JSON.parse(line);
      const metadata = requestMetadata(message);
      if (metadata && message.id !== undefined) requests.set(message.id, metadata);
    } catch { /* Forward protocol errors to the native server unchanged. */ }
    native.stdin.write(`${line}\n`);
  });
  createInterface({ input: native.stdout }).on('line', line => {
    sequence = sequence.then(async () => {
      let message;
      try { message = JSON.parse(line); } catch { process.stdout.write(`${line}\n`); return; }
      const request = requests.get(message.id);
      requests.delete(message.id);
      if (request && message.result) {
        const point = tracker.target(request, message.result);
        if (!existsSync(disabledPath) && point) {
          try {
            message.result = await enhanceResult(message.result, point);
            const capture = process.env.UI_POINTER_CAPTURE_DIR;
            if (capture) {
              await mkdir(capture, { recursive: true, mode: 0o700 });
              for (const image of message.result.content.filter(c => c.type === 'image')) {
                await writeFile(join(capture, `pointer-${String(++frameNumber).padStart(4, '0')}.png`), Buffer.from(image.data, 'base64'), { mode: 0o600, flag: 'wx' });
              }
            }
          } catch {
            // Rendering/export failure must not break a successful native action.
            process.stderr.write('Blue pointer frame enhancement/export unavailable; native result preserved where rendering failed.\n');
          }
        }
      }
      process.stdout.write(`${JSON.stringify(message)}\n`);
    }).catch(() => { process.stderr.write('Blue pointer response forwarding failed.\n'); process.stdout.write(`${line}\n`); });
  });
  input.on('close', () => native.stdin.end());
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { native.kill(signal); });
  native.on('error', () => { process.stderr.write('Unable to start the native Computer Use server.\n'); process.exit(1); });
  native.on('close', code => { sequence.finally(() => process.exit(code ?? 0)); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runProxy().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
