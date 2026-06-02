const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const rosterStudio = require('./rosterStudioBackend');

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
        addFlag(args, '--game-name', p.gameName || 'choops2k8');
        return args;
    }
    if (action === 'build') return ['build', p.gameDir, p.modDir];
    if (action === 'build-cache') return ['build-cache', p.gameDir];
    if (action === 'inspect-iff') {
        args.push('inspect-iff', p.inputFile, p.outputDir);
        addBool(args, '--dump-subfiles', p.dumpSubfiles);
        return args;
    }
    if (action === 'smart-scan') {
        args.push('smart-scan', p.inputPath, p.outputDir);
        addFlag(args, '--max-depth', p.maxDepth || '4');
        addBool(args, '--dump-candidates', p.dumpCandidates);
        return args;
    }
    if (action === 'scan-refs') {
        args.push('scan-refs', p.inputPath, p.outputDir);
        addFlag(args, '--min-length', p.minLength || '4');
        addBool(args, '--only-matches', p.onlyMatches);
        return args;
    }
    if (action === 'extract-cdf-textures') {
        args.push('extract-cdf-textures', p.cdfFile, p.outputDir);
        addFlag(args, '--iff', p.iffFile);
        addBool(args, '--dds', p.dds);
        addBool(args, '--verbose', p.verbose);
        return args;
    }
    if (action === 'export-teamselectlogo-dds') return ['export-teamselectlogo-dds', p.cdfFile, p.iffFile, p.outputDir];
    if (action === 'export-scne-obj') {
        args.push('export-scne-obj', p.scneFile, p.outputDir);
        addBool(args, '--split-parts', p.splitParts);
        addBool(args, '--flip-v', p.flipV);
        addFlag(args, '--primitive-mode', p.primitiveMode || 'strip');
        return args;
    }
    if (action === 'roster-decode') return ['roster-decode', p.inputFile, p.outputDir];
    if (action === 'roster-compare') return ['roster-compare', p.baseRoster, p.customRoster, p.outputDir];
    throw new Error(`Unknown action: ${action}`);
}

function getCliCommandAndArgs(args) {
    if (process.pkg) {
        const exeName = process.platform === 'win32' ? 'choops-extractor.exe' : 'choops-extractor';
        return {
            command: path.join(path.dirname(process.execPath), exeName),
            spawnArgs: args
        };
    }

    return {
        command: process.execPath,
        spawnArgs: [path.join(__dirname, '..', 'index.js'), ...args]
    };
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

function html() {
    return `<!doctype html><html><head><meta charset="utf-8"><title>College Hoops 2K8 Modding Suite</title><style>
body{margin:0;background:#0d1117;color:#e6edf3;font-family:Segoe UI,Arial,sans-serif}header{padding:22px;border-bottom:1px solid #30363d}.hero{padding:16px;border-bottom:1px solid #30363d;background:#111827}.hero a{display:inline-block;background:#8957e5;color:white;text-decoration:none;border-radius:14px;padding:14px 18px;font-weight:800}main{display:grid;grid-template-columns:1fr 520px;gap:16px;padding:16px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:14px}.card,.log{background:#161b22;border:1px solid #30363d;border-radius:14px;padding:14px}h1{margin:0;font-size:24px}h2{margin:0;font-size:17px}p,label{color:#8b949e;font-size:13px}label{display:block;margin-top:9px}input,select{width:100%;box-sizing:border-box;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:10px;padding:9px}.row{display:flex;gap:8px}.row input{flex:1}button{border:0;border-radius:10px;padding:9px 12px;color:white;background:#238636;font-weight:700;cursor:pointer}.browse{background:#30363d}.run{width:100%;margin-top:12px}.checks{display:flex;flex-wrap:wrap;gap:10px}.checks label{color:#e6edf3}.checks input{width:auto}pre{white-space:pre-wrap;font-size:12px}.log{position:sticky;top:16px;height:calc(100vh - 32px);overflow:auto}@media(max-width:950px){main{grid-template-columns:1fr}.log{position:static;height:auto}}
</style></head><body><header><h1>College Hoops 2K8 Modding Suite</h1><p>Pick files/folders and run extractor, CDF/IFF, SCNE, smart-scan, build, and roster research tools without cmd.</p></header><section class="hero"><a href="/roster-studio" target="_blank">Open Roster Editor</a><p>Launches the separate Roster Studio workspace for roster files, USERDATA, save ZIPs, assets, uniforms, alternates, colors, and research fields.</p></section><main><div class="cards" id="cards"></div><aside class="log"><h2>Jobs</h2><div id="jobs"></div></aside></main><script>
const forms=[
['rip','Full enhanced rip','Default rip with cache/name fixes, CDF/IFF extraction, NAME DDS attempts, and logs',[['gameDir','Game USRDIR folder','folder'],['outputDir','Output folder','folder'],['fileName','Optional single file',''],['index','Optional archive index',''],['gameName','Game name','select:choops2k8,nba2k8,nba2k9']],['buildCache','showConsole','iffOnly','rawIff','rawType']],
['build','Build modded game','Rebuild archives from a mod/rip folder',[['gameDir','Game USRDIR folder','folder'],['modDir','Mod/rip folder','folder']],[]],
['roster-decode','Decode roster','Export players, teams, roster slots, arenas, and coaches',[['inputFile','Roster / USERDATA / save zip','file'],['outputDir','Output folder','folder']],[]],
['roster-compare','Compare rosters','Diff vanilla and custom rosters',[['baseRoster','Base roster','file'],['customRoster','Custom roster','file'],['outputDir','Output folder','folder']],[]],
['inspect-iff','Inspect IFF','Deep inspect one IFF',[['inputFile','IFF file','file'],['outputDir','Output folder','folder']],['dumpSubfiles']],
['smart-scan','Smart scan','Recursive asset/container scan',[['inputPath','Input file/folder','folder'],['outputDir','Output folder','folder'],['maxDepth','Max depth','']],['dumpCandidates']],
['extract-cdf-textures','Extract CDF textures','Extract GTF/DDS from CDF with optional IFF',[['cdfFile','CDF file','file'],['iffFile','Paired IFF','file'],['outputDir','Output folder','folder']],['dds','verbose']],
['export-teamselectlogo-dds','Teamselectlogo DDS export','Dedicated teamselectlogo export',[['cdfFile','teamselectlogo.cdf','file'],['iffFile','teamselectlogo.iff','file'],['outputDir','Output folder','folder']],[]],
['export-scne-obj','Export SCNE OBJ','Export stadium/court/presentation SCNE models',[['scneFile','SCNE file','file'],['outputDir','Output folder','folder'],['primitiveMode','Primitive mode','select:strip,list']],['splitParts','flipV']],
['scan-refs','Scan refs','Extract strings and file references',[['inputPath','Input file/folder','folder'],['outputDir','Output folder','folder'],['minLength','Minimum length','']],['onlyMatches']],
['build-cache','Build cache','Force archive cache rebuild only',[['gameDir','Game USRDIR folder','folder']],[]]
];
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function field(f){let [n,l,t]=f;if((t||'').startsWith('select:'))return '<label>'+esc(l)+'<select name="'+esc(n)+'">'+t.slice(7).split(',').map(o=>'<option>'+esc(o)+'</option>').join('')+'</select></label>';let b=(t==='file'||t==='folder')?'<button class="browse" type="button" data-kind="'+t+'" data-name="'+esc(n)+'">Browse</button>':'';return '<label>'+esc(l)+'<div class="row"><input name="'+esc(n)+'">'+b+'</div></label>';}
function card(x){let [a,t,d,fs,checks]=x;return '<section class="card"><h2>'+esc(t)+'</h2><p>'+esc(d)+'</p><form data-action="'+a+'">'+fs.map(field).join('')+'<div class="checks">'+checks.map(c=>'<label><input type="checkbox" name="'+c+'"> '+c+'</label>').join('')+'</div><button class="run">Run</button></form></section>';}
document.getElementById('cards').innerHTML=forms.map(card).join('');
document.querySelectorAll('[name=buildCache],[name=dds]').forEach(e=>e.checked=true);
async function post(u,d){let r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});if(!r.ok)throw new Error(await r.text());return r.json();}
document.addEventListener('click',async e=>{if(!e.target.classList.contains('browse'))return;try{let r=await post('/api/browse',{kind:e.target.dataset.kind});if(r.path)e.target.closest('form').elements[e.target.dataset.name].value=r.path;}catch(err){alert(err.message||err);}});
document.addEventListener('submit',async e=>{if(!e.target.dataset.action)return;e.preventDefault();let data={};for(let el of e.target.elements){if(!el.name)continue;data[el.name]=el.type==='checkbox'?el.checked:el.value;}try{await post('/api/run',{action:e.target.dataset.action,params:data});refresh();}catch(err){alert(err.message||err);}});
async function refresh(){let r=await fetch('/api/jobs');let d=await r.json();document.getElementById('jobs').innerHTML=d.jobs.slice().reverse().map(j=>'<div><b>#'+j.id+' '+esc(j.action)+' - '+esc(j.status)+'</b><pre>'+esc(j.log)+'</pre></div>').join('');}
setInterval(refresh,1200);refresh();
</script></body></html>`;
}

function rosterStudioHtml() {
    return `<!doctype html><html><head><meta charset="utf-8"><title>CH2K8 Roster Studio</title><style>
body{margin:0;background:#0d1117;color:#e6edf3;font-family:Segoe UI,Arial,sans-serif}header{padding:18px 22px;border-bottom:1px solid #30363d;background:#111827}h1{margin:0;font-size:24px}.bar{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;padding:14px 18px;border-bottom:1px solid #30363d;background:#0d1117}input,select{width:100%;box-sizing:border-box;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:10px;padding:9px}button{border:0;border-radius:10px;padding:9px 12px;color:white;background:#238636;font-weight:700;cursor:pointer}.browse{background:#30363d}.tabs{display:flex;gap:8px;flex-wrap:wrap;padding:12px 18px;border-bottom:1px solid #30363d}.tabs button{background:#21262d}.tabs button.active{background:#8957e5}.content{padding:18px}.panel{background:#161b22;border:1px solid #30363d;border-radius:14px;padding:14px;margin-bottom:14px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.table{width:100%;border-collapse:collapse;font-size:12px}.table th,.table td{border-bottom:1px solid #30363d;padding:7px;text-align:left}.muted{color:#8b949e}.pill{display:inline-block;border:1px solid #30363d;border-radius:999px;padding:2px 8px;margin:2px}.ok{color:#7ee787}.bad{color:#ff7b72}.swatch{width:42px;height:26px;border:1px solid #30363d;border-radius:6px}.row{display:flex;gap:8px}.row input{flex:1}pre{white-space:pre-wrap;font-size:12px}.warning{border-color:#f2cc60;background:#332b00}.disabled{opacity:.65}
</style></head><body><header><h1>CH2K8 Roster Studio</h1><div class="muted">Standalone editor workspace. This first pass is read-only/research mode until write validation is complete.</div></header><section class="bar"><div class="row"><input id="rosterPath" placeholder="Roster source: roster_english.iff, USERDATA, save ZIP, or raw ROST"><button class="browse" data-target="rosterPath" data-kind="file">Browse</button></div><div class="row"><input id="assetRoot" placeholder="Optional extracted/ripped asset folder for uh/ua/ux/selu/s/m availability"><button class="browse" data-target="assetRoot" data-kind="folder">Browse</button></div><button id="openBtn">Open Roster</button></section><nav class="tabs" id="tabs"></nav><main class="content" id="content"><section class="panel"><h2>Open a roster source</h2><p class="muted">Supported inputs: vanilla roster_english.iff, decrypted PS3 save ZIP, raw decrypted USERDATA, or raw ROST payload. Add an extracted asset folder to enable uniform/alternate/court availability checks.</p></section></main><script>
let state=null;let active='Dashboard';
const tabNames=['Dashboard','Players','Teams / School Data','Roster Slots','Uniforms & Assets','Alternates','Arenas / Courts','Colors / Court Palette','Conferences','Coaches','Unknown Fields / Research'];
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function post(u,d){let r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});if(!r.ok)throw new Error(await r.text());return r.json();}
document.addEventListener('click',async e=>{if(!e.target.classList.contains('browse'))return;try{let r=await post('/api/browse',{kind:e.target.dataset.kind});if(r.path)document.getElementById(e.target.dataset.target).value=r.path;}catch(err){alert(err.message||err);}});
document.getElementById('openBtn').onclick=async()=>{try{state=await post('/api/roster/open',{rosterPath:document.getElementById('rosterPath').value,assetRoot:document.getElementById('assetRoot').value});active='Dashboard';render();}catch(err){alert(err.message||err);}};
function renderTabs(){document.getElementById('tabs').innerHTML=tabNames.map(t=>'<button class="'+(t===active?'active':'')+'" data-tab="'+esc(t)+'">'+esc(t)+'</button>').join('');}
document.getElementById('tabs').onclick=e=>{if(!e.target.dataset.tab)return;active=e.target.dataset.tab;render();};
function table(rows, cols, max=120){rows=(rows||[]).slice(0,max);return '<table class="table"><thead><tr>'+cols.map(c=>'<th>'+esc(c[1])+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+cols.map(c=>'<td>'+esc(r[c[0]])+'</td>').join('')+'</tr>').join('')+'</tbody></table>'+(rows.length===max?'<p class="muted">Showing first '+max+' rows.</p>':'');}
function dashboard(){return '<section class="panel"><h2>Source</h2><div class="grid"><div><b>Type</b><br>'+esc(state.source.sourceType)+'</div><div><b>Payload size</b><br>'+esc(state.source.payloadSize)+'</div><div><b>Length prefix</b><br>'+esc(state.source.lengthPrefix??'')+'</div><div><b>Asset root files</b><br>'+esc(state.assetIndex?state.assetIndex.fileCount:'not scanned')+'</div></div><p class="muted">'+esc(state.source.note)+'</p></section><section class="panel"><h2>Counts</h2><div class="grid">'+Object.entries(state.counts).map(([k,v])=>'<div><b>'+esc(k)+'</b><br>'+esc(v)+'</div>').join('')+'</div></section><section class="panel warning"><h2>Write safety</h2><p>Editing controls are intentionally disabled in this first pass. Use the one-edit vanilla roster files to promote research fields into confirmed write fields.</p></section>';}
function players(){return '<section class="panel"><h2>Players</h2>'+table(state.players,[['player_index','Index'],['display_name','Name'],['jersey_number','#'],['position','Pos'],['height_inches','Ht in'],['packed_id_jersey_hex','Packed ID/#']])+'</section>';}
function teams(){return '<section class="panel"><h2>Teams / School Data</h2>'+table(state.teams,[['team_index','Index'],['school_name','School'],['abbreviation','Abbr'],['mascot_name','Mascot'],['asset_id','Asset'],['arena_index','Arena'],['coach_index','Coach'],['student_section','Student'],['event_name','Event']])+'</section>';}
function slots(){return '<section class="panel"><h2>Roster Slots</h2>'+table(state.rosterSlots,[['team_index','Team'],['team_school','School'],['slot','Slot'],['player_index','Player Idx'],['player_name','Player'],['jersey_number','#'],['position','Pos']])+'</section>';}
function assets(){let rows=state.teams.map(t=>({team_index:t.team_index,school_name:t.school_name,asset_id:t.asset_id,home:t.assets.homeUniform.found?'found':'missing',away:t.assets.awayUniform.found?'found':'missing',alt:t.assets.altUniform.found?'found':'missing',selhome:t.assets.homePreview.found?'found':'missing',selaway:t.assets.awayPreview.found?'found':'missing',selalt:t.assets.altPreview.found?'found':'missing',court:t.assets.arenaCourt.found?'found':'missing',mascot:t.assets.mascotModel.found?'found':'missing'}));return '<section class="panel"><h2>Uniforms & Assets</h2><p class="muted">Uses each team asset_id to check uh/ua/ux/seluh/selua/selux/s/m file availability in the optional asset folder.</p>'+table(rows,[['team_index','Team'],['school_name','School'],['asset_id','Asset'],['home','uh'],['away','ua'],['alt','ux'],['selhome','seluh'],['selaway','selua'],['selalt','selux'],['court','s'],['mascot','m']],200)+'</section>';}
function alternates(){let rows=state.teams.map(t=>({team_index:t.team_index,school_name:t.school_name,asset_id:t.asset_id,ux:t.assets.altUniform.fileName,ux_found:t.assets.altUniform.found?'yes':'no',selux:t.assets.altPreview.fileName,selux_found:t.assets.altPreview.found?'yes':'no',safe:t.assets.safeExistingAlternate?'yes':'no'}));return '<section class="panel"><h2>Alternates</h2><p class="muted">Only existing ux### + selux### pairs should be considered safe for assignment. Creating brand-new alternates requires archive/frontend work.</p>'+table(rows,[['team_index','Team'],['school_name','School'],['asset_id','Asset'],['ux','Gameplay'],['ux_found','Found'],['selux','Preview'],['selux_found','Found'],['safe','Safe existing alt']],200)+'</section>';}
function arenas(){return '<section class="panel"><h2>Arenas / Courts</h2>'+table(state.arenas,[['arena_index','Index'],['arena_code','Code'],['arena_name','Name']])+'</section>';}
function colors(){let teams=state.teams.slice(0,80);return '<section class="panel"><h2>Colors / Court Palette</h2><p class="muted">Team row +0x1A0..+0x218, 31 packed color/material words. Labels are research-mode until one-edit files confirm court trim, 3pt, paint, and line slots.</p>'+teams.map(t=>'<div class="panel"><h3>'+esc(t.team_index+' - '+t.school_name+' (asset '+t.asset_id+')')+'</h3><div class="grid">'+t.palette.map(c=>'<div><div class="swatch" style="background:'+esc(c.css)+'"></div><b>'+esc(c.label)+'</b><br><span class="muted">'+esc(c.offset)+' '+esc(c.hex)+' '+esc(c.status)+'</span></div>').join('')+'</div></div>').join('')+'</section>';}
function conferences(){return '<section class="panel disabled"><h2>Conferences</h2><p>Research-only. Conference affiliation and prestige are not confirmed yet. Upload one-edit vanilla roster files where only conference/prestige changes to map these safely.</p></section>';}
function coaches(){return '<section class="panel"><h2>Coaches</h2>'+table(state.coaches,[['coach_index','Index'],['coach_name','Coach'],['abbreviation','Abbr']])+'</section>';}
function unknown(){return '<section class="panel"><h2>Unknown Fields / Research</h2><p class="muted">Future field-diff output will appear here. Current strong candidates: player row +0x00..+0x03 for appearance bytes, and team row +0x1A0..+0x218 for school/court/material palette.</p><pre>'+esc(JSON.stringify(state.schema.writeSafety,null,2))+'</pre></section>';}
function render(){renderTabs();if(!state){return;}let html='';if(active==='Dashboard')html=dashboard();else if(active==='Players')html=players();else if(active==='Teams / School Data')html=teams();else if(active==='Roster Slots')html=slots();else if(active==='Uniforms & Assets')html=assets();else if(active==='Alternates')html=alternates();else if(active==='Arenas / Courts')html=arenas();else if(active==='Colors / Court Palette')html=colors();else if(active==='Conferences')html=conferences();else if(active==='Coaches')html=coaches();else html=unknown();document.getElementById('content').innerHTML=html;}
renderTabs();
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
    console.log(`College Hoops 2K8 Modding Suite GUI running at ${url}`);
    console.log('Keep this window open while using the GUI.');
    if (options.open !== false) openBrowser(url);
    return { server, url };
}

module.exports = { startGui };
