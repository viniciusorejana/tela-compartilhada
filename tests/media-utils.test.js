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
    mids: { 1: 'camera', 2: 'screen' }, micStreamId: null, cameraStreamId: null, screenStreamId: 'next'
  });
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

test('screen video prefers VP8 while retaining H264 and repair fallbacks', () => {
  const codecs = [{ mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=42e01f;packetization-mode=1' },
    { mimeType: 'video/rtx' }, { mimeType: 'video/VP8' }];
  assert.equal(media.videoCodecs(codecs, true)[0].mimeType, 'video/VP8');
  assert.equal(media.videoCodecs(codecs)[0].mimeType, 'video/H264');
  assert.equal(media.videoCodecs(codecs, true).length, codecs.length);
});
