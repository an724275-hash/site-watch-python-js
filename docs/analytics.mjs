export function observations(history, targetId, hours, now = Date.now()) {
  const since = now - hours * 3600000;
  const unique = new Map();
  for (const snapshot of history?.checks || []) {
    const time = Date.parse(snapshot.checked_at);
    const item = snapshot.targets?.find((target) => target.id === targetId);
    if (Number.isFinite(time) && time >= since && time <= now && item)
      unique.set(time, { ...item, checked_at: snapshot.checked_at });
  }
  return [...unique].sort(([a], [b]) => a - b).map(([, check]) => check);
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function outcome(check) {
  if (!check || check.ok === null || check.ok === undefined) return "unknown";
  if ([401, 403, 429].includes(check.status_code)) return "blocked";
  if (
    check.error?.includes("Redirect") ||
    (check.status_code >= 300 && check.status_code < 400)
  )
    return "redirect";
  return check.ok ? "up" : "down";
}

export function summarize(checks) {
  const count = checks.length;
  if (!count)
    return {
      count: 0,
      evaluated: 0,
      uncertain: 0,
      successes: 0,
      share: null,
      medianMs: null,
      incidents: 0,
    };
  const successes = checks.filter((check) => outcome(check) === "up").length;
  const evaluated = checks.filter((check) =>
    ["up", "down"].includes(outcome(check)),
  ).length;
  const delays = checks
    .filter(
      (check) =>
        outcome(check) === "up" &&
        Number.isFinite(check.latency_ms) &&
        check.latency_ms >= 0,
    )
    .map((check) => check.latency_ms);
  let incidents = 0,
    wasDown = false;
  for (const check of checks) {
    // An inconclusive observation proves neither failure nor recovery.
    if (!["up", "down"].includes(outcome(check))) continue;
    const down = outcome(check) === "down";
    if (down && !wasDown) incidents++;
    wasDown = down;
  }
  return {
    count,
    evaluated,
    uncertain: count - evaluated,
    successes,
    share: evaluated ? successes / evaluated : null,
    medianMs: median(delays),
    incidents,
  };
}

export function chartPoints(checks, width = 600, height = 150) {
  const valid = checks
    .filter(
      (check) =>
        Number.isFinite(check.latency_ms) &&
        check.latency_ms >= 0 &&
        Number.isFinite(Date.parse(check.checked_at)),
    )
    .sort((a, b) => Date.parse(a.checked_at) - Date.parse(b.checked_at));
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
