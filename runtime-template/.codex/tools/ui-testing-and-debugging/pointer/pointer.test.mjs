import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PointerTracker, enhanceResult, requestMetadata, imageSize } from './mcp-proxy.mjs';

function result(width = 1174, height = 768) {
  const png = Buffer.alloc(24);
  png.writeUInt32BE(width, 16); png.writeUInt32BE(height, 20);
  return { content: [{ type: 'text', text: 'Native accessibility tree' }, { type: 'image', mimeType: 'image/png', data: png.toString('base64') }] };
}
test('coordinate click and drag track precise per-app position; keyboard pulses retain target only', () => {
  const tracker = new PointerTracker();
  assert.equal(tracker.target({ name: 'get_app_state', app: 'Chrome' }, result()), null);
  assert.deepEqual(tracker.target({ name: 'click', app: 'Chrome', x: 444, y: 482 }, result()), { x: 444, y: 482, phase: 'click' });
  assert.deepEqual(tracker.target({ name: 'press_key', app: 'Chrome' }, result()), { x: 444, y: 482, phase: 'keyboard' });
  assert.equal(tracker.target({ name: 'press_key', app: 'Safari' }, result()), null);
  assert.deepEqual(tracker.target({ name: 'drag', app: 'Chrome', to_x: 600, to_y: 500 }, result()), { x: 600, y: 500, phase: 'click' });
});
test('AX-only clicks, resized capture and out-of-bounds targets do not invent coordinates', () => {
  const tracker = new PointerTracker();
  tracker.target({ name: 'click', app: 'Chrome', x: 444, y: 482 }, result());
  assert.equal(tracker.target({ name: 'click', app: 'Chrome' }, result()), null);
  assert.equal(tracker.target({ name: 'get_app_state', app: 'Chrome' }, result()), null);
  tracker.target({ name: 'click', app: 'Chrome', x: 444, y: 482 }, result());
  assert.equal(tracker.target({ name: 'get_app_state', app: 'Chrome' }, result(390, 844)), null);
  assert.equal(tracker.target({ name: 'click', app: 'Chrome', x: -1, y: 0 }, result()), null);
});
test('error results and unmarked results pass through unchanged; image transforms preserve text', async () => {
  const native = result();
  assert.equal(await enhanceResult(native, null), native);
  const error = { isError: true, content: native.content };
  assert.equal(await enhanceResult(error, { x: 1, y: 1 }), error);
  const converted = await enhanceResult(native, { x: 1, y: 1 }, async c => ({ ...c, data: 'rendered' }));
  assert.deepEqual(converted.content[0], native.content[0]);
  assert.equal(converted.content[1].data, 'rendered');
  assert.notEqual(native.content[1].data, 'rendered');
});
test('metadata drops keystroke contents and typed text; PNG dimensions are read', () => {
  const meta = requestMetadata({ method: 'tools/call', params: { name: 'type_text', arguments: { app: 'Chrome', text: 'private text', key: 'private shortcut' } } });
  assert.ok(!JSON.stringify(meta).includes('private'));
  assert.deepEqual(imageSize(result().content[1]), [1174, 768]);
  assert.equal(requestMetadata({ method: 'initialize' }), null);
});
