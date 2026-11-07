const KEY = 'sthuthi-compare';
const MAX = 3;
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]').slice(0, MAX); } catch (_) { return []; } };
const write = (a) => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (_) {} };
const tray = document.querySelector('[data-tray]');
const boxes = [...document.querySelectorAll('input.cmp')];
function sync() {
  const sel = read();
  boxes.forEach((b) => { b.checked = sel.includes(b.value); b.disabled = !b.checked && sel.length >= MAX; });
  tray.hidden = sel.length === 0;
  tray.querySelector('[data-tray-text]').textContent = sel.length < 2 ? `${sel.length} selected. Choose ${sel.length ? 'one or two more' : 'two or three'} to compare.` : `${sel.length} selected (up to ${MAX})`;
  const link = tray.querySelector('[data-tray-link]');
  link.href = `/compare/?skus=${sel.join(',')}`;
  link.setAttribute('aria-disabled', String(sel.length < 2));
}
boxes.forEach((b) => b.addEventListener('change', () => {
  let sel = read();
  sel = b.checked ? [...new Set([...sel, b.value])].slice(0, MAX) : sel.filter((x) => x !== b.value);
  write(sel); sync();
}));
tray.querySelector('[data-tray-clear]').addEventListener('click', () => { write([]); sync(); });
tray.querySelector('[data-tray-link]').addEventListener('click', (e) => { if (read().length < 2) e.preventDefault(); });
sync();
