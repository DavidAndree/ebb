// Ebb planning engine: pure functions, no DOM. Tested in Node (tests/planner.test.mjs).
// A day is a grid of 30-minute slots. Each slot has an energy capacity (0..1) from your
// chronotype curve and today's check-in. Tasks cost "spoons" and are placed where your
// energy fits them, until today's budget runs out.

export const KINDS = {
  focus:    { label: 'Focus',    color: '#5b6cff', words: ['write', 'essay', 'study', 'code', 'read', 'report', 'design', 'plan', 'research', 'homework', 'exam', 'review', 'draft', 'math'] },
  admin:    { label: 'Admin',    color: '#d9822b', words: ['email', 'form', 'bill', 'pay', 'call', 'book', 'schedule', 'appointment', 'insurance', 'tax', 'apply', 'file', 'reply', 'refill'] },
  physical: { label: 'Physical', color: '#2a9d8f', words: ['gym', 'walk', 'clean', 'laundry', 'groceries', 'cook', 'dishes', 'shop', 'errand', 'yoga', 'run', 'vacuum', 'move', 'tidy'] },
  social:   { label: 'Social',   color: '#e76f51', words: ['meet', 'meeting', 'party', 'class', 'lecture', 'coffee', 'friend', 'family', 'visit', 'date', 'group', 'shift', 'interview'] },
  rest:     { label: 'Recharge', color: '#8aa0a6', words: [] },
};

// Hourly energy (0..1) for each chronotype, 6:00 → 23:00.
const CURVES = {
  lark:      { 6: .55, 7: .75, 8: .92, 9: 1, 10: .97, 11: .85, 12: .65, 13: .5, 14: .45, 15: .55, 16: .62, 17: .58, 18: .5, 19: .42, 20: .35, 21: .28, 22: .2, 23: .15 },
  afternoon: { 6: .3, 7: .42, 8: .58, 9: .75, 10: .88, 11: .92, 12: .7, 13: .6, 14: .72, 15: .9, 16: .95, 17: .82, 18: .66, 19: .55, 20: .45, 21: .36, 22: .28, 23: .2 },
  owl:       { 6: .15, 7: .22, 8: .32, 9: .42, 10: .52, 11: .62, 12: .66, 13: .62, 14: .7, 15: .8, 16: .88, 17: .95, 18: 1, 19: .97, 20: .9, 21: .8, 22: .65, 23: .5 },
};
export const CHRONOTYPES = { lark: 'Morning person', afternoon: 'Midday peak', owl: 'Night owl' };

export const SLOT = 30; // minutes

/** Today's spoon budget from the check-in. Every adjustment is returned so the UI can explain it. */
export function budgetFrom(check) {
  const adjustments = [];
  let b = check.battery;
  if (check.sleep === 'rough') { b -= 2; adjustments.push({ why: 'Rough sleep', delta: -2 }); }
  else if (check.sleep === 'rested') { b += 1; adjustments.push({ why: 'Well rested', delta: +1 }); }
  if (check.pain) { b -= 2; adjustments.push({ why: 'Pain or flare-up', delta: -2 }); }
  if (check.fog) { b -= 1; adjustments.push({ why: 'Brain fog', delta: -1 }); }
  return { budget: Math.max(1, b), adjustments };
}

/** Capacity of every 30-minute slot between start and end hour. */
export function curveFor(check, startHour, endHour) {
  const base = CURVES[check.chronotype] || CURVES.lark;
  const scale = check.sleep === 'rough' ? 0.85 : 1;
  const slots = [];
  for (let m = startHour * 60; m < endHour * 60; m += SLOT) {
    const h = Math.floor(m / 60); const f = (m % 60) / 60;
    const a = base[h] ?? 0.2; const b = base[h + 1] ?? a;
    slots.push({ start: m, cap: +(scale * (a + (b - a) * f)).toFixed(3) });
  }
  return slots;
}

/** Effective spoon cost: base cost × what Ebb has learned for this kind, +1 for focus work on a foggy day. */
export function effectiveCost(task, learned = {}, check = {}) {
  let c = task.cost * (learned[task.kind] ?? 1);
  if (check.fog && task.kind === 'focus') c += 1;
  return Math.max(1, Math.round(c));
}

const heavy = (cost) => cost >= 3;

/**
 * Plan the day.
 * tasks: [{id, title, kind, cost 1-5, minutes, must, at? (minutes from midnight)}]
 * Returns { blocks, deferred, used, budget, adjustments, slots }
 */
export function plan(tasks, check, { startHour = 8, endHour = 21, learned = {}, now = null } = {}) {
  const { budget, adjustments } = budgetFrom(check);
  // Pacing: hold a reserve for the unexpected. Only must-dos may spend it.
  const reserve = budget >= 5 ? Math.max(1, Math.round(budget * 0.12)) : 0;
  const slots = curveFor(check, startHour, endHour);
  const free = slots.map(() => true);
  const blocks = []; const deferred = [];
  let used = 0;
  const first = now != null ? Math.max(0, Math.ceil((now - startHour * 60) / SLOT)) : 0;
  const idxOf = (min) => Math.round((min - startHour * 60) / SLOT);

  const place = (task, i, n, reason, cost) => {
    for (let k = i; k < i + n; k++) free[k] = false;
    blocks.push({ ...task, cost, start: slots[i].start, end: slots[i].start + n * SLOT, reason });
    used += cost;
    // Recovery after heavy work, if the next slot is open.
    if (heavy(cost) && task.kind !== 'rest' && i + n < slots.length && free[i + n]) {
      free[i + n] = false;
      blocks.push({ id: `rest-${task.id}`, title: 'Recharge', kind: 'rest', cost: 0, start: slots[i + n].start, end: slots[i + n].start + SLOT, reason: `Recovery after “${task.title}”` });
    }
  };

  const withCost = tasks.filter((t) => !t.done).map((t) => ({ t, cost: effectiveCost(t, learned, check) }));

  // 1. Fixed-time tasks (appointments, shifts, classes) go exactly where they are.
  for (const { t, cost } of withCost.filter((x) => x.t.at != null)) {
    const i = idxOf(t.at); const n = Math.max(1, Math.ceil(t.minutes / SLOT));
    if (i < 0 || i + n > slots.length || free.slice(i, i + n).some((f) => !f)) {
      deferred.push({ ...t, cost, why: 'Its fixed time is outside today’s window or clashes with another fixed task' });
      continue;
    }
    place(t, i, n, 'Fixed time', cost);
  }

  // 2. Everything else: must-dos first, then the heaviest, so hard work claims your peaks.
  const rest = withCost.filter((x) => x.t.at == null)
    .sort((a, b) => (b.t.must - a.t.must) || (b.cost - a.cost) || (b.t.minutes - a.t.minutes));

  for (const { t, cost } of rest) {
    const n = Math.max(1, Math.ceil(t.minutes / SLOT));
    if (!t.must && used + cost > budget - reserve) {
      const left = Math.max(0, budget - reserve - used);
      deferred.push({ ...t, cost, why: left > 0
        ? `Needs ${cost} spoon${cost === 1 ? '' : 's'}; only ${left} left after your reserve`
        : used >= budget ? 'Today’s spoons are spoken for' : 'Would dip into your reserve spoon, which is kept for surprises' });
      continue;
    }
    let best = null;
    for (let i = first; i + n <= slots.length; i++) {
      if (free.slice(i, i + n).some((f) => !f)) continue;
      const cap = slots.slice(i, i + n).reduce((s, x) => s + x.cap, 0) / n;
      let score;
      if (heavy(cost) || t.kind === 'focus') score = cap;                   // hard work → your peaks
      else score = 0.65 - Math.abs(cap - 0.5);                              // light work → dips, keeps peaks free
      const prev = blocks.find((b) => b.end === slots[i].start);
      if (prev && heavy(prev.cost) && heavy(cost)) score -= 0.3;            // avoid back-to-back heavy blocks
      if (t.must) score += (slots.length - i) * 0.002;                      // must-dos lean earlier
      if (!best || score > best.score) best = { i, score, cap };
    }
    if (!best) { deferred.push({ ...t, cost, why: 'No open window long enough today' }); continue; }
    if (!t.must && (heavy(cost) || t.kind === 'focus') && best.cap < 0.45) {
      deferred.push({ ...t, cost, why: 'Only low-energy windows are left; it will go better tomorrow at your peak' });
      continue;
    }
    const reason = heavy(cost) || t.kind === 'focus'
      ? (best.cap >= 0.8 ? 'Peak energy window' : best.cap >= 0.6 ? 'Good energy window' : 'Best window left today')
      : (best.cap < 0.6 ? 'Low-energy slot: saves your peak for harder work' : 'Fits between heavier work');
    place(t, best.i, n, t.must && used + cost > budget ? `${reason} · must-do, over budget` : reason, cost);
  }

  blocks.sort((a, b) => a.start - b.start);
  return { blocks, deferred, used, budget, reserve, adjustments, slots, over: used > budget };
}

/** Learning: nudge a kind's multiplier from "lighter / as expected / heavier" feedback. */
export function learn(learned, kind, feel) {
  const cur = learned[kind] ?? 1;
  const next = feel === 'heavier' ? cur * 1.15 : feel === 'lighter' ? cur * 0.9 : cur * 0.98 + 0.02;
  return { ...learned, [kind]: Math.min(1.6, Math.max(0.6, +next.toFixed(3))) };
}

/** Quick-add: "Write essay 90m focus 4 !" → task. Duration, kind, spoons and must are all optional. */
export function parseQuick(text) {
  let s = ` ${text.trim()} `;
  const out = { must: false };
  const dur = s.match(/\s(\d+(?:\.\d+)?)\s?(h|hr|hrs|hours?|m|min|mins|minutes?)\b/i);
  if (dur) { const v = parseFloat(dur[1]); out.minutes = /^h/i.test(dur[2]) ? Math.round(v * 60) : Math.round(v); s = s.replace(dur[0], ' '); }
  const at = s.match(/\s@\s?(\d{1,2})(?::(\d{2}))?\s?(am|pm)?\b/i);
  if (at) { let h = +at[1]; if (/pm/i.test(at[3] || '') && h < 12) h += 12; if (/am/i.test(at[3] || '') && h === 12) h = 0; out.at = h * 60 + (+at[2] || 0); s = s.replace(at[0], ' '); }
  const spoons = s.match(/\s(?:⚡\s?([1-5])|([1-5])\s?spoons?)\s/i);
  if (spoons) { out.cost = +(spoons[1] || spoons[2]); s = s.replace(spoons[0], ' '); }
  if (/\s(!|must)\s/i.test(s)) { out.must = true; s = s.replace(/\s(!|must)\s/gi, ' '); }
  for (const k of Object.keys(KINDS)) {
    const re = new RegExp(`\\s#?${k}\\s`, 'i');
    if (re.test(s)) { out.kind = k; s = s.replace(re, ' '); }
  }
  out.title = s.replace(/\s+/g, ' ').trim();
  if (!out.kind) {
    const low = out.title.toLowerCase();
    out.kind = Object.entries(KINDS).find(([k, v]) => k !== 'rest' && v.words.some((w) => low.includes(w)))?.[0] || 'admin';
  }
  if (!out.minutes) out.minutes = { focus: 60, admin: 30, physical: 45, social: 60 }[out.kind] || 30;
  if (!out.cost) out.cost = Math.min(5, Math.max(1, Math.round(({ focus: 1.2, admin: 0.8, physical: 1, social: 1.1 }[out.kind] || 1) * (1 + out.minutes / 45))));
  return out;
}

export function fmtTime(min) {
  const h = Math.floor(min / 60); const m = min % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
