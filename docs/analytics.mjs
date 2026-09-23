export function observations(history, targetId, hours, now = Date.now()) {
  const since = now - hours * 3600000;
  return (history?.checks || []).flatMap((snapshot) => {
    const time = Date.parse(snapshot.checked_at);
    const item = snapshot.targets?.find((target) => target.id === targetId);
    return Number.isFinite(time) && time >= since && time <= now && item
      ? [{ ...item, checked_at: snapshot.checked_at }]
      : [];
  });
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function summarize(checks) {
  const count = checks.length;
  if (!count)
    return {
      count: 0,
      successes: 0,
      share: null,
      medianMs: null,
      incidents: 0,
    };
  const successes = checks.filter((check) => check.ok).length;
  const delays = checks
    .filter((check) => check.ok && Number.isFinite(check.latency_ms))
    .map((check) => check.latency_ms);
  let incidents = 0,
    wasDown = false;
  for (const check of checks) {
    if (!check.ok && !wasDown) incidents++;
    wasDown = !check.ok;
  }
  return {
    count,
    successes,
    share: successes / count,
    medianMs: median(delays),
    incidents,
  };
}

export function chartPoints(checks, width = 600, height = 150) {
  const valid = checks.filter((check) => Number.isFinite(check.latency_ms));
  if (!valid.length) return [];
  const max = Math.max(100, ...valid.map((check) => check.latency_ms));
  const minTime = Date.parse(valid[0].checked_at);
  const maxTime = Date.parse(valid.at(-1).checked_at);
  return valid.map((check, index) => ({
    x:
      maxTime === minTime
        ? width / 2
        : ((Date.parse(check.checked_at) - minTime) / (maxTime - minTime)) *
          width,
    y: height - Math.min(1, check.latency_ms / max) * height,
    ok: check.ok,
    label: `${new Date(check.checked_at).toLocaleString("ru-RU")}: ${check.latency_ms} мс`,
    index,
  }));
}
