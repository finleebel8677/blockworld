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
assert.match(moduleCode, /for\s*\(const ev of \['pointerup','pointercancel','lostpointercapture'\]\)/, 'Sprint must listen for release and cancellation');
assert.match(moduleCode, /setSprinting\(false\)/, 'Sprint must clear its active state on release');
assert.match(moduleCode, /jumpbtn'\)\.addEventListener\('pointerdown'/, 'Jump must respond to touch-down');
assert.doesNotMatch(moduleCode, /jumpbtn'\)\.addEventListener\('click'/, 'Jump must not be triggered twice by pointer + click');
assert.match(moduleCode, /baseSpeed\*1\.65/, 'Sprint speed multiplier must be present');

for (const token of ['function playerBlocked', 'function floorBelow', 'function playerInWater', 'function waterSurfaceAt', 'function generateChunk', 'function streamWorld', 'function save()', 'function switchWorld', 'function showDeath', 'function respawnPlayer', 'requestAnimationFrame(animate)', 'renderer.render(scene,camera)']) {
  assert(moduleCode.includes(token), `Missing core game system: ${token}`);
}
assert.match(moduleCode, /blockworld-save/, 'Existing local save key must be preserved');
assert.match(moduleCode, /worldEdits/, 'World edit persistence must remain present');
assert.doesNotMatch(moduleCode, /localStorage\.clear\(/, 'Game must never clear all local storage');
assert.match(moduleCode, /Math\.abs\(x-cx\)>1\|\|Math\.abs\(z-cz\)>1/, 'Distant streamed chunks must be unloaded to limit mobile memory');
assert.doesNotMatch(moduleCode, /oxygenrow'\)\.style\.display=p\.x>22\.2/, 'Oxygen indicator must not use the old false-water coordinate band');

assert.match(moduleCode, /cdn\.jsdelivr\.net\/npm\/three/, 'Primary Three.js source must exist');
assert.match(moduleCode, /unpkg\.com\/three/, 'Fallback Three.js source must exist');

for (const table of ['profiles', 'player_saves', 'friend_requests', 'friendships']) {
  assert.match(sql, new RegExp('alter table public\.' + table + ' enable row level security', 'i'), `${table} must have row-level security enabled`);
}
assert.equal(manifest.orientation, 'landscape', 'Mobile game must remain landscape-oriented');
assert.equal(manifest.display, 'standalone', 'PWA must remain standalone');

// Execute the real collision, floor, water and jump helpers against a tiny test world.
const physicsStart = moduleCode.indexOf('const PLAYER_RADIUS=');
const physicsEnd = moduleCode.indexOf('function jump()', physicsStart);
assert(physicsStart >= 0 && physicsEnd > physicsStart, 'Physics helper section must be discoverable');
const physicsCode = moduleCode.slice(physicsStart, physicsEnd);
const physicsContext = vm.createContext({ blocks: new Map(), key: (x, y, z) => x + ',' + y + ',' + z });
vm.runInContext(physicsCode, physicsContext);
vm.runInContext(`
  blocks.set(key(0,0,0), {type:'stone'});
  if (floorBelow(0,0,.5) !== .5) throw new Error('Ground detection missed a floor block');
  if (playerBlocked(0,0,.5)) throw new Error('Player was blocked by the floor beneath their feet');
  blocks.set(key(0,1,0), {type:'stone'});
  if (!playerBlocked(0,0,.5)) throw new Error('Player collision missed a solid body block');
  blocks.clear();
  blocks.set(key(0,0,0), {type:'water'});
  if (!playerInWater(0,0,-.4)) throw new Error('Water overlap was not detected');
  if (playerInWater(0,0,.6)) throw new Error('Water was detected when the player was above it');
  if (waterSurfaceAt(0,0) !== .5) throw new Error('Water surface height is incorrect');
`, physicsContext);

const jumpStart = moduleCode.indexOf('function jump()');
const jumpEnd = moduleCode.indexOf('let nightSpawnTimer', jumpStart);
assert(jumpStart >= 0 && jumpEnd > jumpStart, 'Jump function must be discoverable');
const jumpCode = moduleCode.slice(jumpStart, jumpEnd);
const jumpContext = vm.createContext({
  p: {x:0,y:2.12,z:0,vy:0,paused:false,horseActive:false},
  EYE_HEIGHT:1.62,
  playerInWater: () => false,
  floorBelow: () => .5,
  $: () => ({style:{display:'none'}}),
  toast: () => {}, save: () => {}
});
vm.runInContext(jumpCode, jumpContext);
vm.runInContext('jump(); if(p.vy !== 8.2) throw new Error("Ground jump failed"); p.vy=0; p.y=5; jump(); if(p.vy !== 0) throw new Error("Mid-air jump should not retrigger");', jumpContext);
jumpContext.playerInWater = () => true;
vm.runInContext('p.y=1.22; jump(); if(p.vy !== 7.2) throw new Error("Water jump failed");', jumpContext);

// Confirm a second finger releasing cannot cancel the joystick's captured pointer.
const joyStart = moduleCode.indexOf('function joyEnd(e)');
const joyEnd = moduleCode.indexOf('joy.addEventListener', joyStart);
assert(joyStart >= 0 && joyEnd > joyStart, 'Joystick release handler must be discoverable');
const joyCode = moduleCode.slice(joyStart, joyEnd);
const joyContext = vm.createContext({
  move: {active:true,pointerId:7,x:1,z:-1},
  stick: {style:{transform:'held'}}
});
vm.runInContext(joyCode, joyContext);
vm.runInContext('joyEnd({pointerId:8}); if(!move.active || move.x!==1) throw new Error("A different finger cancelled the joystick"); joyEnd({pointerId:7}); if(move.active || move.x!==0 || move.pointerId!==null) throw new Error("Joystick did not release on its own pointer");', joyContext);


console.log('BLOCKWORLD checks passed');
console.log(`HTML IDs: ${ids.length}; DOM references: ${new Set(refs).size}; module bytes: ${moduleCode.length}`);
console.log('Checked: JavaScript syntax, DOM IDs, multitouch, run/jump controls, physics hooks, world/save hooks, render loop, Supabase RLS, and PWA settings.');
