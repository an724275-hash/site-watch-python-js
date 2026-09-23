const list = document.querySelector('#targets');
const summary = document.querySelector('#summary');
const updated = document.querySelector('#updated');
const dateFormat = new Intl.DateTimeFormat('ru-RU', {dateStyle: 'short', timeStyle: 'short'});
function el(tag, className, value) { const node = document.createElement(tag); if (className) node.className = className; if (value !== undefined) node.textContent = value; return node; }
function render(targets) {
  list.replaceChildren();
  let online = 0;
  for (const target of targets) {
    const latest = target.history.at(-1);
    if (latest?.ok) online++;
    const row = el('article', 'target');
    const identity = el('div'); identity.append(el('h3', 'name', target.name), el('div', 'url', target.url));
    const stateBox = el('div'); stateBox.append(el('div', 'label', 'Доступность'), el('div', `state ${latest ? latest.ok ? 'up' : 'down' : ''}`, latest ? latest.ok ? 'Работает' : 'Недоступен' : 'Проверяется'));
    const history = el('div', 'history'); history.setAttribute('aria-label', `${target.history.length} последних проверок`);
    for (const item of target.history) history.append(el('i', item.ok ? 'up' : 'down'));
    stateBox.append(history);
    const latencyBox = el('div'); latencyBox.append(el('div', 'label', 'Последняя проверка'), el('div', 'metric', latest ? dateFormat.format(new Date(latest.checked_at)) : 'Ещё нет'));
    if (latest) latencyBox.append(el('div', 'url', latest.error || `${latest.latency_ms} мс · HTTP ${latest.status_code}`));
    const button = el('button', '', 'Проверить'); button.type = 'button'; button.setAttribute('aria-label', `Проверить ${target.name}`);
    button.addEventListener('click', async () => { button.disabled = true; button.textContent = 'Проверяем…'; try { await fetch(`/api/targets/${encodeURIComponent(target.id)}/check`, {method:'POST'}); await load(); } catch { button.textContent = 'Ошибка сети'; } finally { button.disabled = false; } });
    row.append(identity, stateBox, latencyBox, button); list.append(row);
  }
  if (!targets.length) list.append(el('p', 'empty', 'Добавьте сайты в targets.json.'));
  summary.textContent = `${online} из ${targets.length} доступны`;
  updated.textContent = `Обновлено: ${dateFormat.format(new Date())}`;
}
async function load() { try { const response = await fetch('/api/targets'); if (!response.ok) throw Error(); render(await response.json()); } catch { list.replaceChildren(el('p', 'empty', 'Не удалось получить данные. Проверьте соединение.')); } }
load(); setInterval(load, 15000);

