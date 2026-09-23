const targetsNode = document.querySelector('#targets');
const checkedNode = document.querySelector('#checked');
const local = location.pathname === '/';
function show(items, time) {
  targetsNode.replaceChildren();
  checkedNode.textContent = time ? `Проверено: ${new Intl.DateTimeFormat('ru-RU', {dateStyle:'short',timeStyle:'short'}).format(new Date(time))}` : 'Проверка ещё не выполнена';
  for (const item of items) {
    const row = document.createElement('article'); row.className = 'site';
    const info = document.createElement('div');
    const name = document.createElement('h2'); name.textContent = item.name;
    const url = document.createElement('p'); url.textContent = item.url;
    info.append(name, url);
    const status = document.createElement('div'); status.className = `status ${item.ok ? 'up' : 'down'}`;
    status.textContent = item.ok ? 'Работает' : 'Недоступен';
    row.append(info,status); targetsNode.append(row);
  }
  if (!items.length) targetsNode.textContent = 'Сайты не заданы.';
}
async function load() {
  try {
    const response = await fetch(local ? '/api/targets' : './status.json', {cache:'no-store'});
    if (!response.ok) throw new Error('request failed');
    const data = await response.json();
    if (local) {
      const items = data.map(item => ({...item,...(item.history.at(-1) || {ok:false})}));
      const latest = data.flatMap(item => item.history).map(item => item.checked_at).sort().at(-1);
      show(items, latest);
      document.querySelector('#mode-note').textContent = 'Локальная версия проверяет сайты на Python каждые пять минут. Полная история доступна через API.';
    } else show(data.targets, data.checked_at);
  } catch { targetsNode.innerHTML = '<p class="message">Данные пока недоступны. Попробуйте обновить страницу позже.</p>'; checkedNode.textContent = 'Нет данных'; }
}
load(); setInterval(load, 60000);

