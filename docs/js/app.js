import { KINDS, CHRONOTYPES, plan, parseQuick, learn, fmtTime, SLOT } from './planner.js?v=1';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);
const today = () => new Date().toISOString().slice(0, 10);
const KEY = 'ebb:v1';

const SAMPLE = {
  check: { battery: 11, sleep: 'rough', pain: false, fog: false, chronotype: 'lark' },
  tasks: [
    'Write lab report 90m ⚡4 !', 'Email advisor about extension 20m ⚡1 !', 'Call pharmacy about refill 15m ⚡1',
    'Study group @3pm 60m social ⚡3', 'Groceries 45m ⚡2', 'Laundry 60m ⚡2', 'Read chapter 5 60m focus ⚡3', 'Gym 45m physical ⚡3',
  ],
};

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (!s) return null;
    if (s.date !== today()) { s.tasks = s.tasks.filter((t) => !t.done); s.date = today(); }
    return s;
  } catch { return null; }
}
let state = load() || { date: today(), check: { battery: 7, sleep: 'ok', pain: false, fog: false, chronotype: 'lark' }, startHour: 8, endHour: 21, tasks: [], learned: {}, feedback: 0 };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ } };
let current = null;

/* ---------- check-in ---------- */
const SPOON = '<svg viewBox="0 0 26 44" aria-hidden="true"><path d="M13 1c5.5 0 9 4.6 9 10.2 0 4.8-2.7 8.4-6.4 9.6l1.1 19.6c.1 1.9-1.6 3.6-3.7 3.6s-3.8-1.7-3.7-3.6l1.1-19.6C6.7 19.6 4 16 4 11.2 4 5.6 7.5 1 13 1z"/></svg>';
function renderSpoons() {
  const b = state.check.battery;
  $('#spoons').innerHTML = Array.from({ length: 12 }, (_, i) => i + 1).map((n) =>
    `<button class="spoon${n <= b ? ' on' : ''}" role="radio" aria-checked="${n === b}" tabindex="${n === b ? 0 : -1}" aria-label="${n} spoon${n === 1 ? '' : 's'}" data-n="${n}">${SPOON}</button>`).join('');
  const words = b <= 3 ? 'a low-battery day. Ebb will protect what matters.' : b <= 6 ? 'a medium day. Pace it.' : b <= 9 ? 'a decent day.' : 'a strong day. Still worth pacing.';
  $('#battery-read').textContent = `${b} spoon${b === 1 ? '' : 's'}: ${words}`;
}
function bindCheckin() {
  $('#spoons').addEventListener('click', (e) => { const b = e.target.closest('[data-n]'); if (b) setBattery(+b.dataset.n); });
  $('#spoons').addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (d) { e.preventDefault(); setBattery(Math.min(12, Math.max(1, state.check.battery + d))); $('#spoons [aria-checked="true"]').focus(); }
  });
  document.querySelectorAll('input[name="sleep"]').forEach((r) => { r.checked = r.value === state.check.sleep; r.addEventListener('change', () => { state.check.sleep = r.value; update(); }); });
  for (const k of ['pain', 'fog']) { const c = $(`input[name="${k}"]`); c.checked = !!state.check[k]; c.addEventListener('change', () => { state.check[k] = c.checked; update(); }); }
  const ct = $('#chronotype'); ct.value = state.check.chronotype; ct.addEventListener('change', () => { state.check.chronotype = ct.value; update(); });
  const hours = (sel, from, to, val) => { sel.innerHTML = Array.from({ length: to - from + 1 }, (_, i) => from + i).map((h) => `<option value="${h}"${h === val ? ' selected' : ''}>${fmtTime(h * 60).replace(':00', '')}</option>`).join(''); };
  hours($('#start-hour'), 5, 14, state.startHour); hours($('#end-hour'), 15, 23, state.endHour);
  $('#start-hour').addEventListener('change', (e) => { state.startHour = +e.target.value; update(); });
  $('#end-hour').addEventListener('change', (e) => { state.endHour = +e.target.value; update(); });
}
function setBattery(n) { state.check.battery = n; renderSpoons(); update(); }

/* ---------- tasks ---------- */
function renderTasks() {
  const list = $('#task-list');
  if (!state.tasks.length) { list.innerHTML = '<li class="empty">Nothing yet. Add what’s on your mind, or try a sample day.</li>'; return; }
  list.innerHTML = state.tasks.map((t) => `
    <li class="task${t.done ? ' done' : ''}" data-id="${t.id}">
      <span class="kdot" style="background:${KINDS[t.kind].color}" aria-hidden="true"></span>
      <div class="t"><b>${esc(t.title)}</b><small>${KINDS[t.kind].label} · ${t.minutes} min${t.at != null ? ` · at ${fmtTime(t.at)}` : ''}${t.done ? ' · done ✓' : ''}</small></div>
      <div class="ctrl">
        <select data-f="kind" aria-label="Kind of task">${Object.entries(KINDS).filter(([k]) => k !== 'rest').map(([k, v]) => `<option value="${k}"${k === t.kind ? ' selected' : ''}>${v.label}</option>`).join('')}</select>
        <button data-act="cost-" aria-label="Fewer spoons">−</button>
        <span class="cost" aria-label="${t.cost} spoons">⚡${t.cost}</span>
        <button data-act="cost+" aria-label="More spoons">+</button>
        <button class="must" data-act="must" aria-pressed="${!!t.must}" title="Must happen today">!</button>
        <button data-act="del" aria-label="Remove ${esc(t.title)}">✕</button>
      </div>
    </li>`).join('');
}
function bindTasks() {
  $('#quick').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#quick-input').value.trim(); if (!v) return;
    const t = parseQuick(v);
    if (!t.title) { toast('Give the task a name.'); return; }
    state.tasks.push({ id: uid(), ...t });
    $('#quick-input').value = '';
    update();
    toast(`Added “${t.title}”: ${KINDS[t.kind].label}, ${t.minutes} min, ⚡${t.cost}${t.must ? ', must-do' : ''}`);
  });
  $('#task-list').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
    const t = state.tasks.find((x) => x.id === e.target.closest('[data-id]').dataset.id);
    if (act === 'cost-') t.cost = Math.max(1, t.cost - 1);
    if (act === 'cost+') t.cost = Math.min(5, t.cost + 1);
    if (act === 'must') t.must = !t.must;
    if (act === 'del') state.tasks = state.tasks.filter((x) => x !== t);
    update();
  });
  $('#task-list').addEventListener('change', (e) => {
    if (e.target.dataset.f !== 'kind') return;
    state.tasks.find((x) => x.id === e.target.closest('[data-id]').dataset.id).kind = e.target.value; update();
  });
}

/* ---------- plan ---------- */
function renderPlan() {
  const p = current = plan(state.tasks, state.check, { startHour: state.startHour, endHour: state.endHour, learned: state.learned });
  const real = p.blocks.filter((b) => b.kind !== 'rest');
  $('#day-sub').textContent = state.tasks.filter((t) => !t.done).length
    ? `${real.length} task${real.length === 1 ? '' : 's'} today · ${p.used} of ${p.budget} spoons${p.over ? ` · ${p.used - p.budget} over: must-dos come first` : ` · ${p.budget - p.used} held in reserve for surprises`}`
    : 'Add a few tasks and Ebb will shape them around your energy.';
  const n = Math.max(p.budget, p.used);
  $('#meter').innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < Math.min(p.used, p.budget) ? 'used' : i >= p.budget ? 'over' : ''}"></i>`).join('');
  $('#meter').setAttribute('aria-label', `${p.used} of ${p.budget} spoons planned`);
  $('#adjust').innerHTML = [`<span>Base ${state.check.battery}</span>`, ...p.adjustments.map((a) => `<span class="${a.delta < 0 ? 'neg' : 'pos'}">${esc(a.why)} ${a.delta > 0 ? '+' : ''}${a.delta}</span>`), `<span>= ${p.budget} spoons today</span>`, `<span>${CHRONOTYPES[state.check.chronotype]}</span>`].join('');
  renderTimeline(p);
  $('#agenda').innerHTML = p.blocks.map((b, i) => `
    <li class="ag ${b.kind === 'rest' ? 'rest' : ''}" style="--k:${KINDS[b.kind].color};animation-delay:${i * 40}ms">
      <time>${fmtTime(b.start)}<br><small>${fmtTime(b.end)}</small></time>
      <div><b>${esc(b.title)}</b><small><span class="why${/over budget/.test(b.reason) ? ' over' : ''}">${esc(b.reason)}</span>${b.kind !== 'rest' ? ` · ${KINDS[b.kind].label} · ⚡${b.cost}` : ''}</small></div>
      ${b.kind !== 'rest' ? `<button class="btn small done-btn" data-done="${b.id}" aria-label="Mark ${esc(b.title)} done">Done</button>` : '<span aria-hidden="true">🌊</span>'}
    </li>`).join('') || '';
  $('#defer').innerHTML = p.deferred.map((d) => `<li><b>${esc(d.title)}</b><small>${esc(d.why)}</small></li>`).join('') || '<li><small>Everything fits today. Nice.</small></li>';
}

function renderTimeline(p) {
  const W = 720; const H = 210; const top = 10; const curveH = 110; const laneY = 150; const laneH = 36;
  const x0 = state.startHour * 60; const x1 = state.endHour * 60;
  const X = (m) => ((m - x0) / (x1 - x0)) * W;
  const pts = p.slots.map((s) => [X(s.start + SLOT / 2), top + curveH - s.cap * curveH]);
  const line = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
  const area = `M0,${top + curveH} L${pts.map((q) => q.join(',')).join(' L')} L${W},${top + curveH} Z`;
  let ticks = '';
  for (let h = state.startHour; h <= state.endHour; h += 2) ticks += `<text x="${X(h * 60)}" y="${H - 4}" text-anchor="middle">${fmtTime(h * 60).replace(':00', '')}</text>`;
  const now = new Date(); const nm = now.getHours() * 60 + now.getMinutes();
  const nowLine = nm > x0 && nm < x1 ? `<line class="now" x1="${X(nm)}" x2="${X(nm)}" y1="${top}" y2="${laneY + laneH}"/><text x="${X(nm) + 4}" y="${top + 10}" style="font:700 10px var(--body);fill:var(--coral)">now</text>` : '';
  const blocks = p.blocks.map((b) => {
    const x = X(b.start); const w = Math.max(6, X(b.end) - X(b.start) - 2);
    const label = w > 60 ? esc(b.title.length > Math.floor(w / 6.2) ? b.title.slice(0, Math.floor(w / 6.2) - 1) + '…' : b.title) : '';
    return `<g class="blk ${b.kind === 'rest' ? 'rest' : ''}" tabindex="0" role="img" aria-label="${esc(b.title)}, ${fmtTime(b.start)} to ${fmtTime(b.end)}. ${esc(b.reason)}">
      <title>${esc(b.title)} · ${fmtTime(b.start)}–${fmtTime(b.end)} · ${esc(b.reason)}</title>
      <rect x="${x + 1}" y="${laneY}" width="${w}" height="${laneH}" fill="${KINDS[b.kind].color}"/>
      <line x1="${x + w / 2}" x2="${x + w / 2}" y1="${laneY}" y2="${top + curveH - (p.slots.find((s) => s.start === b.start)?.cap ?? 0) * curveH}" stroke="${KINDS[b.kind].color}" stroke-width="1.5" stroke-dasharray="2 3" opacity=".7"/>
      <text x="${x + 8}" y="${laneY + 22}">${label}</text></g>`;
  }).join('');
  $('#timeline').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Your energy across the day with tasks placed on it">
    <defs><linearGradient id="tideGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--tide)" stop-opacity=".45"/><stop offset="1" stop-color="var(--tide)" stop-opacity=".04"/></linearGradient>
      <pattern id="restHatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="var(--bg-2)"/><line x1="0" y1="0" x2="0" y2="8" stroke="var(--line)" stroke-width="4"/></pattern></defs>
    <text x="2" y="${top + 8}" style="font:700 10px var(--body);fill:var(--ink-3)">ENERGY</text>
    <path class="curve" d="${area}"/><path class="curve-line" d="${line}"/>
    <g class="axis">${ticks}</g>${nowLine}${blocks}</svg>`;
}

/* ---------- learning ---------- */
function renderLearned() {
  const rows = ['focus', 'admin', 'physical', 'social'].map((k) => {
    const v = state.learned[k] ?? 1; const pct = Math.round((v - 1) * 100);
    const w = Math.min(50, Math.abs(v - 1) / 0.6 * 50);
    return `<div class="lrow"><span>${KINDS[k].label}</span><span class="bar" aria-hidden="true"><i style="${v >= 1 ? 'left:50%' : `left:${50 - w}%`};width:${w}%;background:${v >= 1 ? 'var(--coral)' : 'var(--tide)'}"></i></span><b>${pct === 0 ? 'as estimated' : `${pct > 0 ? '+' : ''}${pct}%`}</b></div>`;
  }).join('');
  const worst = Object.entries(state.learned).filter(([, v]) => Math.abs(v - 1) >= 0.1).sort((a, b) => Math.abs(b[1] - 1) - Math.abs(a[1] - 1))[0];
  const insight = worst ? `<p class="insight">${KINDS[worst[0]].label} tasks cost you about ${Math.abs(Math.round((worst[1] - 1) * 100))}% ${worst[1] > 1 ? 'more' : 'less'} than you estimate. Ebb now budgets for that.</p>` : `<p class="sub">${state.feedback ? 'Keep rating tasks; patterns show up after a few days.' : 'No feedback yet. Tap “Done” on a task to start.'}</p>`;
  $('#learned-list').innerHTML = rows + insight;
}

/* ---------- actions ---------- */
function bindDay() {
  $('#agenda').addEventListener('click', (e) => {
    const id = e.target.closest('[data-done]')?.dataset.done; if (!id) return;
    const t = state.tasks.find((x) => x.id === id); if (!t) return;
    $('#feel-title').textContent = t.title;
    const dlg = $('#feel');
    dlg.onclose = () => {
      const v = dlg.returnValue;
      if (v === 'cancel' || !v) return;
      t.done = true; state.feedback++;
      state.learned = learn(state.learned, t.kind, v);
      update();
      toast(v === 'heavier' ? `Noted: ${KINDS[t.kind].label.toLowerCase()} tasks cost you more. Ebb adjusted.` : v === 'lighter' ? `Nice: ${KINDS[t.kind].label.toLowerCase()} tasks are lighter for you. Ebb adjusted.` : 'Done. Ebb’s estimate was right.');
    };
    dlg.returnValue = ''; dlg.showModal();
  });
  $('#btn-ics').addEventListener('click', () => {
    if (!current?.blocks.length) { toast('Nothing planned yet.'); return; }
    const d = new Date(); const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const t = (m) => `${ymd}T${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}00`;
    const e = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const ev = current.blocks.map((b) => ['BEGIN:VEVENT', `UID:${ymd}-${b.id}@ebb`, `DTSTAMP:${stamp}`, `DTSTART:${t(b.start)}`, `DTEND:${t(b.end)}`, `SUMMARY:${e(b.kind === 'rest' ? '🌊 Recharge' : `${b.title} (⚡${b.cost})`)}`, `DESCRIPTION:${e(b.reason)}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT5M', `DESCRIPTION:${e(b.title)}`, 'END:VALARM', 'END:VEVENT'].join('\r\n'));
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ebb//Energy planner//EN', ...ev, 'END:VCALENDAR'].join('\r\n') + '\r\n';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); a.download = `ebb-${ymd}.ics`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Calendar file downloaded. Open it to add today’s plan.');
  });
  $('#btn-copy').addEventListener('click', async () => {
    if (!current) return;
    const txt = [`My day (${current.used}/${current.budget} spoons)`, ...current.blocks.map((b) => `${fmtTime(b.start)}–${fmtTime(b.end)}  ${b.kind === 'rest' ? 'Recharge' : b.title}`), current.deferred.length ? `Tomorrow: ${current.deferred.map((d) => d.title).join(', ')}` : ''].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(txt); toast('Plan copied.'); } catch { toast('Copy not allowed here.'); }
  });
  $('#btn-sample').addEventListener('click', () => {
    state.check = { ...SAMPLE.check }; state.tasks = SAMPLE.tasks.map((s) => ({ id: uid(), ...parseQuick(s) }));
    syncCheckinInputs(); update(); toast('Sample day: rough sleep, 8 tasks. Now try switching on “Brain fog”.');
    if (innerWidth < 960) document.querySelector('.day').scrollIntoView({ behavior: 'smooth' });
  });
}
function syncCheckinInputs() {
  document.querySelectorAll('input[name="sleep"]').forEach((r) => { r.checked = r.value === state.check.sleep; });
  $('input[name="pain"]').checked = !!state.check.pain; $('input[name="fog"]').checked = !!state.check.fog;
  $('#chronotype').value = state.check.chronotype; renderSpoons();
}

/* ---------- display / a11y ---------- */
function bindA11y() {
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('ebb:a11y')) || {}; } catch { return {}; } })();
  const d = document.documentElement;
  const cur = { size: prefs.size || '1', font: prefs.font || 'atkinson', theme: prefs.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'), motion: prefs.motion || (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduce' : 'full'), contrast: prefs.contrast || 'normal' };
  const apply = () => {
    d.style.setProperty('--scale', cur.size); d.dataset.font = cur.font; d.dataset.theme = cur.theme; d.dataset.motion = cur.motion; d.dataset.contrast = cur.contrast;
    document.querySelectorAll('[data-a11y]').forEach((g) => g.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === cur[g.dataset.a11y])));
    try { localStorage.setItem('ebb:a11y', JSON.stringify(cur)); } catch { /* ignore */ }
  };
  document.querySelectorAll('[data-a11y]').forEach((g) => g.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { cur[g.dataset.a11y] = b.dataset.v; apply(); renderPlan(); } }));
  $('#btn-a11y').addEventListener('click', () => { const p = $('#a11y'); p.hidden = !p.hidden; $('#btn-a11y').setAttribute('aria-expanded', !p.hidden); });
  apply();
}

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3600); }
function update() { save(); renderTasks(); renderPlan(); renderLearned(); }

bindA11y(); bindCheckin(); bindTasks(); bindDay(); renderSpoons(); update();
