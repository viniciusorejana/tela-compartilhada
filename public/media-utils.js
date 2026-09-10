/* Small browser-independent rules shared by the room and its regression tests. */
(function (root) {
  const sources = { mic: 'audio', camera: 'video', screen: 'video', screenAudio: 'audio' };

  function mediaInfo(pc, senders, streams, codec = 'auto') {
    const mids = {};
    for (const transceiver of pc.getTransceivers()) {
      const source = Object.keys(sources).find(key => senders[key] === transceiver.sender);
      if (source && transceiver.mid !== null) mids[transceiver.mid] = source;
    }
    return {
      mids,
      // The codec is decided by the answer, so the sender's choice has to reach the other
      // side: without this the receiver would always reorder back to its own preference.
      codec: CODEC_PREFERENCES.includes(codec) ? codec : 'auto',
      micStreamId: streams.mic?.id || null,
      cameraStreamId: streams.camera?.id || null,
      screenStreamId: streams.screen?.id || null
    };
  }

  function sourceForTrack(event, info = {}, state = {}) {
    const mid = event.transceiver?.mid;
    const mapped = mid != null && Object.prototype.hasOwnProperty.call(info.mids || {}, mid) ? info.mids[mid] : null;
    if (Object.prototype.hasOwnProperty.call(sources, mapped) && sources[mapped] === event.track.kind) return mapped;
    // Older clients only send stream IDs. RTCTrackEvent.streams may be empty.
    for (const stream of event.streams || []) {
      if (stream.id === info.screenStreamId) return event.track.kind === 'video' ? 'screen' : 'screenAudio';
      if (stream.id === info.cameraStreamId && event.track.kind === 'video') return 'camera';
      if (stream.id === info.micStreamId && event.track.kind === 'audio') return 'mic';
    }
    if (event.track.kind === 'video') {
      if (state.screen && !state.camera) return 'screen';
      if (state.camera && !state.screen) return 'camera';
    }
    if (event.track.kind === 'audio' && !state.screenAudio) return 'mic';
    // Ambiguous tracks wait for metadata; never silently treat a screen as a camera.
    return null;
  }

  const CODEC_PREFERENCES = ['auto', 'h264', 'vp8', 'vp9', 'av1'];
  const MIME_BY_PREFERENCE = { h264: 'video/h264', vp8: 'video/vp8', vp9: 'video/vp9', av1: 'video/av1' };

  // Only reorders: every codec stays in the list, so a peer that cannot handle the chosen
  // one still negotiates the best common codec instead of losing video entirely.
  //
  // The automatic order puts H.264 constrained baseline first. On iOS that is the only
  // video codec decoded by dedicated hardware, and on Windows it is the one most likely to
  // reach the GPU encoder. VP8 and VP9 decode in software there, which is the worst trade
  // for the heaviest stream in the room.
  function videoCodecs(codecs, options = {}) {
    const settings = typeof options === 'boolean' ? { preference: options ? 'vp8' : 'auto' } : options;
    const preference = CODEC_PREFERENCES.includes(settings.preference) ? settings.preference : 'auto';
    // H.264 already leads the automatic order, and jumping it to the front as a block would
    // lose the baseline-before-high distinction that iOS depends on.
    const chosen = preference === 'h264' ? null : MIME_BY_PREFERENCE[preference];
    const rank = codec => {
      const mime = codec.mimeType.toLowerCase();
      if (chosen && mime === chosen) return -1;
      if (mime === 'video/h264') {
        // Prefer constrained baseline, packetization mode 1, retaining every fallback.
        const fmtp = codec.sdpFmtpLine || '';
        return /profile-level-id=42[0-9a-f]{4}/i.test(fmtp) && /packetization-mode=1/.test(fmtp) ? 0 : 1;
      }
      return mime === 'video/vp8' ? 2 : mime === 'video/vp9' ? 3 : 4;
    };
    return [...codecs].sort((a, b) => rank(a) - rank(b));
  }

  function bindVideo(element, stream, StreamClass = root.MediaStream) {
    element.muted = true;
    element.defaultMuted = true;
    element.playsInline = true;
    element.setAttribute('muted', '');
    element.setAttribute('playsinline', '');
    element.setAttribute('webkit-playsinline', '');
    // Audio belongs exclusively to the dedicated audio elements. On iOS, gaining an
    // audio track can suspend a video, even when this is only a thumbnail.
    const tracks = stream?.getVideoTracks().filter(t => t.readyState !== 'ended') || [];
    const current = element.srcObject?.getTracks() || [];
    if (tracks.length === current.length && tracks.every(t => current.includes(t))) return false;
    element.srcObject = tracks.length ? new StreamClass(tracks) : null;
    return true;
  }

  function inviteUrl(current, publicUrl, room) {
    const base = new URL(publicUrl || current);
    if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Endereço de convite inválido');
    return new URL(`/${encodeURIComponent(room)}/sala`, base.origin).href;
  }

  const api = { mediaInfo, sourceForTrack, videoCodecs, bindVideo, inviteUrl, CODEC_PREFERENCES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RoomMedia = api;
})(typeof window === 'undefined' ? globalThis : window);
