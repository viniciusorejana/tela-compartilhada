/* Small browser-independent rules shared by the room and its regression tests.
 *
 * Identifying a remote track by MID or stream id lived here while the room was a peer-to-peer
 * mesh. The media server carries the source in its own protocol, so that guesswork is gone.
 */
(function (root) {
  const CODEC_PREFERENCES = ['auto', 'h264', 'vp8', 'vp9', 'av1'];
  const MIME_BY_PREFERENCE = { h264: 'video/h264', vp8: 'video/vp8', vp9: 'video/vp9', av1: 'video/av1' };

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

  const api = { bindVideo, inviteUrl, CODEC_PREFERENCES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RoomMedia = api;
})(typeof window === 'undefined' ? globalThis : window);
