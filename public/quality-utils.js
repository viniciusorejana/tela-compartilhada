(function(root) {
  const profiles = {
    economical: { label: '720p · Econômica', width: 1280, height: 720, bitrate: 4_000_000 },
    high: { label: '1080p · Alta', width: 1920, height: 1080, bitrate: 8_000_000 },
    ultra: { label: '1440p · Máxima', width: 2560, height: 1440, bitrate: 14_000_000 }
  };
  function nextBudget(current, sample, cap) {
    let target = current;
    if (sample.estimate > 0 && sample.estimate < current * 0.9) target = sample.estimate * 0.85;
    else if (sample.cpu) target = current;
    else if (sample.estimate > 0) target = Math.max(current * 1.18, sample.estimate * 0.85);
    else if (sample.bandwidth) target = current * 0.8;
    else target = current * 1.18;
    return Math.round(Math.min(cap, Math.max(150_000, Math.max(current * 0.65, Math.min(current * 1.25, target)))));
  }
  function allocate(budgets, total) {
    const sum = budgets.reduce((a, b) => a + b, 0);
    return budgets.map(b => Math.floor(b * Math.min(1, total / Math.max(1, sum))));
  }
  function resolutionLimit(bits, previous) {
    const levels = [{ size: 2560, min: 6_000_000 }, { size: 1920, min: 3_000_000 },
      { size: 1280, min: 1_300_000 }, { size: 854, min: 650_000 }, { size: 640, min: 0 }];
    const candidate = levels.find(level => bits >= level.min);
    const current = levels.find(level => level.size === previous);
    if (current && candidate.size > current.size && bits < candidate.min * 1.15) return current.size;
    if (current && candidate.size < current.size && bits >= current.min * 0.85) return current.size;
    return candidate.size;
  }
  const api = { profiles, nextBudget, allocate, resolutionLimit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RoomQuality = api;
})(typeof window === 'undefined' ? globalThis : window);
