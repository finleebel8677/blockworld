import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sql = fs.readFileSync(new URL('../supabase-setup.sql', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
assert.deepEqual(duplicates, [], 'HTML must not contain duplicate IDs');

const refs = [...html.matchAll(/\$\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
const missing = [...new Set(refs.filter(id => !ids.includes(id)))];
assert.deepEqual(missing, [], 'Every static $(id) reference must have a matching HTML element');

const modules = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
assert.equal(modules.length, 1, 'Expected exactly one game module');
const moduleCode = modules[0][1].replace(/^\s*import\s+.*?;\s*$/gm, '');
assert.doesNotThrow(() => new vm.Script('(async()=>{\n' + moduleCode + '\n})()'), 'Game module must parse');

for (const id of ['joy', 'stick', 'jumpbtn', 'sprintbtn', 'hotbar', 'inventory', 'play']) {
  assert(ids.includes(id), `Missing required gameplay element: ${id}`);
}

assert.match(moduleCode, /move\.pointerId=e\.pointerId/, 'Joystick must own its active pointer');
assert.match(moduleCode, /e\.pointerId!==move\.pointerId/, 'Other fingers must not cancel joystick movement');
assert.match(moduleCode, /sprintBtn\.addEventListener\('pointerdown'/, 'Sprint must respond to touch-down');
assert.match(moduleCode, /sprintBtn\.addEventListener\('pointerup'/, 'Sprint must stop on release');
assert.match(moduleCode, /jumpbtn'\)\.addEventListener\('pointerdown'/, 'Jump must respond to touch-down');
assert.doesNotMatch(moduleCode, /jumpbtn'\)\.addEventListener\('click'/, 'Jump must not be triggered twice by pointer + click');
assert.match(moduleCode, /baseSpeed\*1\.65/, 'Sprint speed multiplier must be present');

for (const token of ['function playerBlocked', 'function floorBelow', 'function playerInWater', 'function waterSurfaceAt', 'function generateChunk', 'function streamWorld', 'function save()', 'function switchWorld', 'function showDeath', 'function respawnPlayer', 'requestAnimationFrame(animate)', 'renderer.render(scene,camera)']) {
  assert(moduleCode.includes(token), `Missing core game system: ${token}`);
}
assert.match(moduleCode, /blockworld-save/, 'Existing local save key must be preserved');
assert.match(moduleCode, /worldEdits/, 'World edit persistence must remain present');
assert.doesNotMatch(moduleCode, /localStorage\.clear\(/, 'Game must never clear all local storage');
assert.match(moduleCode, /cdn\.jsdelivr\.net\/npm\/three/, 'Primary Three.js source must exist');
assert.match(moduleCode, /unpkg\.com\/three/, 'Fallback Three.js source must exist');

for (const table of ['profiles', 'player_saves', 'friend_requests', 'friendships']) {
  assert.match(sql, new RegExp('alter table public\.' + table + ' enable row level security', 'i'), `${table} must have row-level security enabled`);
}
assert.equal(manifest.orientation, 'landscape', 'Mobile game must remain landscape-oriented');
assert.equal(manifest.display, 'standalone', 'PWA must remain standalone');

console.log('BLOCKWORLD checks passed');
console.log(`HTML IDs: ${ids.length}; DOM references: ${new Set(refs).size}; module bytes: ${moduleCode.length}`);
console.log('Checked: JavaScript syntax, DOM IDs, multitouch, run/jump controls, physics hooks, world/save hooks, render loop, Supabase RLS, and PWA settings.');
