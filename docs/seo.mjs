function parseRows(text, delimiter) {
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && char === delimiter) {
      row.push(field);
      field = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normalize(value) {
  return String(value || "")
    .replace(/^\ufeff/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_–-]+/g, "");
}
function number(value) {
  const raw = String(value || "")
    .replace(/\s/g, "")
    .replace("%", "")
    .replace(",", ".");
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
const aliases = {
  query: [
    "query",
    "queries",
    "topqueries",
    "searchquery",
    "поисковыйзапрос",
    "запрос",
    "запросы",
    "популярныезапросы",
    "поисковаяфраза",
  ],
  clicks: ["clicks", "click", "клики", "переходы"],
  impressions: ["impressions", "impression", "показы", "показов"],
  position: [
    "position",
    "averageposition",
    "avgposition",
    "позиция",
    "средняяпозиция",
  ],
};
function column(headers, key) {
  return headers.findIndex((header) =>
    aliases[key].includes(normalize(header)),
  );
}

export function parseSeoCsv(text) {
  if (text.length > 5_000_000) throw new Error("Файл больше 5 МБ");
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delimiter = [";", ",", "\t"].sort(
    (a, b) => firstLine.split(b).length - firstLine.split(a).length,
  )[0];
  const rows = parseRows(text, delimiter);
  const headerIndex = rows.findIndex(
    (row) =>
      column(row, "query") >= 0 &&
      column(row, "clicks") >= 0 &&
      column(row, "impressions") >= 0,
  );
  if (headerIndex < 0)
    throw new Error("Не найдены столбцы «запрос», «клики» и «показы»");
  const headers = rows[headerIndex];
  const q = column(headers, "query"),
    c = column(headers, "clicks"),
    i = column(headers, "impressions"),
    p = column(headers, "position");
  const parsed = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const query = (row[q] || "").trim();
    const clicks = number(row[c]),
      impressions = number(row[i]);
    const position = p >= 0 ? number(row[p]) : null;
    if (
      !query ||
      /^итого$|^total$/i.test(query) ||
      clicks === null ||
      impressions === null ||
      clicks < 0 ||
      impressions < 0
    )
      continue;
    parsed.push({ query, clicks, impressions, position });
    if (parsed.length >= 5000) break;
  }
  if (!parsed.length) throw new Error("В файле нет строк с запросами");
  return parsed;
}

export function summarizeSeo(rows) {
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0),
    impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const positioned = rows.filter(
    (row) => row.position !== null && row.impressions > 0,
  );
  const weight = positioned.reduce((sum, row) => sum + row.impressions, 0);
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : null,
    position: weight
      ? positioned.reduce(
          (sum, row) => sum + row.position * row.impressions,
          0,
        ) / weight
      : null,
  };
}
