import {
  observations,
  summarize,
  chartPoints,
  outcome,
} from "./analytics.mjs?v=blocked-checks-2";
import { parseSeoCsv, summarizeSeo } from "./seo.mjs";
import { readSnapshot, fromApi, safeUrl, stale } from "./data.mjs";

const $ = (selector) => document.querySelector(selector);
const api = $('meta[name="site-watch-mode"]').content === "api";
const dates = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
});
const numbers = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
let targets = [],
  history = { checks: [] },
  selectedId = null,
  loading = false,
  checkedAt = null,
  queryPage = 0;
const seoData = new Map();
const errors = {
  ConnectError: "Не удалось подключиться: возможна проблема сети, DNS или TLS.",
  ConnectTimeout: "Истекло время подключения.",
  ReadTimeout: "Сервер не ответил вовремя.",
  TimeoutError: "Проверка превысила общий лимит 20 секунд.",
  TooManyRedirects: "Слишком длинная или циклическая цепочка перенаправлений.",
  RedirectOutsideTarget:
    "Перенаправление на другой хост или небезопасный адрес. Автоматическая проверка остановлена.",
  MissingRedirectLocation:
    "Сервер вернул перенаправление без адреса назначения.",
};

function el(tag, className = "", value) {
  const node = document.createElement(tag);
  node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}
function button(text, action, className = "") {
  const node = el("button", className, text);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}
const date = (value) =>
  Number.isFinite(Date.parse(value))
    ? dates.format(new Date(value))
    : "Ещё не проверяли";
const pct = (value) =>
  value === null ? "Нет оценки" : numbers.format(value * 100) + "%";
const ms = (value) =>
  Number.isFinite(value) ? numbers.format(value) + " мс" : "Нет измерения";
const checksFor = (id) => observations(history, id, Number($("#period").value));
const seoKey = () =>
  JSON.stringify([$("#seo-site").value, $("#seo-source").value]);
const seoCurrent = () => seoData.get(seoKey());
function notice(id, text) {
  const node = $(id);
  node.textContent = text;
  node.hidden = !text;
}
function empty(parent, title, text) {
  const node = el("div", "empty-state");
  node.append(el("h3", "", title), el("p", "", text));
  parent.replaceChildren(node);
}
function state(check) {
  const kind = outcome(check);
  if (kind === "unknown") return { kind, label: "Ожидает проверки" };
  if (stale(check)) return { kind: "stale", label: "Данные устарели" };
  return {
    kind,
    label:
      kind === "up"
        ? "HTTP " + check.status_code
        : kind === "blocked"
          ? "Не удалось проверить"
          : kind === "redirect"
            ? "Редирект"
            : check.error
              ? "Нет ответа"
              : "Ошибка · " + check.status_code,
  };
}

async function load() {
  if (loading) return;
  loading = true;
  $("#refresh").disabled = true;
  $("#refresh").textContent = "Загружаем…";
  try {
    const response = await fetch(api ? "/api/targets" : "./history.json", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json();
    const result = api ? fromApi(data) : readSnapshot(data);
    targets = result.targets;
    history = result.history;
    checkedAt = result.checkedAt;
    if (!targets.some((item) => item.id === selectedId)) selectedId = null;
    $("#checked").textContent = date(checkedAt);
    notice(
      "#load-feedback",
      checkedAt && stale({ checked_at: checkedAt })
        ? "Последние данные старше трёх часов или имеют неверную дату. Текущее состояние сайтов неизвестно. Проверьте запуски GitHub Actions."
        : "",
    );
    fillSeoSites();
    render();
  } catch {
    notice(
      "#load-feedback",
      targets.length
        ? "Не удалось обновить данные. Ниже сохранён последний успешно загруженный снимок от " +
            date(checkedAt) +
            ". Повторите загрузку."
        : "Не удалось загрузить историю. Нажмите «Обновить данные» или проверьте последний запуск в репозитории.",
    );
    if (!targets.length) {
      $("#checked").textContent = "Не загружено";
      empty(
        $("#overview"),
        "Проверки недоступны",
        "Статусы не подменяются нулями или успешными ответами.",
      );
      empty(
        $("#site-list"),
        "История не загружена",
        "Список появится после успешного получения данных.",
      );
    } else render();
  } finally {
    loading = false;
    $("#refresh").disabled = false;
    $("#refresh").textContent = "Обновить данные";
  }
}

function renderOverview() {
  const parent = $("#overview");
  parent.replaceChildren();
  const up = targets.filter((item) => state(item).kind === "up").length;
  const failures = targets.filter((item) => state(item).kind === "down").length;
  const uncertain = targets.length - up - failures;
  const report = summarize(targets.flatMap((item) => checksFor(item.id)));
  for (const [value, label, className] of [
    [up, "с успешным ответом", "main-stat"],
    [failures, "с ошибкой проверки", ""],
    [uncertain, "не удалось оценить", ""],
    [report.count, "наблюдений за период", ""],
  ]) {
    const p = el("p");
    p.append(
      el("strong", className, value),
      document.createTextNode(" " + label),
    );
    parent.append(p);
  }
}

function renderSites() {
  const query = $("#site-search").value.trim().toLocaleLowerCase("ru");
  const filter = $("#state-filter").value;
  const visible = targets.filter((item) => {
    const status = state(item);
    const matches = [
      item.name,
      item.url,
      item.status_code,
      item.error,
      status.label,
      ...checksFor(item.id).map((c) => c.status_code),
    ]
      .join(" ")
      .toLocaleLowerCase("ru")
      .includes(query);
    return (
      matches &&
      (filter === "all" ||
        (filter === "attention"
          ? status.kind !== "up"
          : filter === status.kind))
    );
  });
  $("#site-count").textContent =
    "Сайты: " + visible.length + " из " + targets.length;
  const list = $("#site-list");
  list.replaceChildren();
  if (!visible.length) {
    empty(
      list,
      "Ничего не найдено",
      targets.length
        ? "Измените запрос или фильтр состояния."
        : "В конфигурации пока нет сайтов.",
    );
    return;
  }
  for (const item of visible) {
    const checks = checksFor(item.id),
      report = summarize(checks),
      status = state(item);
    const row = button("", () => openDetail(item.id), "site-row");
    row.id = "site-" + item.id;
    row.setAttribute("aria-expanded", String(selectedId === item.id));
    row.setAttribute("aria-controls", "detail");
    const name = el("span", "site-name");
    name.append(
      el("strong", "", item.name),
      el("small", "", item.url.replace(/^https:\/\//, "")),
    );
    const measures = el("span", "row-measures");
    measures.append(
      el(
        "span",
        "",
        pct(report.share) +
          " · учтено: " +
          report.evaluated +
          " из " +
          report.count,
      ),
    );
    const bars = el("span", "mini-track");
    bars.setAttribute("aria-hidden", "true");
    for (const check of checks.slice(-24)) bars.append(el("i", outcome(check)));
    measures.append(bars);
    row.append(
      name,
      el("span", "state " + status.kind, status.label),
      measures,
    );
    list.append(row);
  }
}

function closeDetail() {
  const previous = selectedId;
  selectedId = null;
  renderSites();
  renderDetail();
  const row = document.getElementById("site-" + previous);
  (row || $("#site-search")).focus();
}
function openDetail(id) {
  if (selectedId === id) {
    closeDetail();
    return;
  }
  selectedId = id;
  renderSites();
  renderDetail();
  $("#detail-title").focus();
}
function renderDetail() {
  const pane = $("#detail"),
    target = targets.find((item) => item.id === selectedId);
  pane.hidden = !target;
  $("#workspace").dataset.open = String(Boolean(target));
  pane.replaceChildren();
  if (!target) return;
  const checks = checksFor(target.id),
    report = summarize(checks),
    status = state(target);
  const head = el("div", "detail-head"),
    title = el("h3", "", target.name),
    names = el("div");
  title.id = "detail-title";
  title.tabIndex = -1;
  const link = el("a", "", target.url);
  link.href = safeUrl(target.url);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute(
    "aria-label",
    "Открыть сайт " + target.name + " в новой вкладке",
  );
  names.append(title, link);
  head.append(names, button("Закрыть", closeDetail));
  pane.append(head);
  pane.append(el("p", "detail-status " + status.kind, status.label));
  let note = "Последняя проверка: " + date(target.checked_at) + ". ";
  if (target.error)
    note += errors[target.error] || "Ошибка проверки: " + target.error + ".";
  else if (outcome(target) === "blocked")
    note +=
      "Проверяющий сервер получил HTTP " +
      target.status_code +
      ". Сайт может нормально работать в браузере. Этот ответ не учитывается как простой или успех; доступность по нему определить нельзя.";
  else if (outcome(target) === "redirect")
    note +=
      "Старый снимок содержит только ответ перенаправления, без подтверждения конечной страницы.";
  else if (outcome(target) === "up") note += "Получен успешный HTTP-ответ.";
  if (target.redirect_count)
    note +=
      " Переходов: " +
      target.redirect_count +
      ". Конечный адрес: " +
      target.final_url;
  pane.append(el("p", "check-note", note));
  if (api) {
    const check = button("Проверить сейчас", async () => {
      check.disabled = true;
      check.textContent = "Проверяем…";
      try {
        const response = await fetch(
          "/api/targets/" + encodeURIComponent(target.id) + "/check",
          { method: "POST" },
        );
        if (!response.ok) throw new Error("HTTP " + response.status);
        await load();
        $("#detail-title")?.focus();
      } catch {
        notice(
          "#load-feedback",
          "Ручная проверка не выполнена. Попробуйте позже.",
        );
        check.disabled = false;
        check.textContent = "Проверить сейчас";
      }
    });
    pane.append(check);
  }
  const facts = el("div", "detail-facts");
  for (const [label, value] of [
    ["Успешные наблюдения", pct(report.share)],
    ["Медиана ответа", ms(report.medianMs)],
    ["Эпизоды ошибок", report.evaluated ? report.incidents : "Нет оценки"],
  ]) {
    const fact = el("div");
    fact.append(el("span", "", label), el("strong", "", value));
    facts.append(fact);
  }
  pane.append(facts);
  pane.append(
    el(
      "p",
      "check-note",
      "Учтено наблюдений: " +
        report.evaluated +
        " из " +
        report.count +
        ". Без оценки: " +
        report.uncertain +
        ". Заблокированные проверки, непроверенные редиректы и неизвестные результаты исключены из процента успеха.",
    ),
  );
  pane.append(el("h3", "", "Как менялось время ответа"));
  // Request failures have no HTTP response latency. Do not chart their timeout as a response.
  const responses = checks.filter((check) => check.status_code && !check.error);
  const points = chartPoints(responses, 560, 120);
  if (points.length) {
    const ns = "http://www.w3.org/2000/svg",
      svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "-8 -8 576 136");
    svg.setAttribute("class", "trend-svg");
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      "Время получения HTTP-ответа. Измерений: " +
        points.length +
        ". Значения доступны в журнале ниже.",
    );
    // Unconnected samples avoid implying availability between scheduled checks.
    points.forEach((point, index) => {
      const circle = document.createElementNS(ns, "circle");
      circle.setAttribute("cx", point.x);
      circle.setAttribute("cy", point.y);
      circle.setAttribute("r", "3");
      circle.setAttribute("class", outcome(responses[index]));
      const tooltip = document.createElementNS(ns, "title");
      tooltip.textContent = point.label;
      circle.append(tooltip);
      svg.append(circle);
    });
    pane.append(svg);
    const labels = el("div", "chart-labels");
    labels.append(
      el("span", "", date(responses[0].checked_at)),
      el("span", "", date(responses.at(-1).checked_at)),
    );
    pane.append(labels);
    pane.append(
      el(
        "p",
        "chart-note",
        "Шкала от 0 до " +
          ms(Math.max(100, ...responses.map((c) => c.latency_ms))) +
          ". Точки показывают отдельные замеры, включая редиректы. Это не время полной загрузки страницы.",
      ),
    );
  } else
    pane.append(
      el("p", "empty-state", "За этот период ещё нет измерений HTTP-ответа."),
    );
  const log = el("div", "log-panel"),
    rows = el("div", "log-list");
  log.append(el("h3", "", "Последние проверки · " + checks.length));
  rows.tabIndex = 0;
  rows.setAttribute("role", "region");
  rows.setAttribute("aria-label", "Журнал последних 50 проверок");
  for (const check of checks.slice(-50).reverse()) {
    const row = el("div", "log-item");
    row.append(
      el("time", "", date(check.checked_at)),
      el(
        "span",
        outcome(check),
        (check.error || "HTTP " + (check.status_code ?? "?")) +
          " · " +
          ms(check.latency_ms),
      ),
    );
    rows.append(row);
  }
  if (!checks.length)
    rows.append(el("p", "check-note", "За выбранный период наблюдений нет."));
  log.append(rows);
  pane.append(log);
}

function fillSeoSites() {
  const select = $("#seo-site"),
    previous = select.value;
  const options = targets.map((item) => {
    const option = el("option", "", item.name);
    option.value = item.id;
    return option;
  });
  select.replaceChildren(...options);
  if (targets.some((item) => item.id === previous)) select.value = previous;
  $("#seo-import").disabled = !targets.length;
  renderSeo();
}
function renderSeo() {
  const content = $("#seo-content"),
    data = seoCurrent();
  content.replaceChildren();
  $("#query-controls").hidden = !data;
  $("#seo-clear").hidden = !data;
  if (!data) {
    empty(
      content,
      "Сначала загрузите экспорт запросов",
      "Нужны колонки «Запрос», «Клики» и «Показы». Позиция необязательна. Выберите сайт и источник, затем загрузите CSV.",
    );
    $("#query-results").replaceChildren();
    return;
  }
  const metrics = el("div", "seo-metrics"),
    summary = summarizeSeo(data.rows);
  for (const [label, value] of [
    ["Клики", summary.clicks],
    ["Показы", summary.impressions],
    [
      "CTR",
      summary.ctr === null
        ? "Нет показов"
        : numbers.format(summary.ctr * 100) + "%",
    ],
    [
      "Средняя позиция",
      summary.position === null
        ? "Нет данных"
        : numbers.format(summary.position),
    ],
  ]) {
    const cell = el("div");
    cell.append(
      el("span", "", label),
      el(
        "strong",
        "",
        typeof value === "number" ? numbers.format(value) : value,
      ),
    );
    metrics.append(cell);
  }
  content.append(
    metrics,
    el(
      "p",
      "footnote",
      data.filename +
        " · импорт " +
        date(data.importedAt) +
        " · строк: " +
        data.rows.length +
        ". Метрики рассчитаны по всему файлу, позиция взвешена по показам.",
    ),
  );
  renderQueries();
}
function renderQueries() {
  const parent = $("#query-results"),
    data = seoCurrent();
  parent.replaceChildren();
  if (!data) return;
  const query = $("#query-search").value.trim().toLocaleLowerCase("ru"),
    sort = $("#query-sort").value;
  const filtered = data.rows
    .filter((row) => row.query.toLocaleLowerCase("ru").includes(query))
    .sort((a, b) =>
      sort === "position"
        ? (a.position ?? Infinity) - (b.position ?? Infinity)
        : b[sort] - a[sort],
    );
  if (!filtered.length) {
    empty(parent, "Запросы не найдены", "Измените текст поиска.");
    return;
  }
  const pages = Math.ceil(filtered.length / 25);
  queryPage = Math.min(queryPage, pages - 1);
  const wrap = el("div", "table-wrap");
  wrap.tabIndex = 0;
  wrap.setAttribute("role", "region");
  wrap.setAttribute(
    "aria-label",
    "Таблица поисковых запросов; на узком экране можно прокручивать горизонтально",
  );
  const table = el("table", "query-table"),
    head = el("thead"),
    headings = el("tr"),
    body = el("tbody");
  for (const label of ["Запрос", "Клики", "Показы", "CTR", "Позиция"]) {
    const th = el("th", "", label);
    th.scope = "col";
    headings.append(th);
  }
  head.append(headings);
  for (const item of filtered.slice(queryPage * 25, queryPage * 25 + 25)) {
    const row = el("tr");
    for (const value of [
      item.query,
      numbers.format(item.clicks),
      numbers.format(item.impressions),
      item.impressions
        ? numbers.format((item.clicks / item.impressions) * 100) + "%"
        : "Нет показов",
      item.position === null ? "Нет данных" : numbers.format(item.position),
    ])
      row.append(el("td", "", value));
    body.append(row);
  }
  table.append(head, body);
  wrap.append(table);
  parent.append(wrap);
  const pagination = el("div", "pagination");
  const changePage = (delta) => {
    queryPage += delta;
    renderQueries();
    $("#query-results .table-wrap").focus();
  };
  const prev = button("Назад", () => changePage(-1)),
    next = button("Далее", () => changePage(1));
  prev.disabled = !queryPage;
  next.disabled = queryPage === pages - 1;
  pagination.append(
    prev,
    el(
      "span",
      "",
      "Страница " +
        (queryPage + 1) +
        " / " +
        pages +
        " · строк: " +
        filtered.length,
    ),
    next,
  );
  parent.append(pagination);
}

function render() {
  renderOverview();
  renderSites();
  renderDetail();
}
$("#refresh").addEventListener("click", load);
$("#period").addEventListener("change", render);
for (const id of ["#site-search", "#state-filter"])
  $(id).addEventListener(
    id === "#site-search" ? "input" : "change",
    renderSites,
  );
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    selectedId &&
    $("#detail").contains(document.activeElement)
  )
    closeDetail();
});
for (const id of ["#seo-site", "#seo-source"])
  $(id).addEventListener("change", () => {
    queryPage = 0;
    $("#query-search").value = "";
    notice("#seo-feedback", "");
    renderSeo();
  });
$("#query-search").addEventListener("input", () => {
  queryPage = 0;
  renderQueries();
});
$("#query-sort").addEventListener("change", () => {
  queryPage = 0;
  renderQueries();
});
$("#seo-import").addEventListener("click", () => $("#seo-file").click());
$("#seo-clear").addEventListener("click", () => {
  seoData.delete(seoKey());
  renderSeo();
  notice("#seo-feedback", "Импорт для выбранного сайта и источника удалён.");
  $("#seo-import").focus();
});
$("#seo-file").addEventListener("change", async (event) => {
  const input = event.target,
    file = input.files?.[0];
  if (!file) return;
  const key = seoKey(); // Capture the destination before asynchronous file reading.
  notice("#seo-feedback", "Читаем CSV…");
  try {
    if (!$("#seo-site").value) throw new Error("Сначала выберите сайт");
    if (file.size > 5_000_000) throw new Error("Файл больше 5 МБ");
    const rows = parseSeoCsv(await file.text());
    seoData.set(key, {
      rows,
      filename: file.name,
      importedAt: new Date().toISOString(),
    });
    queryPage = 0;
    $("#query-search").value = "";
    notice(
      "#seo-feedback",
      "Загружено строк: " +
        rows.length +
        ". Данные сохранены только в памяти вкладки.",
    );
    renderSeo();
  } catch (error) {
    notice(
      "#seo-feedback",
      "Импорт не выполнен: " + error.message + ". Предыдущие данные сохранены.",
    );
  } finally {
    input.value = "";
  }
});
function theme(dark) {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $("#theme").textContent = dark ? "Светлая тема" : "Тёмная тема";
  $("#theme").setAttribute("aria-pressed", String(dark));
}
try {
  theme(localStorage.getItem("site-watch-theme") === "dark");
} catch {
  theme(false);
}
$("#theme").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme !== "dark";
  theme(dark);
  try {
    localStorage.setItem("site-watch-theme", dark ? "dark" : "light");
  } catch {
    /* Storage can be blocked; the current tab still switches. */
  }
});
if (api)
  $("#mode-note").textContent =
    "Локальный монитор. Ручная проверка доступна в подробностях сайта.";
load();
setInterval(() => {
  // Background refresh must not remove an input or button from under keyboard focus.
  if (!document.hidden && document.activeElement === document.body) load();
}, 60000);
