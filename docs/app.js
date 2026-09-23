import { observations, summarize, median, chartPoints } from "./analytics.mjs";
import { parseSeoCsv, summarizeSeo } from "./seo.mjs";

const $ = (selector) => document.querySelector(selector);
const local = location.pathname === "/";
const dateTime = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
});
const integer = new Intl.NumberFormat("ru-RU");
let targets = [],
  history = { checks: [] },
  selectedId = null,
  seoQuery = "",
  loading = false;
const seoData = new Map();

function element(tag, className = "", value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}
function percent(value) {
  return value === null ? "Нет данных" : `${Math.round(value * 100)}%`;
}
function smallDate(value) {
  return dateTime.format(new Date(value));
}
function placeholder(parent, message) {
  parent.replaceChildren(element("p", "empty-state", message));
}
function checkRange(targetId) {
  return observations(history, targetId, Number($("#period").value));
}

async function load() {
  if (loading) return;
  loading = true;
  $("#refresh").disabled = true;
  $("#refresh").textContent = "Обновляем…";
  try {
    if (local) {
      const response = await fetch("/api/targets", { cache: "no-store" });
      if (!response.ok) throw Error("network");
      const data = await response.json();
      targets = data.map((item) => {
        const latest = item.history.at(-1);
        return {
          ...latest,
          id: item.id,
          name: item.name,
          url: item.url,
          ok: latest ? Boolean(latest.ok) : null,
        };
      });
      history = {
        checks: data
          .flatMap((item) =>
            item.history.map((check) => ({
              checked_at: check.checked_at,
              targets: [{ ...check, id: item.id }],
            })),
          )
          .sort((a, b) => a.checked_at.localeCompare(b.checked_at)),
      };
      $("#checked").textContent = history.checks.length
        ? smallDate(history.checks.at(-1).checked_at)
        : "Проверка ещё не выполнена";
    } else {
      const [statusResponse, historyResponse] = await Promise.all([
        fetch("./status.json", { cache: "no-store" }),
        fetch("./history.json", { cache: "no-store" }),
      ]);
      if (!statusResponse.ok) throw Error("network");
      const status = await statusResponse.json();
      targets = status.targets;
      history = historyResponse.ok
        ? await historyResponse.json()
        : { checks: [status] };
      $("#checked").textContent = smallDate(status.checked_at);
      if (Date.now() - Date.parse(status.checked_at) > 3 * 3600000)
        $("#checked").textContent += " · данные задерживаются";
    }
    if (!targets.some((item) => item.id === selectedId)) selectedId = null;
    fillSeoSites();
    render();
  } catch {
    $("#checked").textContent = "Нет данных";
    placeholder(
      $("#overview"),
      "Не удалось загрузить проверки. Попробуйте обновить страницу.",
    );
    placeholder($("#site-list"), "Список сайтов временно недоступен.");
  } finally {
    loading = false;
    $("#refresh").disabled = false;
    $("#refresh").textContent = "Обновить данные";
  }
}

function renderOverview() {
  const all = targets.flatMap((item) => checkRange(item.id));
  const report = summarize(all);
  const incidents = targets.reduce(
    (sum, item) => sum + summarize(checkRange(item.id)).incidents,
    0,
  );
  const online = targets.filter((item) => item.ok === true).length;
  const known = targets.filter((item) => typeof item.ok === "boolean").length;
  const overview = $("#overview");
  overview.replaceChildren();
  const primary = element("div", "overview-primary");
  primary.append(
    element("span", "", "Доступны сейчас"),
    element("strong", "", `${online} / ${known}`),
    element(
      "small",
      "",
      known
        ? `Сайтов с последней проверкой: ${known}`
        : "Нет завершённых проверок",
    ),
  );
  overview.append(primary);
  for (const [label, value, note] of [
    [
      "Успешные проверки",
      percent(report.share),
      `${report.successes} из ${report.count} наблюдений`,
    ],
    [
      "Медиана ответа",
      report.medianMs === null
        ? "Нет данных"
        : `${integer.format(report.medianMs)} мс`,
      "Только успешные ответы",
    ],
    [
      "Эпизоды сбоев",
      report.count ? String(incidents) : "Нет данных",
      `Всего наблюдений: ${report.count}`,
    ],
  ]) {
    const box = element("div", "overview-stat");
    box.append(
      element("span", "", label),
      element("strong", "", value),
      element("small", "", note),
    );
    overview.append(box);
  }
}

function renderSites() {
  const query = $("#site-search").value.trim().toLocaleLowerCase("ru");
  const visible = targets.filter(
    (item) =>
      `${item.name} ${item.url}`.toLocaleLowerCase("ru").includes(query) ||
      checkRange(item.id).some((check) =>
        String(check.status_code || "").includes(query),
      ),
  );
  const list = $("#site-list");
  list.replaceChildren();
  if (!visible.length) {
    placeholder(
      list,
      targets.length
        ? "По запросу сайты и проверки не найдены."
        : "Сайты пока не заданы.",
    );
    return;
  }
  for (const item of visible) {
    const checks = checkRange(item.id),
      report = summarize(checks),
      row = element("button", "site-row");
    row.type = "button";
    row.setAttribute("aria-pressed", String(selectedId === item.id));
    row.setAttribute("aria-label", `Открыть аналитику: ${item.name}`);
    const name = element("span", "site-name");
    name.append(
      element("strong", "", item.name),
      element("small", "", item.url),
    );
    const state = element("span");
    state.append(
      element("span", "micro-label", "Сейчас"),
      element(
        "span",
        `site-value ${item.ok ? "up" : item.ok === false ? "down" : ""}`,
        item.ok
          ? "Работает"
          : item.status_code
            ? `HTTP ${item.status_code}`
            : item.ok === false
              ? "Нет ответа"
              : "Ожидает",
      ),
    );
    const share = element("span");
    share.append(
      element("span", "micro-label", "Проверки"),
      element("span", "site-value", percent(report.share)),
    );
    const track = element("span");
    track.append(
      element("span", "micro-label", `Наблюдений: ${checks.length}`),
    );
    const bars = element("span", "mini-track");
    bars.setAttribute("aria-hidden", "true");
    for (const check of checks.slice(-16))
      bars.append(element("i", check.ok ? "up" : "down"));
    track.append(bars);
    row.append(name, state, share, track);
    row.addEventListener("click", () => {
      selectedId = selectedId === item.id ? null : item.id;
      renderSites();
      renderDetail();
      if (selectedId) $("#detail").scrollIntoView({ block: "nearest" });
    });
    list.append(row);
  }
}

function renderDetail() {
  const pane = $("#detail"),
    target = targets.find((item) => item.id === selectedId);
  pane.replaceChildren();
  pane.hidden = !target;
  if (!target) return;
  const checks = checkRange(target.id),
    report = summarize(checks);
  const head = element("div", "detail-head"),
    left = element("div");
  left.append(
    element("h3", "", target.name),
    element(
      "p",
      "",
      `Проверок: ${checks.length} · эпизодов сбоев: ${report.incidents}`,
    ),
  );
  const close = element("button", "", "Закрыть");
  close.type = "button";
  close.onclick = () => {
    selectedId = null;
    renderSites();
    renderDetail();
  };
  head.append(left, close);
  pane.append(head);
  if (target.status_code === 403) {
    pane.append(
      element(
        "p",
        "check-note",
        "Сервер ответил 403 на автоматическую проверку. Это не доказывает, что сайт недоступен посетителям.",
      ),
    );
  } else if (target.error) {
    pane.append(
      element(
        "p",
        "check-note",
        "Проверка не получила ответ. Возможна временная задержка или ограничение сети.",
      ),
    );
  }
  const grid = element("div", "detail-grid"),
    chart = element("div", "chart-panel"),
    log = element("div", "log-panel");
  const chartTitle = element("div", "panel-title");
  chartTitle.append(
    element("span", "", "Время ответа"),
    element(
      "small",
      "",
      report.medianMs === null
        ? "Нет успешных ответов"
        : `Медиана ${integer.format(report.medianMs)} мс`,
    ),
  );
  chart.append(chartTitle);
  const points = chartPoints(checks, 600, 150);
  if (points.length) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 600 180");
    svg.setAttribute("class", "trend-svg");
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      `График скорости ответа. Измерений: ${points.length}`,
    );
    const base = document.createElementNS(svg.namespaceURI, "line");
    base.setAttribute("x1", "0");
    base.setAttribute("x2", "600");
    base.setAttribute("y1", "160");
    base.setAttribute("y2", "160");
    base.setAttribute("class", "base");
    svg.append(base);
    if (points.length > 1) {
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute("class", "line");
      path.setAttribute(
        "d",
        points
          .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
          .join(" "),
      );
      svg.append(path);
    }
    for (const point of points) {
      const circle = document.createElementNS(svg.namespaceURI, "circle");
      circle.setAttribute("cx", point.x.toFixed(1));
      circle.setAttribute("cy", point.y.toFixed(1));
      circle.setAttribute("r", "4");
      if (!point.ok) circle.setAttribute("class", "down");
      const title = document.createElementNS(svg.namespaceURI, "title");
      title.textContent = point.label;
      circle.append(title);
      svg.append(circle);
    }
    chart.append(
      svg,
      element(
        "p",
        "chart-note",
        "Каждая точка соответствует реальной проверке. Красная точка означает неуспешный ответ.",
      ),
    );
  } else
    chart.append(
      element(
        "p",
        "empty-state",
        "График появится после первой проверки с измерением времени.",
      ),
    );
  const logTitle = element("div", "panel-title");
  logTitle.append(
    element("span", "", "Последние проверки"),
    element("small", "", `${checks.length} за период`),
  );
  log.append(logTitle);
  if (!checks.length)
    log.append(
      element("p", "empty-state", "За выбранный период проверок нет."),
    );
  for (const check of checks.slice(-20).reverse()) {
    const row = element("div", "log-item");
    row.append(
      element("span", "", smallDate(check.checked_at)),
      element(
        "span",
        check.ok ? "" : "fail",
        check.error ||
          `HTTP ${check.status_code ?? "?"} · ${check.latency_ms ?? "?"} мс`,
      ),
    );
    log.append(row);
  }
  grid.append(chart, log);
  pane.append(grid);
}

function fillSeoSites() {
  const select = $("#seo-site"),
    before = select.value;
  select.replaceChildren();
  for (const item of targets) {
    const option = element("option", "", item.name);
    option.value = item.id;
    select.append(option);
  }
  if (targets.some((item) => item.id === before)) select.value = before;
  renderSeo();
}
function storedSeo() {
  return seoData.get($("#seo-site").value) || null;
}
function renderSeo() {
  const content = $("#seo-content"),
    data = storedSeo();
  content.replaceChildren();
  if (!data?.rows?.length) {
    const empty = element("div", "seo-empty");
    empty.append(
      element("strong", "", "Данных поиска пока нет"),
      element(
        "p",
        "",
        "Загрузите CSV из Google Search Console или Яндекс Вебмастера. Запросы, клики и показы появятся здесь без выдуманных значений.",
      ),
    );
    content.append(empty);
    return;
  }
  $("#seo-source").value = data.source;
  const summary = summarizeSeo(data.rows),
    metrics = element("div", "seo-metrics");
  for (const [name, value] of [
    ["Клики", integer.format(summary.clicks)],
    ["Показы", integer.format(summary.impressions)],
    ["CTR", summary.ctr === null ? "Нет данных" : `${(summary.ctr * 100).toFixed(1)}%`],
    [
      "Ср. позиция",
      summary.position === null ? "Нет данных" : summary.position.toFixed(1),
    ],
  ]) {
    const cell = element("div");
    cell.append(element("span", "", name), element("strong", "", value));
    metrics.append(cell);
  }
  content.append(metrics);
  const tools = element("div", "query-tools"),
    input = element("input", "query-search");
  input.type = "search";
  input.placeholder = "Поиск запроса";
  input.setAttribute("aria-label", "Поиск поискового запроса");
  input.value = seoQuery;
  input.addEventListener("input", () => {
    seoQuery = input.value;
    renderSeo();
    const replacement = content.querySelector(".query-search");
    replacement?.focus();
    replacement?.setSelectionRange(seoQuery.length, seoQuery.length);
  });
  tools.append(
    input,
    element(
      "span",
      "",
      `${data.source} · импортировано ${smallDate(data.imported_at)} · запросов: ${data.rows.length}`,
    ),
  );
  content.append(tools);
  const rows = data.rows
    .filter((row) =>
      row.query
        .toLocaleLowerCase("ru")
        .includes(seoQuery.toLocaleLowerCase("ru")),
    )
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 100);
  if (!rows.length) {
    content.append(
      element("p", "empty-state", "По такому запросу данных нет."),
    );
    return;
  }
  const table = element("table", "query-table"),
    thead = element("thead"),
    tr = element("tr");
  for (const name of ["Запрос", "Клики", "Показы", "CTR", "Позиция"])
    tr.append(element("th", "", name));
  thead.append(tr);
  table.append(thead);
  const body = element("tbody");
  for (const row of rows) {
    const line = element("tr");
    for (const value of [
      row.query,
      integer.format(row.clicks),
      integer.format(row.impressions),
      row.impressions
        ? `${((row.clicks / row.impressions) * 100).toFixed(1)}%`
        : "Нет данных",
      row.position === null ? "Нет данных" : row.position.toFixed(1),
    ])
      line.append(element("td", "", value));
    body.append(line);
  }
  table.append(body);
  content.append(table);
  if (data.rows.length > 100)
    content.append(
      element(
        "p",
        "privacy-note",
        "Показаны первые 100 запросов по кликам. Поиск работает по всему импортированному файлу.",
      ),
    );
}

function render() {
  renderOverview();
  renderSites();
  renderDetail();
}
$("#refresh").addEventListener("click", load);
$("#period").addEventListener("change", render);
$("#site-search").addEventListener("input", renderSites);
$("#seo-site").addEventListener("change", () => {
  seoQuery = "";
  $("#seo-feedback").textContent = "";
  renderSeo();
});
$("#seo-import").addEventListener("click", () => $("#seo-file").click());
$("#seo-file").addEventListener("change", async (event) => {
  const input = event.target,
    file = input.files?.[0];
  if (!file) return;
  try {
    const rows = parseSeoCsv(await file.text());
    const data = {
      source: $("#seo-source").value,
      imported_at: new Date().toISOString(),
      rows,
    };
    seoData.set($("#seo-site").value, data);
    seoQuery = "";
    $("#seo-feedback").textContent =
      `Запросов загружено: ${rows.length}. Данные останутся в этой вкладке до её обновления.`;
    renderSeo();
  } catch (error) {
    $("#seo-feedback").textContent =
      `Не удалось прочитать CSV: ${error.message}`;
  } finally {
    input.value = "";
  }
});
load();
setInterval(load, 60000);
