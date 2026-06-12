const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const rosterStudio = require('./rosterStudioBackend');
const gameProfiles = require('../2k-tools/src/util/gameProfiles');

function sendJson(res, code, value) {
    const body = JSON.stringify(value);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk.toString('utf8'));
        req.on('end', () => {
            try { resolve(body ? JSON.parse(body) : {}); }
            catch (err) { reject(err); }
        });
        req.on('error', reject);
    });
}

function runPickerWith(command, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { windowsHide: false, detached: false, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => stdout += chunk.toString('utf8'));
        child.stderr.on('data', chunk => stderr += chunk.toString('utf8'));
        child.on('error', reject);
        child.on('close', code => {
            const value = stdout.trim();
            if (code === 0 && value) resolve(value);
            else reject(new Error(stderr.trim() || `Native picker cancelled or failed with code ${code}. Paste the path manually.`));
        });
    });
}

async function browse(kind) {
    if (process.platform !== 'win32') {
        throw new Error('Native Browse is Windows-only in this GUI. Paste the full path manually.');
    }
    const isFile = kind === 'file';
    const dialog = isFile ? 'OpenFileDialog' : 'FolderBrowserDialog';
    const resultProp = isFile ? 'FileName' : 'SelectedPath';
    const extra = isFile ? "$d.Filter='Roster/save/IFF files (*.zip;*.iff;*.bin;*.dat)|*.zip;*.iff;*.bin;*.dat|USERDATA|USERDATA|All files (*.*)|*.*';$d.CheckFileExists=$true;" : '$d.ShowNewFolderButton=$true;';
    const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$d = New-Object System.Windows.Forms.${dialog}
${extra}
$r = $d.ShowDialog()
if ($r -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.${resultProp}) }
`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    try {
        return await runPickerWith('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]);
    } catch (err) {
        return await runPickerWith('pwsh.exe', ['-NoProfile', '-EncodedCommand', encoded]);
    }
}

function openBrowser(url) {
    const child = process.platform === 'win32'
        ? spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' })
        : process.platform === 'darwin'
            ? spawn('open', [url], { detached: true, stdio: 'ignore' })
            : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
}

function addFlag(args, flag, value) { if (value !== undefined && value !== null && value !== '') args.push(flag, String(value)); }
function addBool(args, flag, value) { if (value === true || value === 'true' || value === 'on') args.push(flag); }
function selectedGameName(p) { return gameProfiles.getProfile(p && p.gameName ? p.gameName : 'choops2k8').id; }

function argsFor(action, p) {
    const args = [];
    if (action === 'rip') {
        args.push('rip', p.gameDir, p.outputDir);
        addBool(args, '--build-cache', p.buildCache !== false);
        addBool(args, '--show-console', p.showConsole);
        addBool(args, '--iff-only', p.iffOnly);
        addBool(args, '--raw-iff', p.rawIff);
        addBool(args, '--raw-type', p.rawType);
        addFlag(args, '--file', p.fileName);
        addFlag(args, '--index', p.index);
        addFlag(args, '--game-name', selectedGameName(p));
        return args;
    }
    if (action === 'build') return ['build', p.gameDir, p.modDir];
    if (action === 'build-cache') { args.push('build-cache', p.gameDir); addFlag(args, '--game-name', selectedGameName(p)); return args; }
    if (action === 'roster-decode') return ['roster-decode', p.inputFile, p.outputDir];
    if (action === 'roster-compare') return ['roster-compare', p.baseRoster, p.customRoster, p.outputDir];
    if (action === 'inspect-iff') { args.push('inspect-iff', p.inputFile, p.outputDir); addBool(args, '--dump-subfiles', p.dumpSubfiles); return args; }
    if (action === 'smart-scan') { args.push('smart-scan', p.inputPath, p.outputDir); addFlag(args, '--max-depth', p.maxDepth || '4'); addBool(args, '--dump-candidates', p.dumpCandidates); return args; }
    if (action === 'scan-refs') { args.push('scan-refs', p.inputPath, p.outputDir); addFlag(args, '--min-length', p.minLength || '4'); addBool(args, '--only-matches', p.onlyMatches); return args; }
    if (action === 'extract-cdf-textures') { args.push('extract-cdf-textures', p.cdfFile, p.outputDir); addFlag(args, '--iff', p.iffFile); addBool(args, '--dds', p.dds !== false); addBool(args, '--verbose', p.verbose); return args; }
    if (action === 'export-scne-obj') { args.push('export-scne-obj', p.scneFile, p.outputDir); addBool(args, '--split-parts', p.splitParts); addBool(args, '--flip-v', p.flipV); addFlag(args, '--primitive-mode', p.primitiveMode || 'strip'); return args; }
    throw new Error(`Unknown action: ${action}`);
}

function getCliCommandAndArgs(args) {
    if (process.pkg) {
        const exeName = process.platform === 'win32' ? 'choops-extractor.exe' : 'choops-extractor';
        return { command: path.join(path.dirname(process.execPath), exeName), spawnArgs: args };
    }
    return { command: process.execPath, spawnArgs: [path.join(__dirname, '..', 'index.js'), ...args] };
}

class Jobs {
    constructor() { this.next = 1; this.items = []; }
    run(action, params) {
        const id = this.next++;
        const args = argsFor(action, params || {});
        const job = { id, action, args, status: 'running', exitCode: null, log: '', startedAt: new Date().toISOString(), finishedAt: null };
        this.items.push(job);
        const commandInfo = getCliCommandAndArgs(args);
        job.log += `> ${commandInfo.command} ${commandInfo.spawnArgs.join(' ')}\n`;
        const child = spawn(commandInfo.command, commandInfo.spawnArgs, { cwd: process.cwd(), env: process.env, windowsHide: false });
        child.stdout.on('data', c => job.log += c.toString('utf8'));
        child.stderr.on('data', c => job.log += c.toString('utf8'));
        child.on('error', e => { job.status = 'error'; job.log += `\n[ERROR] ${e.stack || e.message || e}`; job.finishedAt = new Date().toISOString(); });
        child.on('close', code => { job.exitCode = code; job.status = code === 0 ? 'complete' : 'failed'; job.finishedAt = new Date().toISOString(); job.log += `\n[DONE] Exit code ${code}\n`; });
        return job;
    }
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function getGuiGameOptions() { return gameProfiles.getSupportedGameProfiles().map(profile => ({ value: profile.id, label: `${profile.displayName} (${profile.id})` })); }

function fieldHtml([name, label, type]) {
    if (type === 'game') {
        return `<label>${esc(label)}<select name="${esc(name)}">${getGuiGameOptions().map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select></label>`;
    }
    if ((type || '').startsWith('select:')) {
        return `<label>${esc(label)}<select name="${esc(name)}">${type.slice(7).split(',').map(o => `<option>${esc(o)}</option>`).join('')}</select></label>`;
    }
    const browse = (type === 'file' || type === 'folder') ? `<button class="browse" type="button" data-kind="${type}">Browse</button>` : '';
    const hint = (type === 'file' || type === 'folder') ? '<small>Paste, type, or drag a file/folder path here. Browse is optional.</small>' : '';
    return `<label>${esc(label)}<div class="row"><input name="${esc(name)}" data-path-input="1"><button class="secondary paste" type="button">Paste</button>${browse}</div>${hint}</label>`;
}
function checksHtml(items) {
    return `<div class="checks">${items.map(c => {
        const name = Array.isArray(c) ? c[0] : c;
        const label = Array.isArray(c) ? c[1] : c;
        const checked = Array.isArray(c) && c[2] ? ' checked' : '';
        return `<label><input type="checkbox" name="${esc(name)}"${checked}> ${esc(label)}</label>`;
    }).join('')}</div>`;
}
function cardHtml([action, title, desc, fields, checks], recommended = false) {
    return `<section class="card${recommended ? ' recommended' : ''}"><h2>${esc(title)}</h2><p>${esc(desc)}</p><form data-action="${esc(action)}">${fields.map(fieldHtml).join('')}${checksHtml(checks || [])}<button class="run">Run</button></form></section>`;
}

const coreCards = [
    ['rip','Dynamic full rip','Recommended first step. Rips supported game/archive content using the selected game profile and rebuilds the dynamic cache by default.',[['gameName','Game profile','game'],['gameDir','Game USRDIR folder','folder'],['outputDir','Output/rip folder','folder']],[['buildCache','Build/update archive cache',true],['showConsole','Show extractor console',false]]],
    ['build','Build modded game','Rebuild game archives from a modded/ripped folder.',[['gameDir','Game USRDIR folder','folder'],['modDir','Mod/rip folder','folder']],[]],
    ['build-cache','Rebuild dynamic cache only','Use when the cache is stale, missing files, or after changing supported game profiles.',[['gameName','Game profile','game'],['gameDir','Game USRDIR folder','folder']],[]]
];
const rosterCards = [
    ['roster-decode','Decode roster to CSV','Export players, teams, roster slots, arenas, and coaches for spreadsheet/research use.',[['inputFile','Roster / USERDATA / save ZIP','file'],['outputDir','Output folder','folder']],[]],
    ['roster-compare','Compare two rosters','Diff a vanilla roster against an edited roster.',[['baseRoster','Base roster','file'],['customRoster','Custom roster','file'],['outputDir','Output folder','folder']],[]]
];
const advancedCards = [
    ['inspect-iff','Inspect IFF','Deep-inspect one IFF and optionally dump subfiles.',[['inputFile','IFF file','file'],['outputDir','Output folder','folder']],[['dumpSubfiles','Dump subfiles',false]]],
    ['smart-scan','Smart scan','Recursive asset/container scan for research folders.',[['inputPath','Input file/folder','folder'],['outputDir','Output folder','folder'],['maxDepth','Max depth','']],[['dumpCandidates','Dump candidates',false]]],
    ['extract-cdf-textures','Extract CDF textures','Extract GTF/DDS from a CDF, optionally paired to one IFF.',[['cdfFile','CDF file','file'],['iffFile','Optional paired IFF','file'],['outputDir','Output folder','folder']],[['dds','Write DDS',true],['verbose','Verbose log',false]]],
    ['export-scne-obj','Export SCNE OBJ','Export stadium/court/presentation SCNE models.',[['scneFile','SCNE file','file'],['outputDir','Output folder','folder'],['primitiveMode','Primitive mode','select:strip,list']],[['splitParts','Split parts',false],['flipV','Flip V',false]]],
    ['scan-refs','Scan refs','Extract strings and file references from files/folders.',[['inputPath','Input file/folder','folder'],['outputDir','Output folder','folder'],['minLength','Minimum length','']],[['onlyMatches','Only matches',false]]],
    ['rip','Single archive/file rip','Advanced targeted rip. Use only when you know the archive index or exact file name.',[['gameName','Game profile','game'],['gameDir','Game USRDIR folder','folder'],['outputDir','Output folder','folder'],['fileName','Optional single file',''],['index','Optional archive index','']],[['iffOnly','IFF only',false],['rawIff','Raw IFF',false],['rawType','Raw type',false],['showConsole','Show console',false]]]
];

function html() {
    return `<!doctype html><html><head><meta charset="utf-8"><title>CHoops Modding Suite</title><style>
:root{color-scheme:dark;--bg:#0d1117;--panel:#161b22;--panel2:#111827;--line:#30363d;--text:#e6edf3;--muted:#8b949e;--green:#238636;--purple:#8957e5;--blue:#1f6feb;--gold:#a37100}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Segoe UI,Arial,sans-serif}header{padding:22px 24px;border-bottom:1px solid var(--line);background:linear-gradient(135deg,#111827,#0d1117)}h1{margin:0;font-size:26px}h2{margin:0 0 8px;font-size:18px}.muted,p,label,small{color:var(--muted);font-size:13px}.quick{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;padding:16px 18px;border-bottom:1px solid var(--line);background:var(--panel2)}.biglink{display:block;text-decoration:none;color:white;border-radius:16px;padding:18px;border:1px solid var(--line);background:#161b22}.biglink.primary{background:linear-gradient(135deg,#8957e5,#1f6feb)}.biglink strong{display:block;font-size:19px;margin-bottom:6px}.layout{display:grid;grid-template-columns:minmax(0,1fr) 430px;gap:16px;padding:16px}.section{margin-bottom:18px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}.card,.log,details,.note{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px}.card.recommended{border-color:#3fb950}summary{cursor:pointer;font-weight:800;font-size:17px}.row{display:flex;gap:8px}.row input{flex:1}input,select{width:100%;background:#0d1117;color:var(--text);border:1px solid var(--line);border-radius:10px;padding:9px}label{display:block;margin-top:9px}button{border:0;border-radius:10px;padding:9px 12px;color:white;background:var(--green);font-weight:800;cursor:pointer}.browse,.secondary{background:#30363d}.run{width:100%;margin-top:12px}.checks{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}.checks label{color:var(--text);margin:0}.checks input{width:auto}.log{position:sticky;top:16px;height:calc(100vh - 32px);overflow:auto}pre{white-space:pre-wrap;font-size:12px}.note{border-left:4px solid var(--blue);margin:0 0 16px}@media(max-width:1050px){.layout{grid-template-columns:1fr}.log{position:static;height:auto}}
</style></head><body><header><h1>College Hoops 2K8 Modding Suite</h1><p>Clean game-aware workflows for ripping, rebuilding, roster editing, and advanced research.</p></header>
<section class="quick"><a class="biglink primary" href="/roster-studio" target="_blank"><strong>Open Roster Editor</strong><span>School data, colors, rivals, roster slots, rotation slots, assets, and research fields.</span></a><a class="biglink" href="#rip"><strong>Game-Aware Rip</strong><span>Use the selected game profile and dynamic cache support.</span></a><a class="biglink" href="#advanced"><strong>Advanced Research</strong><span>IFF/SCNE/CDF tools are available but hidden until needed.</span></a></section>
<main class="layout"><div><div class="note"><b>Path input debug:</b> Native Browse is optional. If a picker does not appear, paste or type the full Windows path directly. Server-rendered cards below should always display even if JavaScript fails.</div><section class="section" id="rip"><h2>Main workflows</h2><div class="cards">${coreCards.map((c,i)=>cardHtml(c,i===0)).join('')}</div></section><section class="section"><h2>Roster utilities</h2><div class="cards">${rosterCards.map(c=>cardHtml(c)).join('')}</div></section><details id="advanced"><summary>Advanced / research tools</summary><p class="muted">These are still available, but no longer mixed into normal workflows.</p><div class="cards">${advancedCards.map(c=>cardHtml(c)).join('')}</div></details></div><aside class="log"><h2>Jobs</h2><p class="muted">Running commands and logs appear here.</p><div id="jobs"></div></aside></main><script>
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function post(u,d){let r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});if(!r.ok)throw new Error(await r.text());return r.json();}
document.addEventListener('dragover',e=>{e.preventDefault();});
document.addEventListener('drop',e=>{let input=e.target.closest('.row')?.querySelector('input');if(!input)return;e.preventDefault();let f=e.dataTransfer.files&&e.dataTransfer.files[0];if(f&&f.path)input.value=f.path;else alert('Browser did not expose a full local path. Use Paste or type the path manually.');});
document.addEventListener('click',async e=>{if(e.target.classList.contains('paste')){let v=prompt('Paste full path:');if(v!==null)e.target.closest('.row').querySelector('input').value=v;return;}if(!e.target.classList.contains('browse'))return;e.target.textContent='Opening...';e.target.disabled=true;try{let r=await post('/api/browse',{kind:e.target.dataset.kind});if(r.path)e.target.closest('label').querySelector('input').value=r.path;}catch(err){alert((err.message||err)+'\n\nBrowse is optional. Paste or type the full path manually.');}finally{e.target.textContent='Browse';e.target.disabled=false;}});
document.addEventListener('submit',async e=>{e.preventDefault();let f=e.target;let p={};f.querySelectorAll('input,select').forEach(i=>p[i.name]=i.type==='checkbox'?i.checked:i.value);try{await post('/api/run',{action:f.dataset.action,params:p});refresh();}catch(err){alert(err.message||err);}});
async function refresh(){let r=await fetch('/api/jobs');let d=await r.json();document.getElementById('jobs').innerHTML=d.jobs.slice().reverse().map(j=>'<div><b>#'+j.id+' '+esc(j.action)+' - '+esc(j.status)+'</b><pre>'+esc(j.log)+'</pre></div>').join('');}
setInterval(refresh,1200);refresh();
</script></body></html>`;
}

function rosterStudioHtml() {
    return `<!doctype html><html><head><meta charset="utf-8"><title>CH2K8 Roster Studio</title><style>
:root{color-scheme:dark;--bg:#0d1117;--panel:#161b22;--line:#30363d;--text:#e6edf3;--muted:#8b949e;--green:#238636;--purple:#8957e5;--gold:#a37100}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Segoe UI,Arial,sans-serif}header{padding:18px 22px;border-bottom:1px solid var(--line);background:#111827}h1{margin:0;font-size:24px}.muted{color:var(--muted)}.bar{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line)}input,select{width:100%;background:#0d1117;color:var(--text);border:1px solid var(--line);border-radius:10px;padding:9px}input[type=color]{height:38px;padding:2px}button{border:0;border-radius:10px;padding:9px 12px;color:white;background:var(--green);font-weight:800;cursor:pointer}.browse,.tab,.secondary{background:#30363d}.danger{background:var(--gold)}.content{padding:18px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:14px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}.row{display:flex;gap:8px}.row input{flex:1}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.tab.active{background:var(--purple)}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border-bottom:1px solid var(--line);padding:6px;text-align:left}.edit{border:1px solid var(--line);border-radius:12px;background:#0d1117;padding:10px}.swatch{display:inline-block;width:32px;height:20px;border:1px solid #555;vertical-align:middle;margin-right:6px}pre{white-space:pre-wrap;font-size:12px}@media(max-width:900px){.bar{grid-template-columns:1fr}.grid{grid-template-columns:1fr}}
</style></head><body><header><h1>CH2K8 Roster Studio</h1><div class="muted">Built-in Edit School schema. All writes save a copy; original files are never overwritten.</div></header><section class="bar"><div class="row"><input id="rosterPath" placeholder="Roster source: save ZIP, USERDATA, roster_english.iff, or raw ROST"><button class="secondary" data-paste="rosterPath">Paste</button><button class="browse" data-target="rosterPath" data-kind="file">Browse</button></div><div class="row"><input id="assetRoot" placeholder="Optional ripped asset folder for uh/ua/ux/s/m lookup"><button class="secondary" data-paste="assetRoot">Paste</button><button class="browse" data-target="assetRoot" data-kind="folder">Browse</button></div><button id="openBtn">Open Roster</button></section><main class="content" id="content"><section class="panel"><h2>Open a roster source</h2><p class="muted">Open a PS3 save ZIP, USERDATA, roster_english.iff, or raw ROST. If Browse is blocked by Windows, use Paste and enter the full path.</p></section></main><script>
let state=null, selectedTeam=0, activeTab='Dashboard', edits=[];
const tabNames=['Dashboard','School','Spirit','Colors / Floor / Basket / Cheer','Roster Slots','Depth Chart / Rotation','Assets','Conferences','Unknown / Research'];
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function post(u,d){let r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});if(!r.ok)throw new Error(await r.text());return r.json();}
document.addEventListener('click',async e=>{if(e.target.dataset.paste){let v=prompt('Paste full path:');if(v!==null)document.getElementById(e.target.dataset.paste).value=v;return;}if(!e.target.classList.contains('browse'))return;e.target.textContent='Opening...';e.target.disabled=true;try{let r=await post('/api/browse',{kind:e.target.dataset.kind});if(r.path)document.getElementById(e.target.dataset.target).value=r.path;}catch(err){alert((err.message||err)+'\n\nYou can also use Paste and enter the full path manually.');}finally{e.target.textContent='Browse';e.target.disabled=false;}});
document.getElementById('openBtn').onclick=async()=>{try{state=await post('/api/roster/open',{rosterPath:document.getElementById('rosterPath').value,assetRoot:document.getElementById('assetRoot').value});selectedTeam=(state.teams.find(t=>String(t.school||t.short_name||'').toLowerCase().includes('georgia'))||state.teams[0]).team_index;edits=[];activeTab='Dashboard';render();}catch(err){alert(err.message||err);}};
function team(){return state.teams.find(t=>Number(t.team_index)===Number(selectedTeam))||state.teams[0];}
function addEdit(edit){edits.push({...edit,teamIndex:Number(selectedTeam)});render();}
function top(){let opts=state.teams.map(t=>'<option value="'+t.team_index+'" '+(Number(t.team_index)===Number(selectedTeam)?'selected':'')+'>'+esc(t.team_index+' - '+(t.school||t.short_name||t.abbreviation||'Team'))+'</option>').join('');let tabs=tabNames.map(t=>'<button class="tab '+(activeTab===t?'active':'')+'" data-tab="'+esc(t)+'">'+esc(t)+'</button>').join('');return '<section class="panel"><div class="grid"><label>Team<select id="teamSelect">'+opts+'</select></label><label>Save output copy path<div class="row"><input id="outputPath" placeholder="Example: C:\\CH2K8\\USERDATA_modded"><button class="secondary" data-paste="outputPath">Paste</button></div></label><div><button class="danger" id="saveBtn">Save Copy With Queued Edits</button><p class="muted">Queued edits: '+edits.length+'</p></div></div><div class="tabs">'+tabs+'</div></section>';}
function strBox(key,label,value,max){return '<div class="edit"><label>'+esc(label)+'<input id="str_'+key+'" maxlength="'+(max||32)+'" value="'+esc(value||'')+'"></label><button data-string="'+esc(key)+'">Queue</button></div>';}
function school(){let t=team();return '<section class="panel"><h2>School</h2><div class="grid">'+strBox('schoolNameShort','School Name short',t.short_name,16)+strBox('schoolNameFull','School Name full',t.school,16)+strBox('nickname','Nickname',t.mascot_plural||t.nickname,16)+strBox('abbreviation','Abbreviation',t.abbreviation,8)+strBox('mascotNameText','Mascot text',t.mascot_name,16)+'</div><p class="muted">City, State, Logo Design, and Fight Song are visible in-game but not safely mapped yet.</p></section>';}
function spirit(){let r=team().research||{};let rivalHtml=[1,2,3,4,5].map(i=>'<div class="edit"><label>Rival #'+i+'<select id="riv_'+i+'">'+state.teams.map(t=>'<option value="'+t.team_index+'" '+(r.rivals&&r.rivals[i-1]&&Number(r.rivals[i-1].teamIndex)===Number(t.team_index)?'selected':'')+'>'+esc(t.team_index+' - '+(t.school||t.short_name||t.abbreviation))+'</option>').join('')+'</select></label><button data-rival="'+i+'">Queue Rival</button></div>').join('');return '<section class="panel"><h2>Spirit</h2><p class="muted">Mascot model is a strong asset-word candidate at team +0x190; use Unknown/Research for experimental edits.</p><div class="grid">'+strBox('studentSection','Student Section',team().student_section,24)+strBox('midnightMadness','Mid. Madness',team().event_name,24)+'</div><h3>Rivals</h3><div class="grid">'+rivalHtml+'</div></section>';}
function palette(){let t=team();return '<section class="panel"><h2>Colors / Floor / Basket / Cheer</h2><p class="muted">This 31-word RGB/control block feeds school colors and multiple floor/basket/cheer material routes. Exact labels are still research, so edit by slot and test in-game.</p><table><tr><th>Slot</th><th>Current</th><th>Hint</th><th>New RGB</th><th></th></tr>'+t.palette.map(c=>'<tr><td>'+c.slot+'<br><span class="muted">'+esc(c.offset)+'</span></td><td><span class="swatch" style="background:'+esc(c.css)+'"></span>'+esc(c.hex)+'</td><td>'+esc(c.uiHint||'Research slot')+'</td><td><input type="color" id="pal_'+c.slot+'" value="'+esc(c.css)+'"></td><td><button data-pal="'+c.slot+'">Queue Color</button></td></tr>').join('')+'</table></section>';}
function playerOptions(current){return state.players.map(p=>'<option value="'+p.player_index+'" '+(Number(current)===Number(p.player_index)?'selected':'')+'>'+esc(p.player_index+' - '+(p.first_name||'')+' '+(p.last_name||''))+'</option>').join('');}
function slots(kind){let arr=(kind==='rosterSlot'?team().research.rosterSlots:team().research.rotationSlots)||[];let title=kind==='rosterSlot'?'Roster Slots':'Depth Chart / Rotation';return '<section class="panel"><h2>'+title+'</h2><div class="grid">'+arr.map(s=>'<div class="edit"><label>Slot '+s.slot+' '+esc(s.offset)+'<select id="'+kind+'_'+s.slot+'">'+playerOptions(s.playerIndex)+'</select></label><button data-slot-kind="'+kind+'" data-slot="'+s.slot+'">Queue</button></div>').join('')+'</div></section>';}
function assets(){return '<section class="panel"><h2>Uniforms & Assets</h2><pre>'+esc(JSON.stringify({asset_id:team().asset_id,assets:team().assets,research:team().research.assetWords},null,2))+'</pre></section>';}
function conferences(){return '<section class="panel"><h2>Conferences / Legacy Swaps</h2><p class="muted">Conference table is decoded. Team affiliation/swap logic is not safely writable yet.</p><table><tr><th>#</th><th>Name</th><th>Abbr</th><th>Rank</th><th>Slots</th><th>Color</th></tr>'+state.conferences.map(c=>'<tr><td>'+c.conference_index+'</td><td>'+esc(c.name)+'</td><td>'+esc(c.abbreviation)+'</td><td>'+esc(c.rank)+'</td><td>'+esc(c.tournamentSlots)+'</td><td>'+esc(c.colorHex)+'</td></tr>').join('')+'</table></section>';}
function unknown(){return '<section class="panel"><h2>Unknown / Research</h2><p class="muted">Experimental raw u32 edits. Use save copies only.</p><pre>'+esc(JSON.stringify(team().research,null,2))+'</pre></section>';}
function dashboard(){return '<section class="panel"><h2>Loaded</h2><pre>'+esc(JSON.stringify({source:state.source,counts:state.counts,selectedTeam:team().school||team().short_name},null,2))+'</pre></section>';}
function render(){if(!state)return;let body=top();if(activeTab==='Dashboard')body+=dashboard();else if(activeTab==='School')body+=school();else if(activeTab==='Spirit')body+=spirit();else if(activeTab==='Colors / Floor / Basket / Cheer')body+=palette();else if(activeTab==='Roster Slots')body+=slots('rosterSlot');else if(activeTab==='Depth Chart / Rotation')body+=slots('rotationSlot');else if(activeTab==='Assets')body+=assets();else if(activeTab==='Conferences')body+=conferences();else body+=unknown();document.getElementById('content').innerHTML=body;}
document.addEventListener('change',e=>{if(e.target.id==='teamSelect'){selectedTeam=e.target.value;render();}});
document.addEventListener('click',async e=>{if(e.target.dataset.tab){activeTab=e.target.dataset.tab;render();return;}if(e.target.dataset.string){addEdit({type:'teamString',field:e.target.dataset.string,value:document.getElementById('str_'+e.target.dataset.string).value});return;}if(e.target.dataset.pal){let slot=Number(e.target.dataset.pal), value=document.getElementById('pal_'+slot).value.replace('#','').toUpperCase()+'FF';addEdit({type:'paletteSlot',slot,value});return;}if(e.target.dataset.rival){let slot=Number(e.target.dataset.rival), targetTeamIndex=Number(document.getElementById('riv_'+slot).value);addEdit({type:'rival',slot,targetTeamIndex});return;}if(e.target.dataset.slotKind){let slot=Number(e.target.dataset.slot), playerIndex=Number(document.getElementById(e.target.dataset.slotKind+'_'+slot).value);addEdit({type:e.target.dataset.slotKind,slot,playerIndex});return;}if(e.target.id==='saveBtn'){try{let outputPath=document.getElementById('outputPath').value;if(!outputPath)throw new Error('Enter an output path first.');let r=await post('/api/roster/save-copy',{rosterPath:document.getElementById('rosterPath').value,outputPath,edits});alert('Saved copy: '+r.outputPath+'\nApplied edits: '+r.applied.length);edits=[];render();}catch(err){alert(err.message||err);}}});
</script></body></html>`;
}

function startGui(options = {}) {
    const host = options.host || '127.0.0.1';
    const port = Number(options.port || 8787);
    const jobs = new Jobs();
    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, `http://${req.headers.host}`);
            if (req.method === 'GET' && url.pathname === '/') {
                const body = html();
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(body);
            } else if (req.method === 'GET' && url.pathname === '/api/games') {
                sendJson(res, 200, { games: getGuiGameOptions() });
            } else if (req.method === 'GET' && url.pathname === '/roster-studio') {
                const body = rosterStudioHtml();
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(body);
            } else if (req.method === 'POST' && url.pathname === '/api/browse') {
                const body = await readBody(req);
                sendJson(res, 200, { path: await browse(body.kind) });
            } else if (req.method === 'POST' && url.pathname === '/api/roster/open') {
                const body = await readBody(req);
                sendJson(res, 200, await rosterStudio.openRosterStudio(body.rosterPath, body.assetRoot));
            } else if (req.method === 'POST' && url.pathname === '/api/roster/save-copy') {
                const body = await readBody(req);
                sendJson(res, 200, await rosterStudio.saveRosterCopy(body.rosterPath, body.outputPath, body.edits || []));
            } else if (req.method === 'POST' && url.pathname === '/api/run') {
                const body = await readBody(req);
                const job = jobs.run(body.action, body.params || {});
                sendJson(res, 200, { id: job.id, status: job.status });
            } else if (req.method === 'GET' && url.pathname === '/api/jobs') {
                sendJson(res, 200, { jobs: jobs.items });
            } else {
                sendJson(res, 404, { error: 'Not found' });
            }
        } catch (err) {
            sendJson(res, 500, { error: err.stack || err.message || String(err) });
        }
    });
    return new Promise(resolve => server.listen(port, host, () => {
        const address = server.address();
        const url = `http://${host}:${address.port}/`;
        console.log(`CHoops Modding Suite GUI running at ${url}`);
        console.log('Keep this window open while using the GUI.');
        if (options.open !== false) openBrowser(url);
        resolve(server);
    }));
}

module.exports = { startGui };
