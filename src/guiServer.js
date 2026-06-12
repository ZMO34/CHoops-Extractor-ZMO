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

function browse(kind) {
    return new Promise((resolve, reject) => {
        if (process.platform !== 'win32') {
            reject(new Error('Browse buttons use Windows PowerShell dialogs. Type/paste paths manually on other platforms.'));
            return;
        }
        const script = kind === 'file'
            ? "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Filter='All files (*.*)|*.*'; if($d.ShowDialog() -eq 'OK'){Write-Output $d.FileName}"
            : "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; if($d.ShowDialog() -eq 'OK'){Write-Output $d.SelectedPath}";
        const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: false });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => stdout += chunk.toString('utf8'));
        child.stderr.on('data', chunk => stderr += chunk.toString('utf8'));
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `Dialog failed: ${code}`)));
    });
}

function openBrowser(url) {
    const child = process.platform === 'win32'
        ? spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' })
        : process.platform === 'darwin'
            ? spawn('open', [url], { detached: true, stdio: 'ignore' })
            : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
}

function addFlag(args, flag, value) {
    if (value !== undefined && value !== null && value !== '') args.push(flag, String(value));
}

function addBool(args, flag, value) {
    if (value === true || value === 'true' || value === 'on') args.push(flag);
}

function selectedGameName(p) {
    return gameProfiles.getProfile(p && p.gameName ? p.gameName : 'choops2k8').id;
}

function argsFor(action, p) {
    const args = [];
    if (action === 'rip') {
        args.push('rip', p.gameDir, p.outputDir);
        addBool(args, '--build-cache', p.buildCache);
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
    if (action === 'inspect-iff') { args.push('inspect-iff', p.inputFile, p.outputDir); addBool(args, '--dump-subfiles', p.dumpSubfiles); return args; }
    if (action === 'smart-scan') { args.push('smart-scan', p.inputPath, p.outputDir); addFlag(args, '--max-depth', p.maxDepth || '4'); addBool(args, '--dump-candidates', p.dumpCandidates); return args; }
    if (action === 'scan-refs') { args.push('scan-refs', p.inputPath, p.outputDir); addFlag(args, '--min-length', p.minLength || '4'); addBool(args, '--only-matches', p.onlyMatches); return args; }
    if (action === 'extract-cdf-textures') { args.push('extract-cdf-textures', p.cdfFile, p.outputDir); addFlag(args, '--iff', p.iffFile); addBool(args, '--dds', p.dds); addBool(args, '--verbose', p.verbose); return args; }
    if (action === 'export-teamselectlogo-dds') return ['export-teamselectlogo-dds', p.cdfFile, p.iffFile, p.outputDir];
    if (action === 'export-scne-obj') { args.push('export-scne-obj', p.scneFile, p.outputDir); addBool(args, '--split-parts', p.splitParts); addBool(args, '--flip-v', p.flipV); addFlag(args, '--primitive-mode', p.primitiveMode || 'strip'); return args; }
    if (action === 'roster-decode') return ['roster-decode', p.inputFile, p.outputDir];
    if (action === 'roster-compare') return ['roster-compare', p.baseRoster, p.customRoster, p.outputDir];
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

function getGuiGameOptions() {
    return gameProfiles.getSupportedGameProfiles().map((profile) => ({ value: profile.id, label: `${profile.displayName} (${profile.id})` }));
}

function html() {
    const gameOptions = JSON.stringify(getGuiGameOptions());
    return `<!doctype html><html><head><meta charset="utf-8"><title>2K Sports Modding Suite</title><style>
body{margin:0;background:#0d1117;color:#e6edf3;font-family:Segoe UI,Arial,sans-serif}header{padding:22px;border-bottom:1px solid #30363d}.hero{padding:16px;border-bottom:1px solid #30363d;background:#111827}.hero a{display:inline-block;background:#8957e5;color:white;text-decoration:none;border-radius:14px;padding:14px 18px;font-weight:800}main{display:grid;grid-template-columns:1fr 520px;gap:16px;padding:16px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:14px}.card,.log{background:#161b22;border:1px solid #30363d;border-radius:14px;padding:14px}h1{margin:0;font-size:24px}h2{margin:0;font-size:17px}p,label{color:#8b949e;font-size:13px}label{display:block;margin-top:9px}input,select{width:100%;box-sizing:border-box;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:10px;padding:9px}.row{display:flex;gap:8px}.row input{flex:1}button{border:0;border-radius:10px;padding:9px 12px;color:white;background:#238636;font-weight:700;cursor:pointer}.browse{background:#30363d}.run{width:100%;margin-top:12px}.checks{display:flex;flex-wrap:wrap;gap:10px}.checks label{color:#e6edf3}.checks input{width:auto}pre{white-space:pre-wrap;font-size:12px}.log{position:sticky;top:16px;height:calc(100vh - 32px);overflow:auto}@media(max-width:950px){main{grid-template-columns:1fr}.log{position:static;height:auto}}
</style></head><body><header><h1>2K Sports Modding Suite</h1><p>Run extractor, cache, CDF/IFF, SCNE, smart-scan, build, and roster research tools.</p></header><section class="hero"><a href="/roster-studio" target="_blank">Open Roster Editor</a><p>Roster Studio includes built-in CH2K8 Edit School schema and save-copy research edits.</p></section><main><div class="cards" id="cards"></div><aside class="log"><h2>Jobs</h2><div id="jobs"></div></aside></main><script>
const gameOptions=${gameOptions};
const forms=[
['rip','Full enhanced rip','Default rip with cache/name fixes, CDF/IFF extraction, NAME DDS attempts, and logs',[['gameName','Game profile','game'],['gameDir','Game USRDIR folder','folder'],['outputDir','Output folder','folder'],['fileName','Optional single file',''],['index','Optional archive index','']],['buildCache','showConsole','iffOnly','rawIff','rawType']],
['build-cache','Build cache','Force archive cache rebuild only, using the selected game profile',[['gameName','Game profile','game'],['gameDir','Game USRDIR folder','folder']],[]],
['build','Build modded game','Rebuild archives from a mod/rip folder',[['gameDir','Game USRDIR folder','folder'],['modDir','Mod/rip folder','folder']],[]],
['roster-decode','Decode roster','Export players, teams, roster slots, arenas, and coaches',[['inputFile','Roster / USERDATA / save zip','file'],['outputDir','Output folder','folder']],[]],
['roster-compare','Compare rosters','Diff vanilla and custom rosters',[['baseRoster','Base roster','file'],['customRoster','Custom roster','file'],['outputDir','Output folder','folder']],[]],
['inspect-iff','Inspect IFF','Deep inspect one IFF',[['inputFile','IFF file','file'],['outputDir','Output folder','folder']],['dumpSubfiles']],
['smart-scan','Smart scan','Recursive asset/container scan',[['inputPath','Input file/folder','folder'],['outputDir','Output folder','folder'],['maxDepth','Max depth','']],['dumpCandidates']],
['extract-cdf-textures','Extract CDF textures','Extract GTF/DDS from CDF with optional IFF',[['cdfFile','CDF file','file'],['iffFile','Paired IFF','file'],['outputDir','Output folder','folder']],['dds','verbose']],
['export-teamselectlogo-dds','Teamselectlogo DDS export','Dedicated teamselectlogo export',[['cdfFile','teamselectlogo.cdf','file'],['iffFile','teamselectlogo.iff','file'],['outputDir','Output folder','folder']],[]],
['export-scne-obj','Export SCNE OBJ','Export stadium/court/presentation SCNE models',[['scneFile','SCNE file','file'],['outputDir','Output folder','folder'],['primitiveMode','Primitive mode','select:strip,list']],['splitParts','flipV']],
['scan-refs','Scan refs','Extract strings and file references',[['inputPath','Input file/folder','folder'],['outputDir','Output folder','folder'],['minLength','Minimum length','']],['onlyMatches']]
];
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function field(f){let [n,l,t]=f;if(t==='game')return '<label>'+esc(l)+'<select name="'+esc(n)+'">'+gameOptions.map(o=>'<option value="'+esc(o.value)+'">'+esc(o.label)+'</option>').join('')+'</select></label>';if((t||'').startsWith('select:'))return '<label>'+esc(l)+'<select name="'+esc(n)+'">'+t.slice(7).split(',').map(o=>'<option>'+esc(o)+'</option>').join('')+'</select></label>';let b=(t==='file'||t==='folder')?'<button class="browse" type="button" data-kind="'+t+'" data-name="'+esc(n)+'">Browse</button>':'';return '<label>'+esc(l)+'<div class="row"><input name="'+esc(n)+'">'+b+'</div></label>';}
function card(x){let [a,t,d,fs,checks]=x;return '<section class="card"><h2>'+esc(t)+'</h2><p>'+esc(d)+'</p><form data-action="'+a+'">'+fs.map(field).join('')+'<div class="checks">'+checks.map(c=>'<label><input type="checkbox" name="'+c+'"> '+c+'</label>').join('')+'</div><button class="run">Run</button></form></section>';}
document.getElementById('cards').innerHTML=forms.map(card).join('');
document.querySelectorAll('[name=buildCache],[name=dds]').forEach(e=>e.checked=true);
async function post(u,d){let r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});if(!r.ok)throw new Error(await r.text());return r.json();}
document.addEventListener('click',async e=>{if(!e.target.classList.contains('browse'))return;try{let r=await post('/api/browse',{kind:e.target.dataset.kind});if(r.path)e.target.closest('label').querySelector('input').value=r.path;}catch(err){alert(err.message||err);}});
document.addEventListener('submit',async e=>{e.preventDefault();let f=e.target;let p={};f.querySelectorAll('input,select').forEach(i=>p[i.name]=i.type==='checkbox'?i.checked:i.value);try{await post('/api/run',{action:f.dataset.action,params:p});}catch(err){alert(err.message||err);}});
async function refresh(){let r=await fetch('/api/jobs');let d=await r.json();document.getElementById('jobs').innerHTML=d.jobs.slice().reverse().map(j=>'<div><b>#'+j.id+' '+esc(j.action)+' - '+esc(j.status)+'</b><pre>'+esc(j.log)+'</pre></div>').join('');}
setInterval(refresh,1200);refresh();
</script></body></html>`;
}

function rosterStudioHtml() {
    return `<!doctype html><html><head><meta charset="utf-8"><title>CH2K8 Roster Studio</title><style>
body{margin:0;background:#0d1117;color:#e6edf3;font-family:Segoe UI,Arial,sans-serif}header{padding:18px 22px;border-bottom:1px solid #30363d;background:#111827}h1{margin:0;font-size:24px}.bar{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;padding:14px 18px;border-bottom:1px solid #30363d;background:#0d1117}input,select{width:100%;box-sizing:border-box;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:10px;padding:9px}input[type=color]{padding:2px;height:38px}button{border:0;border-radius:10px;padding:9px 12px;color:white;background:#238636;font-weight:700;cursor:pointer}.browse,.gray{background:#30363d}.danger{background:#a37100}.content{padding:18px}.panel{background:#161b22;border:1px solid #30363d;border-radius:14px;padding:14px;margin-bottom:14px}.muted{color:#8b949e}.row{display:flex;gap:8px}.row input{flex:1}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}.tabs{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.tab{background:#30363d}.tab.active{background:#8957e5}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border-bottom:1px solid #30363d;text-align:left;padding:6px}pre{white-space:pre-wrap}.swatch{display:inline-block;width:28px;height:18px;border:1px solid #555;vertical-align:middle;margin-right:6px}.pill{display:inline-block;background:#30363d;border-radius:999px;padding:3px 8px;margin:2px;font-size:12px}.edit{border:1px solid #30363d;border-radius:12px;padding:10px;margin:8px 0;background:#0d1117}@media(max-width:900px){.bar{grid-template-columns:1fr}.grid{grid-template-columns:1fr}}
</style></head><body><header><h1>CH2K8 Roster Studio</h1><div class="muted">Built-in Edit School schema. Research edits always save a copy; original files are not overwritten.</div></header><section class="bar"><div class="row"><input id="rosterPath" placeholder="Roster source: roster_english.iff, USERDATA, save ZIP, or raw ROST"><button class="browse" data-target="rosterPath" data-kind="file">Browse</button></div><div class="row"><input id="assetRoot" placeholder="Optional extracted/ripped asset folder"><button class="browse" data-target="assetRoot" data-kind="folder">Browse</button></div><button id="openBtn">Open Roster</button></section><main class="content" id="content"><section class="panel"><h2>Open a roster source</h2><p class="muted">After loading, select a team, queue safe edits, then save a new USERDATA/raw ROST copy for in-game testing.</p></section></main><script>
let state=null, selectedTeam=0, activeTab='School', edits=[];
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function post(u,d){let r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});if(!r.ok)throw new Error(await r.text());return r.json();}
document.addEventListener('click',async e=>{if(!e.target.classList.contains('browse'))return;try{let r=await post('/api/browse',{kind:e.target.dataset.kind});if(r.path)document.getElementById(e.target.dataset.target).value=r.path;}catch(err){alert(err.message||err);}});
document.getElementById('openBtn').onclick=async()=>{try{state=await post('/api/roster/open',{rosterPath:document.getElementById('rosterPath').value,assetRoot:document.getElementById('assetRoot').value});selectedTeam=(state.teams.find(t=>String(t.school||t.short_name||'').toLowerCase().includes('georgia'))||state.teams[0]).team_index;edits=[];render();}catch(err){alert(err.message||err);}};
function team(){return state.teams.find(t=>Number(t.team_index)===Number(selectedTeam))||state.teams[0];}
function addEdit(edit){edits.push({...edit,teamIndex:Number(selectedTeam)});render();}
function tabs(){return state.schema.tabs.map(t=>'<button class="tab '+(activeTab===t?'active':'')+'" onclick="activeTab=\''+esc(t)+'\';render()">'+esc(t)+'</button>').join('');}
function top(){return '<section class="panel"><div class="grid"><label>Team<select onchange="selectedTeam=Number(this.value);render()">'+state.teams.map(t=>'<option value="'+t.team_index+'" '+(Number(t.team_index)===Number(selectedTeam)?'selected':'')+'>'+esc(t.team_index+' - '+(t.school||t.short_name||t.abbreviation||'Team'))+'</option>').join('')+'</select></label><label>Save output copy path<input id="outputPath" placeholder="Example: C:\\CH2K8\\USERDATA_modded"></label><div><button class="danger" onclick="saveCopy()">Save Copy With Queued Edits</button><p class="muted">Queued edits: '+edits.length+'</p></div></div><div class="tabs">'+tabs()+'</div></section>';}
function dashboard(){return '<section class="panel"><h2>Dashboard</h2><pre>'+esc(JSON.stringify({source:state.source,counts:state.counts,writeSafety:state.schema.writeSafety},null,2))+'</pre></section>';}
function school(){let t=team();return '<section class="panel"><h2>School</h2><div class="grid">'+strBox('schoolNameShort','School Name short',t.short_name)+strBox('schoolNameFull','School Name full',t.school)+strBox('nickname','Nickname',t.mascot_plural||t.nickname)+strBox('abbreviation','Abbreviation',t.abbreviation)+strBox('mascotNameText','Mascot text',t.mascot_name)+'</div><p class="muted">City, State, and Logo Design are visible in-game but not safely mapped yet. Logo Design is locked N/A for real teams.</p></section>';}
function strBox(key,label,value){return '<div class="edit"><label>'+esc(label)+'<input id="str_'+key+'" maxlength="16" value="'+esc(value||'')+'"></label><button onclick="addEdit({kind:\'teamString\',key:\''+key+'\',value:document.getElementById(\'str_'+key+'\').value})">Queue String Edit</button></div>';}
function spirit(){let r=team().research;return '<section class="panel"><h2>Spirit</h2><p class="muted">Mascot model candidate is asset word +0x190; use Unknown/Research for experimental raw edits. Fight Song is visible but unmapped.</p><h3>Rivals</h3>'+[1,2,3,4,5].map(i=>'<div class="edit"><label>Rival #'+i+'<select id="riv_'+i+'">'+state.teams.map(t=>'<option value="'+t.team_index+'" '+(r.rivals[i-1]&&Number(r.rivals[i-1].teamIndex)===Number(t.team_index)?'selected':'')+'>'+esc(t.team_index+' - '+(t.school||t.short_name||t.abbreviation))+'</option>').join('')+'</select></label><button onclick="addEdit({kind:\'rival\',slot:'+i+',targetTeamIndex:Number(document.getElementById(\'riv_'+i+'\').value)})">Queue Rival</button></div>').join('')+'<div class="grid">'+strBox('studentSection','Student Section',team().student_section)+strBox('midnightMadness','Mid. Madness',team().event_name)+'</div></section>';}
function palette(title){let t=team();return '<section class="panel"><h2>'+esc(title)+'</h2><p class="muted">Same 31-word RGB/control block feeds School, Floor, Basket, and Cheerleader material colors. Exact floor/basket/cheer labels remain research.</p><table><tr><th>Slot</th><th>Current</th><th>Hint</th><th>New RGB</th><th></th></tr>'+t.palette.map(c=>'<tr><td>'+c.slot+'<br><span class="muted">'+esc(c.offset)+'</span></td><td><span class="swatch" style="background:'+c.css+'"></span>'+esc(c.hex)+'</td><td>'+esc(c.uiHint)+'<br><span class="muted">'+esc(c.status)+'</span></td><td><input type="color" id="pal_'+c.slot+'" value="'+c.css+'"></td><td><button onclick="addEdit({kind:\'paletteColor\',slot:'+c.slot+',value:document.getElementById(\'pal_'+c.slot+'\').value})">Queue</button></td></tr>').join('')+'</table></section>';}
function roster(kind){let isRot=kind==='rotationSlot';let slots=isRot?team().research.rotationSlots:team().research.rosterSlots;let max=isRot?9:16;return '<section class="panel"><h2>'+(isRot?'Depth Chart / Rotation':'Roster Slots')+'</h2>'+Array.from({length:max},(_,idx)=>{let cur=slots[idx]||{};return '<div class="edit"><label>Slot '+(idx+1)+'<select id="'+kind+'_'+idx+'">'+state.players.map(p=>'<option value="'+p.player_index+'" '+(Number(cur.playerIndex)===Number(p.player_index)?'selected':'')+'>'+esc(p.player_index+' - '+(p.first_name||'')+' '+(p.last_name||''))+'</option>').join('')+'</select></label><button onclick="addEdit({kind:\''+kind+'\',slot:'+(idx+1)+',playerIndex:Number(document.getElementById(\''+kind+'_'+idx+'\').value)})">Queue Slot</button></div>';}).join('')+'</section>';}
function assets(){let t=team();return '<section class="panel"><h2>Uniforms & Assets</h2><p>Asset ID: <b>'+esc(t.asset_id)+'</b></p><div>'+Object.keys(t.assets||{}).map(k=>typeof t.assets[k]==='object'?'<span class="pill">'+esc(t.assets[k].label)+': '+(t.assets[k].found?'found':'missing')+' '+esc(t.assets[k].fileName)+'</span>':'').join('')+'</div><pre>'+esc(JSON.stringify(t.research.assetWords,null,2))+'</pre></section>';}
function conferences(){return '<section class="panel"><h2>Conferences / Legacy Swaps</h2><p class="muted">Conference table is decoded. Team-to-conference swap structure is intentionally not editable yet.</p><table><tr><th>#</th><th>Name</th><th>Abbr</th><th>Rank</th><th>Slots</th><th>Color</th></tr>'+state.conferences.map(c=>'<tr><td>'+c.conference_index+'</td><td>'+esc(c.name)+'</td><td>'+esc(c.abbreviation)+'</td><td>'+c.rank+'</td><td>'+c.tournament_slots+'</td><td>'+c.color.r+','+c.color.g+','+c.color.b+'</td></tr>').join('')+'</table></section>';}
function unknown(){let t=team();return '<section class="panel"><h2>Unknown Fields / Research</h2><p class="muted">Use raw edits only for active research. Values are written to copies only.</p><pre>'+esc(JSON.stringify(t.research,null,2))+'</pre><div class="edit"><label>Team-relative offset, decimal or hex like 0x190<input id="rawOff" value="0x190"></label><label>u32 hex value<input id="rawVal" placeholder="00000000"></label><button class="danger" onclick="addEdit({kind:\'rawTeamU32\',offset:Number(document.getElementById(\'rawOff\').value),value:document.getElementById(\'rawVal\').value,experimental:true})">Queue Experimental u32</button></div></section>';}
function queued(){return '<section class="panel"><h2>Queued Edits</h2><pre>'+esc(JSON.stringify(edits,null,2))+'</pre><button class="gray" onclick="edits=[];render()">Clear Queue</button></section>';}
function render(){if(!state)return;let body=top();if(activeTab==='Dashboard')body+=dashboard();else if(activeTab==='School')body+=school();else if(activeTab==='Spirit')body+=spirit();else if(['Floor','Basket','Cheerleader'].includes(activeTab))body+=palette(activeTab+' Colors / Materials');else if(activeTab==='Roster Slots')body+=roster('rosterSlot');else if(activeTab==='Depth Chart / Rotation')body+=roster('rotationSlot');else if(activeTab==='Uniforms & Assets')body+=assets();else if(activeTab==='Conferences / Legacy Swaps')body+=conferences();else if(activeTab==='Unknown Fields / Research')body+=unknown();else body+=palette(activeTab);body+=queued();document.getElementById('content').innerHTML=body;}
async function saveCopy(){try{let outputPath=document.getElementById('outputPath').value;if(!outputPath)throw new Error('Enter an output copy path first.');let result=await post('/api/roster/save-copy',{rosterPath:document.getElementById('rosterPath').value,outputPath,edits});alert('Saved copy: '+result.outputPath+'\nChanges: '+result.changes.length);state=await post('/api/roster/open',{rosterPath:outputPath,assetRoot:document.getElementById('assetRoot').value});edits=[];render();}catch(err){alert(err.message||err);}}
</script></body></html>`;
}

async function startGui(options = {}) {
    const jobs = new Jobs();
    const host = options.host || '127.0.0.1';
    const port = Number(options.port || 0);
    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, `http://${host}`);
            if (req.method === 'GET' && url.pathname === '/') {
                const body = html();
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(body);
            } else if (req.method === 'GET' && url.pathname === '/api/game-profiles') {
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
    await new Promise(resolve => server.listen(port, host, resolve));
    const address = server.address();
    const url = `http://${host}:${address.port}/`;
    console.log(`2K Sports Modding Suite GUI running at ${url}`);
    console.log('Keep this window open while using the GUI.');
    if (options.open !== false) openBrowser(url);
    return { server, url };
}

module.exports = { startGui };
