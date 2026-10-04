import test from "node:test";
import assert from "node:assert/strict";
import { observations, summarize, median } from "../docs/analytics.mjs";
import { parseSeoCsv, summarizeSeo } from "../docs/seo.mjs";
import { outcome } from "../docs/analytics.mjs";
import { readSnapshot, fromApi, stale, safeUrl } from "../docs/data.mjs";

test("site analytics use observed checks only", () => {
  const checks = [
    { ok: true, latency_ms: 100 },
    { ok: false, latency_ms: 800 },
    { ok: false, latency_ms: 800 },
    { ok: true, latency_ms: 200 },
  ];
  assert.deepEqual(summarize(checks), {
    count: 4,
    evaluated: 4,
    uncertain: 0,
    successes: 2,
    share: 0.5,
    medianMs: 150,
    incidents: 1,
  });
  assert.equal(median([]), null);
});

test("period filters historical snapshots", () => {
  const now = Date.parse("2026-01-08T12:00:00Z");
  const history = {
    checks: [
      { checked_at: "2026-01-07T10:00:00Z", targets: [{ id: "a", ok: true }] },
      { checked_at: "2026-01-08T11:00:00Z", targets: [{ id: "a", ok: false }] },
    ],
  };
  assert.equal(observations(history, "a", 24, now).length, 1);
});

test("imports English and Russian search exports", () => {
  const english = parseSeoCsv(
    'Top queries,Clicks,Impressions,CTR,Position\n"desk, repair",12,100,12%,4.5',
  );
  assert.equal(english[0].query, "desk, repair");
  assert.deepEqual(summarizeSeo(english), {
    clicks: 12,
    impressions: 100,
    ctr: 0.12,
    position: 4.5,
  });
  const russian = parseSeoCsv(
    "Запрос;Клики;Показы;Средняя позиция\nремонт ноутбука;4;80;7,2",
  );
  assert.equal(russian[0].position, 7.2);
});

test("observations sort and deduplicate timestamps", () => {
  const now = Date.parse("2026-01-08T12:00:00Z");
  const old = {
    checked_at: "2026-01-08T10:00:00Z",
    targets: [{ id: "a", ok: false }],
  };
  const recent = {
    checked_at: "2026-01-08T11:00:00Z",
    targets: [{ id: "a", ok: true }],
  };
  assert.deepEqual(
    observations({ checks: [recent, old, old] }, "a", 24, now).map((c) => c.ok),
    [false, true],
  );
});

test("blocked checks and legacy redirects do not become successful answers or outage incidents", () => {
  assert.equal(outcome({ ok: true, status_code: 301 }), "redirect");
  assert.equal(outcome({ ok: false, status_code: 403 }), "blocked");
  const summary = summarize([
    { ok: false, status_code: 403 },
    { ok: true, status_code: 301 },
    { ok: true, status_code: 200 },
  ]);
  assert.equal(summary.successes, 1);
  assert.equal(summary.share, 1);
  assert.equal(summary.evaluated, 1);
  assert.equal(summary.uncertain, 2);
  assert.equal(summary.incidents, 0);
});

test("GoldenFix: all blocked observations produce no availability estimate, never zero", () => {
  const report = summarize(
    Array.from({ length: 37 }, () => ({
      ok: false,
      status_code: 403,
      latency_ms: 500,
    })),
  );
  assert.equal(report.count, 37);
  assert.equal(report.evaluated, 0);
  assert.equal(report.uncertain, 37);
  assert.equal(report.share, null);
  assert.equal(report.medianMs, null);
  assert.equal(report.incidents, 0);
});

test("inconclusive observations do not dilute success or manufacture recovery", () => {
  const report = summarize([
    { ok: false, status_code: 503 },
    { ok: false, status_code: 401 },
    { ok: false, status_code: 429 },
    { ok: null },
    { ok: false, status_code: 503 },
    { ok: true, status_code: 200 },
  ]);
  assert.equal(report.evaluated, 3);
  assert.equal(report.uncertain, 3);
  assert.equal(report.share, 1 / 3);
  assert.equal(report.incidents, 1);
  assert.equal(summarize([]).share, null);
  assert.equal(summarize([{ ok: false, status_code: 503 }]).share, 0);
});

test("CSV metadata, BOM, quoted newline and empty position", () => {
  const rows = parseSeoCsv(
    '\ufeffReport for property\nQuery;Clicks;Impressions;Position\n"ремонт\nноутбука";2;30;',
  );
  assert.equal(rows[0].position, null);
  assert.equal(rows[0].query, "ремонт\nноутбука");
});

test("bad CSV does not silently manufacture zeros or truncate data", () => {
  for (const row of ["q,,10", "q,bad,10", "q,-1,10", "q,11,10", "q,1.2,10"]) {
    assert.throws(() => parseSeoCsv("Query,Clicks,Impressions\n" + row));
  }
  assert.throws(
    () => parseSeoCsv('Query,Clicks,Impressions\n"open,1,20'),
    /кавычка/,
  );
  assert.throws(
    () =>
      parseSeoCsv(
        "Query,Clicks,Impressions\n" +
          Array.from({ length: 5001 }, (_, i) => "q" + i + ",1,10").join("\n"),
      ),
    /5000/,
  );
});

test("single history file determines both current state and chart", () => {
  const target = { id: "a", name: "A", url: "https://example.com/", ok: true };
  const data = readSnapshot({
    checks: [
      { checked_at: "2026-01-08T11:00:00Z", targets: [target] },
      { checked_at: "2026-01-08T10:00:00Z", targets: [] },
    ],
  });
  assert.equal(data.targets[0].checked_at, "2026-01-08T11:00:00Z");
  assert.throws(() => readSnapshot({ checks: [] }));
  assert.throws(() =>
    readSnapshot({ checks: [{ checked_at: "bad", targets: [] }] }),
  );
  assert.equal(safeUrl("javascript:alert(1)"), null);
});

test("freshness and empty local history", () => {
  const now = Date.parse("2026-01-08T12:00:00Z");
  assert.equal(stale({ checked_at: "2026-01-08T08:00:00Z" }, now), true);
  assert.equal(stale({ checked_at: "2026-01-08T11:00:00Z" }, now), false);
  assert.equal(
    fromApi([{ id: "a", name: "A", url: "https://example.com", history: [] }])
      .targets[0].ok,
    null,
  );
});

test("database row IDs never replace target IDs in local analytics", () => {
  const result = fromApi([
    {
      id: "portfolio",
      name: "Portfolio",
      url: "https://example.com",
      history: [
        {
          id: 42,
          target_id: "portfolio",
          checked_at: "2026-01-08T11:00:00Z",
          ok: 1,
          status_code: 200,
          latency_ms: 100,
        },
      ],
    },
  ]);
  assert.equal(result.targets[0].id, "portfolio");
  assert.equal(result.history.checks[0].targets[0].id, "portfolio");
  assert.equal(
    observations(
      result.history,
      "portfolio",
      24,
      Date.parse("2026-01-08T12:00:00Z"),
    ).length,
    1,
  );
});
