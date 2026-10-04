export function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function readSnapshot(payload) {
  if (!Array.isArray(payload?.checks) || !payload.checks.length)
    throw new Error("В истории нет снимков");
  const snapshots = payload.checks;
  for (const snapshot of snapshots) {
    if (
      !Number.isFinite(Date.parse(snapshot?.checked_at)) ||
      !Array.isArray(snapshot.targets)
    )
      throw new Error("Повреждён формат истории");
    const ids = new Set();
    for (const item of snapshot.targets) {
      if (
        typeof item?.id !== "string" ||
        ids.has(item.id) ||
        typeof item.name !== "string" ||
        !safeUrl(item.url) ||
        ![true, false, null].includes(item.ok)
      )
        throw new Error("Повреждены сведения о сайте");
      ids.add(item.id);
    }
  }
  const latest = [...snapshots]
    .sort((a, b) => Date.parse(a.checked_at) - Date.parse(b.checked_at))
    .at(-1);
  return {
    history: payload,
    targets: latest.targets.map((item) => ({
      ...item,
      checked_at: latest.checked_at,
    })),
    checkedAt: latest.checked_at,
  };
}

export function fromApi(data) {
  if (!Array.isArray(data)) throw new Error("Некорректный ответ API");
  const checks = data
    .flatMap(({ history: series, ...item }) =>
      series.map((check) => ({
        checked_at: check.checked_at,
        targets: [{ ...item, ...check, id: item.id, ok: Boolean(check.ok) }],
      })),
    )
    .sort((a, b) => Date.parse(a.checked_at) - Date.parse(b.checked_at));
  return {
    targets: data.map(({ history, ...item }) => ({
      ...item,
      ...history.at(-1),
      id: item.id,
      ok: history.length ? Boolean(history.at(-1).ok) : null,
    })),
    history: { checks },
    checkedAt: checks.at(-1)?.checked_at ?? null,
  };
}

export function stale(check, now = Date.now()) {
  const at = Date.parse(check?.checked_at);
  return !Number.isFinite(at) || now - at > 3 * 3600000 || at > now + 60000;
}
