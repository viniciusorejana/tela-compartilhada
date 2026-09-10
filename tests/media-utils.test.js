const { test } = require('node:test');
const assert = require('node:assert/strict');
const media = require('../public/media-utils');

const event = (kind, mid, streams = []) => ({ track: { kind }, transceiver: { mid }, streams });

test('streamless screen and camera tracks are identified by MID, even with both active', () => {
  const info = { mids: { 0: 'mic', 1: 'camera', 2: 'screen', 3: 'screenAudio' } };
  const state = { camera: true, screen: true, screenAudio: true };
  assert.equal(media.sourceForTrack(event('video', '2'), info, state), 'screen');
  assert.equal(media.sourceForTrack(event('video', '1'), info, state), 'camera');
  assert.equal(media.sourceForTrack(event('audio', '3'), info, state), 'screenAudio');
  assert.equal(media.sourceForTrack(event('audio', '0'), info, state), 'mic');
});

test('MID survives replacing a source with a different stream ID', () => {
  assert.equal(media.sourceForTrack(event('video', '2', [{ id: 'old-stream' }]), { mids: { 2: 'screen' }, screenStreamId: 'new-stream' }), 'screen');
});

test('legacy clients still work and ambiguous tracks do not become cameras', () => {
  assert.equal(media.sourceForTrack(event('video', null, [{ id: 'screen' }]), { screenStreamId: 'screen' }), 'screen');
  assert.equal(media.sourceForTrack(event('video', null), {}, { screen: true, camera: false }), 'screen');
  assert.equal(media.sourceForTrack(event('video', null), {}, { screen: true, camera: true }), null);
  assert.equal(media.sourceForTrack(event('audio', '2'), { mids: { 2: 'screen' } }, { screenAudio: true }), null);
});

test('media metadata maps negotiated senders, including temporarily stopped sources', () => {
  const camera = { track: null }, screen = { track: { kind: 'video' } };
  const pc = { getTransceivers: () => [{ mid: '1', sender: camera }, { mid: '2', sender: screen }, { mid: null, sender: {} }] };
  assert.deepEqual(media.mediaInfo(pc, { camera, screen }, { screen: { id: 'next' } }), {
    mids: { 1: 'camera', 2: 'screen' }, codec: 'auto', micStreamId: null, cameraStreamId: null, screenStreamId: 'next'
  });
});

// The answer settles the codec, so the sender's choice has to travel with the offer.
test('the sender codec choice travels in the media metadata, rejecting unknown values', () => {
  const pc = { getTransceivers: () => [] };
  assert.equal(media.mediaInfo(pc, {}, {}, 'vp9').codec, 'vp9');
  assert.equal(media.mediaInfo(pc, {}, {}, 'h265').codec, 'auto');
  assert.equal(media.mediaInfo(pc, {}, {}).codec, 'auto');
});

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

test('codec preference keeps fallbacks and retransmission codecs', () => {
  const vp8 = { mimeType: 'video/VP8' }, rtx = { mimeType: 'video/rtx' };
  const high = { mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=64001f;packetization-mode=1' };
  const baseline = { mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=42e01f;packetization-mode=1' };
  const codecs = [vp8, rtx, high, baseline];
  assert.deepEqual(media.videoCodecs(codecs), [baseline, high, vp8, rtx]);
  assert.deepEqual(codecs, [vp8, rtx, high, baseline]);
});

test('local host invites use the configured public origin without query tokens', () => {
  assert.equal(media.inviteUrl('http://localhost:3000/abcd/sala?secret=1', 'https://example.ts.net', 'abcd'), 'https://example.ts.net/abcd/sala');
  assert.equal(media.inviteUrl('https://example.ts.net/sala', '', 'principal'), 'https://example.ts.net/principal/sala');
  assert.throws(() => media.inviteUrl('https://example.com', 'javascript:alert(1)', 'abcd'));
});

// H.264 first is what lets an iPhone decode in hardware; VP8 there is software only.
test('automatic order leads with H264 baseline for every source', () => {
  const baseline = { mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=42e01f;packetization-mode=1' };
  const codecs = [{ mimeType: 'video/VP8' }, { mimeType: 'video/rtx' }, baseline];
  for (const source of ['screen', 'camera', null]) {
    assert.equal(media.videoCodecs(codecs, { preference: 'auto', source })[0].mimeType, 'video/H264');
  }
  assert.equal(media.videoCodecs(codecs)[0].mimeType, 'video/H264');
});

test('a manual codec choice leads without dropping any codec', () => {
  const baseline = { mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=42e01f;packetization-mode=1' };
  const codecs = [baseline, { mimeType: 'video/rtx' }, { mimeType: 'video/VP8' },
    { mimeType: 'video/VP9' }, { mimeType: 'video/AV1' }];
  const leads = { auto: 'video/H264', h264: 'video/H264', vp8: 'video/VP8', vp9: 'video/VP9', av1: 'video/AV1' };
  for (const [preference, expected] of Object.entries(leads)) {
    const ordered = media.videoCodecs(codecs, { preference });
    assert.equal(ordered[0].mimeType, expected);
    // Nothing removed: a peer without the chosen codec still finds a common one.
    const names = list => list.map(codec => codec.mimeType).sort();
    assert.deepEqual(names(ordered), names(codecs));
  }
  // An unknown value must not silently drop to an arbitrary codec.
  assert.equal(media.videoCodecs(codecs, { preference: 'h265' })[0].mimeType, 'video/H264');
  assert.deepEqual(codecs[0], baseline);
});

test('choosing H264 keeps constrained baseline ahead of the high profile', () => {
  const high = { mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=64001f;packetization-mode=1' };
  const baseline = { mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=42e01f;packetization-mode=1' };
  assert.deepEqual(media.videoCodecs([high, baseline], { preference: 'h264' }), [baseline, high]);
});

// The previous revision took a boolean meaning "prefer VP8". Older callers must not break.
test('the legacy boolean argument still selects VP8', () => {
  const codecs = [{ mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=42e01f;packetization-mode=1' },
    { mimeType: 'video/rtx' }, { mimeType: 'video/VP8' }];
  assert.equal(media.videoCodecs(codecs, true)[0].mimeType, 'video/VP8');
  assert.equal(media.videoCodecs(codecs, false)[0].mimeType, 'video/H264');
  assert.equal(media.videoCodecs(codecs, true).length, codecs.length);
});
