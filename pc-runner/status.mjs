// Live status of the speedrun bot in the console, redrawn every second: what it's doing, health, where it is, its gear,
// and how far along the run it is with the time of each milestone. Run it in a second window while a run plays:
//   node pc-runner\status.mjs
// The state comes from the bot's MindServer (port 8080) every second; the milestone times from serverdell's log (the
// advancements the bot makes), so they're right even when this starts partway through a run. Ctrl+C to close.
import { io } from 'socket.io-client';
import { execFile } from 'child_process';

const PORT = process.env.MINDSERVER_PORT || 8080;
const DELL = 'kieron@192.168.1.144';

// the advancements that mark each step of a run, in order
const MILESTONES = [
    ['Stone pickaxe', 'Getting an Upgrade'],
    ['Iron pickaxe', "Isn't It Iron Pick"],
    ['Into the nether', 'We Need to Go Deeper'],
    ['Blaze rod', 'Into Fire'],
    ['Into the end', 'The End?'],
    ['Ender dragon dead', 'Free the End'],
];

let state = null, lastState = 0, connected = false;
let runStart = null, reached = {}, deaths = [], lastLogCheck = 0;

const pad = (s, n) => String(s).padEnd(n);
const clock = (secs) => {
    if (secs == null || secs < 0) return '--:--';
    const h = Math.floor(secs / 3600), m = Math.floor(secs / 60) % 60, s = Math.floor(secs % 60);
    return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`;
};

function checkServerLog() {
    // the latest "andy joined" starts the run; the advancements and deaths after it are its milestones
    execFile('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', DELL,
        'journalctl -u minecraft.service --since -6h -o short-unix --no-pager | grep -E "andy (joined the game|has made the advancement|was |died|tried|fell|drowned|burned|blew|discovered|hit the ground|walked into|starved|suffocated)"'],
        { timeout: 15000, windowsHide: true }, (err, out) => {
            if (err && !out) return;
            const lines = String(out).trim().split('\n').filter(Boolean);
            let start = null, got = {}, died = [];
            for (const line of lines) {
                const t = Number(line.split(' ')[0]);
                if (/andy joined the game/.test(line)) { start = t; got = {}; died = []; continue; }
                if (start == null) continue;
                const adv = line.match(/advancement \[(.+?)\]/);
                if (adv && !(adv[1] in got)) got[adv[1]] = t - start;
                else if (!adv && !/joined/.test(line)) died.push({ t: t - start, text: line.replace(/^.*INFO]: /, '') });
            }
            if (start != null) { runStart = start; reached = got; deaths = died; }
        });
}

function draw() {
    const out = [];
    const now = Date.now() / 1000;
    const g = state?.gameplay, inv = state?.inventory, c = inv?.counts || {};
    const stale = !connected || !state || Date.now() - lastState > 5000;
    out.push(`ANDY SPEEDRUN   run time ${runStart ? clock(now - runStart) : '--:--'}   ${new Date().toLocaleTimeString()}${stale ? '   (waiting for the bot...)' : ''}`);
    out.push('-'.repeat(78));
    if (state && g) {
        const dim = (g.dimension || '').replace('minecraft:', '');
        const p = g.position || {};
        out.push(`Doing:   ${state.action?.current || '?'}`);
        out.push(`Health:  ${pad(g.health + '/20', 8)}Food: ${pad(g.hunger + '/20', 8)}${dim}  (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})  ${g.timeLabel || ''}`);
        const eq = inv.equipment || {};
        const armor = [eq.helmet, eq.chestplate, eq.leggings, eq.boots].filter(Boolean).join(', ') || 'none';
        out.push(`Holding: ${pad(eq.mainHand || 'nothing', 22)}Armor: ${armor}`);
        const mobs = (state.nearby?.entityTypes || []).filter(t => !['experience_orb', 'arrow'].includes(t));
        out.push(`Nearby:  ${mobs.join(', ') || 'nothing'}`);
    }
    out.push('');
    out.push('PROGRESS');
    const buckets = (c.bucket || 0) + (c.water_bucket || 0) + (c.lava_bucket || 0);
    const kitDone = buckets >= 2 && (c.flint_and_steel || c.fire_charge);
    const rows = [
        [MILESTONES[0][0], reached[MILESTONES[0][1]], ''],
        [MILESTONES[1][0], reached[MILESTONES[1][1]], ''],
        ['Portal kit', kitDone ? 'done' : undefined, `buckets ${buckets}/2, flint_and_steel ${c.flint_and_steel ? 'yes' : 'no'}, cobblestone ${c.cobblestone || 0}`],
        [MILESTONES[2][0], reached[MILESTONES[2][1]], ''],
        [MILESTONES[3][0], reached[MILESTONES[3][1]], `blaze rods ${(c.blaze_rod || 0)}/7`],
        ['Ender pearls', (c.ender_pearl || 0) >= 12 ? 'done' : undefined, `${c.ender_pearl || 0}/12, eyes of ender ${c.ender_eye || 0}/12`],
        [MILESTONES[4][0], reached[MILESTONES[4][1]], ''],
        [MILESTONES[5][0], reached[MILESTONES[5][1]], ''],
    ];
    for (const [name, at, detail] of rows) {
        const done = at !== undefined;
        out.push(`  [${done ? 'x' : ' '}] ${pad(name, 20)}${pad(done ? (typeof at === 'number' ? clock(at) : at) : '', 9)}${done ? '' : detail}`);
    }
    out.push('');
    const keys = ['iron_ingot', 'raw_iron', 'gold_ingot', 'raw_gold', 'coal', 'cobblestone', 'cooked_beef', 'cooked_porkchop',
        'cooked_mutton', 'cooked_chicken', 'bread', 'torch', 'obsidian', 'blaze_rod', 'ender_pearl', 'ender_eye'];
    const items = keys.filter(k => c[k]).map(k => `${k} ${c[k]}`);
    out.push(`Items:   ${items.join(', ') || '-'}`);
    if (deaths.length) out.push(`Died:    ${deaths.map(d => `${clock(d.t)} ${d.text}`).join(' | ')}`);
    // redraw in place
    process.stdout.write('\x1b[H\x1b[2J' + out.join('\n') + '\n');
}

const socket = io(`http://localhost:${PORT}`, { reconnection: true, reconnectionDelay: 2000 });
socket.on('connect', () => { connected = true; socket.emit('listen-to-agents'); });
socket.on('disconnect', () => { connected = false; });
socket.on('state-update', (states) => {
    const s = states?.andy || Object.values(states || {})[0];
    if (s && !s.error) { state = s; lastState = Date.now(); }
});

checkServerLog();
setInterval(() => { if (Date.now() - lastLogCheck > 10000) { lastLogCheck = Date.now(); checkServerLog(); } }, 1000);
setInterval(draw, 1000);
draw();
