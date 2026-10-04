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
  if (quoted) throw new Error("Незакрытая кавычка в CSV");
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
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return null;
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
  // Find the header even when an export has report metadata before it.
  const candidates = [";", ",", "\t"].map((separator) =>
    parseRows(text, separator),
  );
  const rows =
    candidates.find((candidate) =>
      candidate.some(
        (row) =>
          column(row, "query") >= 0 &&
          column(row, "clicks") >= 0 &&
          column(row, "impressions") >= 0,
      ),
    ) || [];
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
  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (row.every((cell) => !cell.trim())) continue;
    const query = (row[q] || "").trim();
    const clicks = number(row[c]),
      impressions = number(row[i]);
    const position = p >= 0 ? number(row[p]) : null;
    if (/^итого$|^total$/i.test(query)) continue;
    if (
      !query ||
      clicks === null ||
      impressions === null ||
      clicks < 0 ||
      impressions < 0 ||
      !Number.isInteger(clicks) ||
      !Number.isInteger(impressions) ||
      clicks > impressions
    )
      throw new Error(`Некорректные клики или показы в строке ${rowIndex + 1}`);
    if (position !== null && position <= 0)
      throw new Error("Позиция должна быть больше нуля");
    if (p >= 0 && row[p]?.trim() && position === null)
      throw new Error("Некорректная позиция в CSV");
    parsed.push({ query, clicks, impressions, position });
    if (parsed.length > 5000)
      throw new Error(
        "Больше 5000 запросов. Разделите экспорт на файлы; данные не были заменены.",
      );
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
