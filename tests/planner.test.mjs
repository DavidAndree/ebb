import assert from 'node:assert/strict';
import { plan, parseQuick, budgetFrom, learn, effectiveCost, fmtTime } from '../docs/js/planner.js';

// Quick-add parsing
const q = (s) => parseQuick(s);
assert.deepEqual([q('Write essay 90m focus ⚡4 !').minutes, q('Write essay 90m focus ⚡4 !').kind, q('Write essay 90m focus ⚡4 !').cost, q('Write essay 90m focus ⚡4 !').must, q('Write essay 90m focus ⚡4 !').title], [90, 'focus', 4, true, 'Write essay']);
assert.equal(q('Homework 3').title, 'Homework 3');           // bare digits stay in the title
assert.equal(q('Homework 3').kind, 'focus');
assert.equal(q('Email advisor').kind, 'admin');
assert.equal(q('Laundry 1h').minutes, 60);
assert.equal(q('Laundry 1h').kind, 'physical');
assert.equal(q('Doctor appointment @2:30pm 45m').at, 14 * 60 + 30);
assert.equal(q('Doctor appointment @2:30pm 45m').title, 'Doctor appointment');
assert.equal(q('Call mom 2 spoons').cost, 2);

// Budget
assert.equal(budgetFrom({ battery: 8, sleep: 'rough', pain: true }).budget, 4);
assert.equal(budgetFrom({ battery: 1, sleep: 'rough', pain: true, fog: true }).budget, 1);

// Learning stays bounded
let L = {}; for (let i = 0; i < 20; i++) L = learn(L, 'admin', 'heavier');
assert.equal(L.admin, 1.6);
assert.equal(effectiveCost({ cost: 2, kind: 'focus' }, {}, { fog: true }), 3);

// Planning
const tasks = [
  { id: 'a', title: 'Write lab report', kind: 'focus', cost: 4, minutes: 90, must: true },
  { id: 'b', title: 'Email advisor', kind: 'admin', cost: 1, minutes: 30, must: false },
  { id: 'c', title: 'Groceries', kind: 'physical', cost: 2, minutes: 60, must: false },
  { id: 'd', title: 'Study group', kind: 'social', cost: 3, minutes: 60, must: false, at: 15 * 60 },
  { id: 'e', title: 'Deep clean kitchen', kind: 'physical', cost: 4, minutes: 90, must: false },
  { id: 'f', title: 'Read chapter 5', kind: 'focus', cost: 3, minutes: 60, must: false },
];
const p = plan(tasks, { battery: 9, sleep: 'ok', chronotype: 'lark' });
const show = (r) => r.blocks.map((b) => `${fmtTime(b.start)}-${fmtTime(b.end)} ${b.title} (${b.cost}) — ${b.reason}`).join('\n') + '\nDEFERRED: ' + r.deferred.map((d) => `${d.title}: ${d.why}`).join(' | ') + `\nused ${r.used}/${r.budget}`;
console.log(show(p));
const report = p.blocks.find((b) => b.id === 'a');
assert.ok(report.start >= 8 * 60 && report.start <= 10 * 60, 'heavy must-do lands in the lark peak');
assert.equal(p.blocks.find((b) => b.id === 'd').start, 15 * 60, 'fixed time respected');
assert.ok(p.blocks.some((b) => b.kind === 'rest'), 'recovery inserted after heavy work');
assert.ok(p.used <= p.budget, 'stays within budget when nothing must exceed it');
assert.ok(p.deferred.length >= 1, 'something is deferred on a 9-spoon day with 17 spoons of tasks');
for (const d of p.deferred) assert.ok(d.why.length > 10, 'every deferral explains itself');
// no overlaps
const sorted = [...p.blocks].sort((x, y) => x.start - y.start);
for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].start >= sorted[i - 1].end, 'no overlapping blocks');

const owl = plan(tasks, { battery: 9, sleep: 'ok', chronotype: 'owl' });
assert.ok(owl.blocks.find((b) => b.id === 'a').start >= 14 * 60, 'night owls get their heavy work later');
const rough = plan(tasks, { battery: 9, sleep: 'rough', pain: true, chronotype: 'lark' });
assert.ok(rough.budget < p.budget && rough.blocks.length < p.blocks.length, 'a rough day plans less');
console.log('\nrough day:\n' + show(rough));
console.log('\n✔ all planner tests passed');
