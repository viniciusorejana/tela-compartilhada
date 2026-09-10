/* Small browser-independent rules shared by the room and its regression tests. */
(function (root) {
  const sources = { mic: 'audio', camera: 'video', screen: 'video', screenAudio: 'audio' };

  function mediaInfo(pc, senders, streams) {
    const mids = {};
    for (const transceiver of pc.getTransceivers()) {
      const source = Object.keys(sources).find(key => senders[key] === transceiver.sender);
      if (source && transceiver.mid !== null) mids[transceiver.mid] = source;
    }
    return {
      mids,
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

  function videoCodecs(codecs, preferVP8 = false) {
    const rank = codec => {
      const mime = codec.mimeType.toLowerCase();
      if (preferVP8 && mime === 'video/vp8') return -1;
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

  const api = { mediaInfo, sourceForTrack, videoCodecs, bindVideo, inviteUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RoomMedia = api;
})(typeof window === 'undefined' ? globalThis : window);
