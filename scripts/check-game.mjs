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

for (const token of ['function playerBlocked', 'function ceilingAbove', 'function floorBelow', 'function playerInWater', 'function waterSurfaceAt', 'function generateChunk', 'function streamWorld', 'function save()', 'function switchWorld', 'function showDeath', 'function respawnPlayer', 'requestAnimationFrame(animate)', 'renderer.render(scene,camera)']) {
  assert(moduleCode.includes(token), `Missing core game system: ${token}`);
}

assert.match(moduleCode, /Math\.abs\(\(p\.y-EYE_HEIGHT\)-c\.g\.position\.y\)<2\.6/, 'Hostile mobs must be vertically near the player before they can attack');
assert.match(moduleCode, /function respawnPlayer\(\)[\s\S]*?jumpbtn'\)\.style\.display='flex'/, 'Respawning must restore the jump button');
assert.match(moduleCode, /function respawnPlayer\(\)[\s\S]*?sprintbtn'\)\.style\.display='flex'/, 'Respawning must restore the sprint button');

assert.match(moduleCode, /blockworld-save/, 'Existing local save key must be preserved');
assert.match(moduleCode, /worldEdits/, 'World edit persistence must remain present');
assert.doesNotMatch(moduleCode, /localStorage\.clear\(/, 'Game must never clear all local storage');
assert.match(moduleCode, /Math\.abs\(x-cx\)>1\|\|Math\.abs\(z-cz\)>1/, 'Distant streamed chunks must be unloaded to limit mobile memory');
assert.doesNotMatch(moduleCode, /oxygenrow'\)\.style\.display=p\.x>22\.2/, 'Oxygen indicator must not use the old false-water coordinate band');

assert.match(moduleCode, /storage:window\.localStorage/, 'Account sessions must persist in browser local storage');
assert.match(moduleCode, /storageKey:'sb-mfhytrxfxfxnpsbkzlbu-auth-token'/, 'Account session storage key must remain stable');
assert.match(moduleCode, /persistSession:true/, 'Supabase session persistence must be enabled');
assert.match(moduleCode, /autoRefreshToken:true/, 'Supabase access tokens must refresh automatically');
assert.match(moduleCode, /supabase\.auth\.getSession\(\)/, 'Saved account session must be restored on startup');
assert.match(moduleCode, /supabase\.auth\.onAuthStateChange/, 'Auth changes must update the current account state');
assert.match(moduleCode, /function renderFriends\(\)/, 'Friend list renderer must exist');
assert.match(moduleCode, /friendNames\.map\(n=>n\+\(online\.has\(n\)\?' · ONLINE':''\)\)/, 'Online presence must augment rather than replace the friends list');
assert.match(moduleCode, /friend_requests'\)\.update\(\{status:'accepted'\}\)/, 'Incoming friend requests must be accept-able');
assert.match(moduleCode, /profiles'\)\.update\(\{username:localPlayerName/, 'Changing multiplayer name must update searchable profile');
assert.match(sql, /create trigger blockworld_friend_accept after update of status on public\.friend_requests/i, 'Accepting a request must trigger friendship creation');
assert.match(sql, /values \(new\.from_user,new\.to_user\)/, 'Accepted request must create the sender friendship row');
assert.match(sql, /values \(new\.to_user,new\.from_user\)/, 'Accepted request must create the recipient friendship row');


// Adventurer Update: progression tiers, treasure, and generated structures.
assert.match(moduleCode, /function buildAdventureStructure\(/, 'Adventure structure generator must exist');
assert.match(moduleCode, /buildAdventureStructure\('castle'/, 'Rare castles must generate in explored chunks');
assert.match(moduleCode, /buildAdventureStructure\('temple'/, 'Desert temples must generate');
assert.match(moduleCode, /buildAdventureStructure\('ruin'/, 'Jungle ruins must generate');
assert.match(moduleCode, /buildAdventureStructure\('tower'/, 'Watchtowers must generate');
assert.match(moduleCode, /castle_chest|temple_chest|ruin_chest|tower_chest/, 'Structures must contain unique treasure chests');
assert.match(moduleCode, /p\.claimedChests/, 'Structure treasure must only be claimed once and persist in the save');
assert.match(moduleCode, /requiredTier=\{stone:0,coal:0,copper:0,iron:1,gold:1,diamond_ore:2,obsidian:2,ancient_shard:3\}/, 'Ore mining must require progressively better pickaxes');
assert.match(moduleCode, /pickaxeTiers=\{pickaxe:0,stone_pickaxe:1,iron_pickaxe:2,diamond_pickaxe:3\}/, 'Pickaxe tiers must be defined');
assert.match(moduleCode, /out:'stone_pickaxe'.*out:'iron_pickaxe'.*out:'diamond_pickaxe'/, 'Stone, iron, and diamond pickaxes must be craftable');
assert.match(moduleCode, /diamond_ore:tex/, 'Diamond ore must have a visual material');
assert.match(moduleCode, /ancient_shard:tex/, 'Ancient shards must have a visual material');
assert.match(moduleCode, /function buildAdventureStructure/, 'Adventure structure builder must exist');

assert.match(moduleCode, /function buildBossDungeon\(/, 'Rare boss dungeon generator must exist');
assert.match(moduleCode, /rnd\(cx\+1771,cz-911\)>.94/, 'Boss dungeons must be rare world discoveries');
assert.match(moduleCode, /guard\.dungeonBoss=true/, 'Dungeon guards must be marked as boss enemies');
assert.match(moduleCode, /DUNGEON BOSS DEFEATED/, 'Dungeon boss must award a special reward');
assert.match(moduleCode, /function buildVillageExtras\(/, 'Expanded village features must be generated');
assert.match(moduleCode, /buildVillageExtras\(\)/, 'Expanded village must be placed in the starting world');
assert.match(moduleCode, /p\.food>=100/, 'Health regeneration must require a full hunger bar');
assert.match(moduleCode, /p\.regenTimer>=4/, 'Full-hunger health regeneration must tick over time');
assert.match(moduleCode, /function eatFood\(item\)/, 'Food eating handler must exist');
assert.match(html, /id="eatbtn"/, 'Touch-friendly eat button must exist');
assert.match(moduleCode, /foodGain=item==='cooked_meat'\?32:item==='fish'\?18:8/, 'Food types must restore different hunger amounts');
assert.match(moduleCode, /physicsSteps=Math\.max\(1,Math\.ceil\(dt\/\(1\/120\)\)\)/, 'Vertical movement must use small physics substeps for smoother jumps');
assert.match(moduleCode, /setPixelRatio\(Math\.min\(devicePixelRatio,1\.05\)\)/, 'Mobile rendering resolution must be capped for performance');
assert.match(moduleCode, /antialias:false/, 'Mobile renderer must avoid costly multisample antialiasing');
assert.match(moduleCode, /bottom=h-6/, 'Base terrain mesh count must be limited');
assert.match(moduleCode, /const bottom=top-6/, 'Streamed terrain mesh count must be limited');
assert.match(moduleCode, /for\(let wy=-2;wy<=3;wy\+\+\)\{const wk=key\(x,wy,z\)/, 'Streamed ocean must generate a full water column');
assert.match(moduleCode, /for\(let wy=-2;wy<=3;wy\+\+\)block\(x,wy,z,'water'\)/, 'The underwater region must fill water beneath its surface');

// World expansion regression checks.
for (const token of ["function renderWorldTools()", "function openWorldSettings()", "function buildEdit(", "copybuild", "rotatebuild", "pastebuild", "fillbuild", "startquest", "p.quest.targets", "p.achievements", "difficultysetting", "terrainsetting", "worldlimitsetting", "timesetting", "weathersetting", "awardAchievement('first_kill'", "buildAdventureStructure('mine'", "buildAdventureStructure('waterfall'", "shipwreck_chest", "mine_chest", "playerskin", "remoteSkinColor", "saveQuietly();netStatus('Joined shared world:"]) {
  assert(moduleCode.includes(token), `Missing world expansion feature: ${token}`);
}
assert.match(moduleCode, /p\.difficulty==='peaceful'/, 'Peaceful difficulty must suppress hostile damage');
assert.match(moduleCode, /p\.difficulty==='hard'\?1\.45/, 'Hard difficulty must increase incoming damage');
assert.match(moduleCode, /worldLimit!=='endless'/, 'Optional world boundaries must be enforced');
assert.match(moduleCode, /function buildEdit\(x,y,z,t\)[\s\S]*?return false;[\s\S]*?return true/, 'Build tools must not place blocks inside the player and must report successful placements');
assert.match(moduleCode, /function updateQuestProgress\(item\)/, 'Gathering quest progress must update when resources are mined');
assert.match(moduleCode, /out:'chair'.*out:'table'.*out:'barrel'/, 'Furniture must be craftable');
assert.match(moduleCode, /type:'world',name:activeWorld,blocks:/, 'Host must share a named world snapshot with a joining player');
assert.match(moduleCode, /const ceiling=ceilingAbove\(p\.x,p\.z,previousFeet,nextFeet\);if\(ceiling>-Infinity\)\{nextFeet=ceiling-PLAYER_HEIGHT;p\.vy=0\}/, 'Jumping into a ceiling must clamp the player below the block');

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
  blocks.set(key(0,3,0), {type:'stone'});
  const ceiling=ceilingAbove(0,0,.5,2.0);
  if (ceiling !== 2.5) throw new Error('Ceiling collision did not find the underside of the overhead block');
  if (ceiling-1.8 > 2.0) throw new Error('Ceiling resolution would leave the player inside the block');
  if (playerBlocked(0,0,ceiling-1.8)) throw new Error('Player must be free immediately below a ceiling block');
  blocks.clear();
  for(let y=-2;y<=3;y++)blocks.set(key(0,y,0),{type:'water'});
  if(!playerInWater(0,0,.5))throw new Error('Full water column did not register as water');
  if(waterSurfaceAt(0,0)!==3.5)throw new Error('Full water column has the wrong surface height');
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
