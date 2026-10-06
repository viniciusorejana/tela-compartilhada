const { test } = require('node:test');
const assert = require('node:assert/strict');
const media = require('../public/media-utils');

test('video elements never receive audio, and repeated updates retain their stream', () => {
  class Stream { constructor(tracks) { this.tracks = tracks; } getTracks() { return this.tracks; } }
  const video = { kind: 'video', readyState: 'live' };
  const audio = { kind: 'audio', readyState: 'live' };
  const element = { srcObject: null, setAttribute() {} };
  const stream = { getTracks: () => [video, audio], getVideoTracks: () => [video] };
  assert.equal(media.bindVideo(element, stream, Stream), true);
  assert.deepEqual(element.srcObject.getTracks(), [video]);
  assert.equal(element.muted, true);
  assert.equal(element.playsInline, true);
  const bound = element.srcObject;
  assert.equal(media.bindVideo(element, stream, Stream), false);
  assert.equal(element.srcObject, bound);
  video.readyState = 'ended';
  media.bindVideo(element, stream, Stream);
  assert.equal(element.srcObject, null);
});

test('local host invites use the configured public origin without query tokens', () => {
  assert.equal(media.inviteUrl('http://localhost:3000/abcd/sala?secret=1', 'https://example.com', 'abcd'), 'https://example.com/abcd/sala');
  assert.equal(media.inviteUrl('https://example.com/sala', '', 'principal'), 'https://example.com/principal/sala');
  assert.throws(() => media.inviteUrl('https://example.com', 'javascript:alert(1)', 'abcd'));
});

// The media server takes a codec by name. "auto" must resolve to something it accepts, and
// an unknown value must not reach it — a rejected publish means no image at all.
test('every codec choice is one the media server accepts', () => {
  const aceitos = ['vp8', 'h264', 'vp9', 'av1'];
  for (const escolha of media.CODEC_PREFERENCES) {
    if (escolha === 'auto') continue;
    assert.ok(aceitos.includes(escolha), `${escolha} não é um codec publicável`);
  }
  assert.ok(media.CODEC_PREFERENCES.includes('auto'));
  assert.equal(media.CODEC_PREFERENCES.includes('h265'), false);
});
