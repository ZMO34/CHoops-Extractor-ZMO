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
            else reject(new Error(stderr.trim() || `Native picker cancelled or failed with code ${code}.`));
        });
    });
}

async function browse(kind) {
    if (process.platform !== 'win32') {
        throw new Error('Native Browse is only implemented for Windows builds right now. Type the path directly.');
    }

    const isFile = kind === 'file';
    const dialog = isFile ? 'OpenFileDialog' : 'FolderBrowserDialog';
    const resultProp = isFile ? 'FileName' : 'SelectedPath';
    const extra = isFile
        ? "$d.Filter='Roster/save/IFF/CDF/SCNE files (*.zip;*.iff;*.cdf;*.scne;*.bin;*.dat)|*.zip;*.iff;*.cdf;*.scne;*.bin;*.dat|USERDATA|USERDATA|All files (*.*)|*.*';$d.CheckFileExists=$true;"
        : '$d.ShowNewFolderButton=$true;';

    const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.StartPosition = 'CenterScreen'
$form.Width = 1
$form.Height = 1
$form.Opacity = 0
$form.Show()
$form.Activate()
$d = New-Object System.Windows.Forms.${dialog}
${extra}
$r = $d.ShowDialog($form)
if ($r -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.${resultProp}) }
$form.Close()
`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    try {
        return await runPickerWith('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]);
    } catch (err) {
        return await runPickerWith('pwsh.exe', ['-NoProfile', '-STA', '-EncodedCommand', encoded]);
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

function addFlag(args, flag, value) {
    if (value !== undefined && value !== null && value !== '') args.push(flag, String(value));
}

function addBool(args, flag, value) {
    if (value === true || value === 'true' || value === 'on') args.push(flag);
}

function selectedGameName(p) {
    return gameProfiles.getProfile(p && p.gameName ? p.gameName : 'choops2k8').id;
}

function requireFields(action, params, fields) {
    const missing = fields.filter(field => params[field] === undefined || params[field] === null || String(params[field]).trim() === '');
    if (missing.length > 0) {
        throw new Error(`${action} is missing required field(s): ${missing.join(', ')}`);
    }
}

function argsFor(action, p) {
    const args = [];

    if (action === 'rip') {
        requireFields(action, p, ['gameDir', 'outputDir']);
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

    if (action === 'build') {
        requireFields(action, p, ['gameDir', 'modDir']);
        return ['build', p.gameDir, p.modDir];
    }

    if (action === 'build-cache') {
        requireFields(action, p, ['gameDir']);
        args.push('build-cache', p.gameDir);
        addFlag(args, '--game-name', selectedGameName(p));
        return args;
    }

    if (action === 'roster-decode') {
        requireFields(action, p, ['inputFile', 'outputDir']);
        return ['roster-decode', p.inputFile, p.outputDir];
    }

    if (action === 'roster-compare') {
        requireFields(action, p, ['baseRoster', 'customRoster', 'outputDir']);
        return ['roster-compare', p.baseRoster, p.customRoster, p.outputDir];
    }

    if (action === 'inspect-iff') {
        requireFields(action, p, ['inputFile', 'outputDir']);
        args.push('inspect-iff', p.inputFile, p.outputDir);
        addBool(args, '--dump-subfiles', p.dumpSubfiles);
        return args;
    }

    if (action === 'smart-scan') {
        requireFields(action, p, ['inputPath', 'outputDir']);
        args.push('smart-scan', p.inputPath, p.outputDir);
        addFlag(args, '--max-depth', p.maxDepth || '4');
        addBool(args, '--dump-candidates', p.dumpCandidates);
        return args;
    }

    if (action === 'scan-refs') {
        requireFields(action, p, ['inputPath', 'outputDir']);
        args.push('scan-refs', p.inputPath, p.outputDir);
        addFlag(args, '--min-length', p.minLength || '4');
        addBool(args, '--only-matches', p.onlyMatches);
        return args;
    }

    if (action === 'extract-assets') {
        requireFields(action, p, ['gameDir', 'outputDir']);
        args.push('extract-assets', p.gameDir, p.outputDir);
        addBool(args, '--cache', p.cache);
        addFlag(args, '--index', p.index);
        addFlag(args, '--file', p.fileName);
        addFlag(args, '--category', p.category);
        addBool(args, '--scan-all', p.scanAll);
        addBool(args, '--dump-top-level-raw', p.dumpTopLevelRaw);
        addBool(args, '--include-all-unknown', p.includeAllUnknown);
        addFlag(args, '--max-probe-hits', p.maxProbeHits);
        addFlag(args, '--game-name', selectedGameName(p));
        return args;
    }

    if (action === 'decompress-cdf') {
        requireFields(action, p, ['cdfFile', 'outputDir']);
        args.push('decompress-cdf', p.cdfFile, p.outputDir);
        addFlag(args, '--max-hits', p.maxHits);
        addBool(args, '--dump-table-chunks', p.dumpTableChunks);
        return args;
    }

    if (action === 'extract-cdf-textures') {
        requireFields(action, p, ['cdfFile', 'outputDir']);
        args.push('extract-cdf-textures', p.cdfFile, p.outputDir);
        addFlag(args, '--iff', p.iffFile);
        addBool(args, '--dds', p.dds !== false);
        addBool(args, '--verbose', p.verbose);
        return args;
    }

    if (action === 'export-teamselectlogo-dds') {
        requireFields(action, p, ['cdfFile', 'iffFile', 'outputDir']);
        args.push('export-teamselectlogo-dds', p.cdfFile, p.iffFile, p.outputDir);
        addBool(args, '--verbose', p.verbose);
        return args;
    }

    if (action === 'import-teamselectlogo-dds') {
        requireFields(action, p, ['originalCdf', 'manifestFile', 'editedDdsDir', 'outputCdf']);
        return ['import-teamselectlogo-dds', p.originalCdf, p.manifestFile, p.editedDdsDir, p.outputCdf];
    }

    if (action === 'export-scne-obj') {
        requireFields(action, p, ['scneFile', 'outputDir']);
        args.push('export-scne-obj', p.scneFile, p.outputDir);
        addBool(args, '--split-parts', p.splitParts);
        addBool(args, '--flip-v', p.flipV);
        addFlag(args, '--primitive-mode', p.primitiveMode || 'strip');
        return args;
    }

    if (action === 'inspect-floor-scne') {
        requireFields(action, p, ['scneFile', 'outputDir']);
        return ['inspect-floor-scne', p.scneFile, p.outputDir];
    }

    if (action === 'probe') {
        requireFields(action, p, ['inputFile']);
        return ['probe', p.inputFile];
    }

    throw new Error(`Unknown action: ${action}`);
}

function getCliCommandAndArgs(args) {
    if (process.env.CHOOPS_EXTRACTOR_CLI) {
        return { command: process.env.CHOOPS_EXTRACTOR_CLI, spawnArgs: args };
    }

    if (process.pkg) {
        const exeName = process.platform === 'win32' ? 'choops-extractor.exe' : 'choops-extractor';
        return { command: path.join(path.dirname(process.execPath), exeName), spawnArgs: args };
    }

    if (process.versions && process.versions.electron) {
        return { command: process.env.CHOOPS_NODE || 'node', spawnArgs: [path.join(__dirname, '..', 'index.js'), ...args] };
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

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function getGuiGameOptions() { return gameProfiles.getSupportedGameProfiles().map(profile => ({ value: profile.id, label: `${profile.displayName} (${profile.id})` })); }

function fieldHtml(field) {
    const name = field[0], label = field[1], type = field[2] || '';
    if (type === 'game') {
        return `<label>${esc(label)}<select name="${esc(name)}">${getGuiGameOptions().map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select></label>`;
    }
    if (type.startsWith('select:')) {
        return `<label>${esc(label)}<select name="${esc(name)}">${type.slice(7).split(',').map(o => `<option>${esc(o)}</option>`).join('')}</select></label>`;
    }
    const browse = (type === 'file' || type === 'folder') ? `<button class="browse" type="button" data-kind="${type}">Browse</button>` : '';
    const hint = (type === 'file' || type === 'folder') ? '<small>Use Browse, or type the full path directly.</small>' : '';
    return `<label>${esc(label)}<div class="row"><input name="${esc(name)}" data-path-input="1">${browse}</div>${hint}</label>`;
}

function checksHtml(items) {
    return `<div class="checks">${items.map(c => {
        const name = Array.isArray(c) ? c[0] : c;
        const label = Array.isArray(c) ? c[1] : c;
        const checked = Array.isArray(c) && c[2] ? ' checked' : '';
        return `<label><input type="checkbox" name="${esc(name)}"${checked}> ${esc(label)}</label>`;
    }).join('')}</div>`;
}

function cardHtml(card, recommended) {
    return `<section class="card${recommended ? ' recommended' : ''}"><h2>${esc(card[1])}</h2><p>${esc(card[2])}</p><form data-action="${esc(card[0])}">${card[3].map(fieldHtml).join('')}${checksHtml(card[4] || [])}<button class="run">Run</button><div class="status"></div></form></section>`;
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
    ['scan-refs','Scan refs','Extract strings and file references from files/folders.',[['inputPath','Input file/folder','folder'],['outputDir','Output folder','folder'],['minLength','Minimum length','']],[['onlyMatches','Only matches',false]]],
    ['extract-assets','Extract asset candidates','Extract model/database/roster/animation candidates from game archives.',[['gameName','Game profile','game'],['gameDir','Game USRDIR folder','folder'],['outputDir','Output folder','folder'],['fileName','Optional file',''],['index','Optional index',''],['category','Optional category list',''],['maxProbeHits','Max probe hits','']],[['cache','Force cache rebuild',false],['scanAll','Scan all',false],['dumpTopLevelRaw','Dump raw containers',false],['includeAllUnknown','Include unknown',false]]],
    ['decompress-cdf','Decompress CDF research','Heuristically split/decompress a standalone CDF.',[['cdfFile','CDF file','file'],['outputDir','Output folder','folder'],['maxHits','Max hits','']],[['dumpTableChunks','Dump table chunks',false]]],
    ['extract-cdf-textures','Extract CDF textures','Extract GTF/DDS from a CDF, optionally paired to one IFF.',[['cdfFile','CDF file','file'],['iffFile','Optional paired IFF','file'],['outputDir','Output folder','folder']],[['dds','Write DDS',true],['verbose','Verbose log',false]]],
    ['export-teamselectlogo-dds','Export teamselectlogo DDS','Dedicated teamselectlogo CDF/IFF DDS export workflow.',[['cdfFile','teamselectlogo.cdf','file'],['iffFile','teamselectlogo.iff','file'],['outputDir','Output folder','folder']],[['verbose','Verbose log',false]]],
    ['import-teamselectlogo-dds','Import teamselectlogo DDS','Rebuild a teamselectlogo CDF from edited DDS files and the export manifest.',[['originalCdf','Original CDF','file'],['manifestFile','Manifest JSON','file'],['editedDdsDir','Edited DDS folder','folder'],['outputCdf','Output CDF path','']],[]],
    ['export-scne-obj','Export SCNE OBJ','Export stadium/court/presentation SCNE models.',[['scneFile','SCNE file','file'],['outputDir','Output folder','folder'],['primitiveMode','Primitive mode','select:strip,list']],[['splitParts','Split parts',false],['flipV','Flip V',false]]],
    ['inspect-floor-scne','Inspect floor SCNE','Dump texture, model-part, material, and draw-run tables for floor.scne.',[['scneFile','floor.scne','file'],['outputDir','Output folder','folder']],[]],
    ['probe','Compression probe','Probe an IFF/CDF for alternate compression layouts and embedded streams.',[['inputFile','IFF/CDF file','file']],[]],
    ['rip','Single archive/file rip','Advanced targeted rip. Use only when you know the archive index or exact file name.',[['gameName','Game profile','game'],['gameDir','Game USRDIR folder','folder'],['outputDir','Output folder','folder'],['fileName','Optional single file',''],['index','Optional archive index','']],[['iffOnly','IFF only',false],['rawIff','Raw IFF',false],['rawType','Raw type',false],['showConsole','Show console',false]]]
];

function commonStyle() {
    return `:root{color-scheme:dark;--bg:#0d1117;--panel:#161b22;--panel2:#111827;--line:#30363d;--text:#e6edf3;--muted:#8b949e;--green:#238636;--purple:#8957e5;--blue:#1f6feb;--red:#da3633}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Segoe UI,Arial,sans-serif}header{padding:22px 24px;border-bottom:1px solid var(--line);background:linear-gradient(135deg,#111827,#0d1117)}h1{margin:0;font-size:26px}h2{margin:0 0 8px;font-size:18px}.muted,p,label,small{color:var(--muted);font-size:13px}.quick{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;padding:16px 18px;border-bottom:1px solid var(--line);background:var(--panel2)}.biglink{display:block;border:1px solid var(--line);background:var(--panel);border-radius:14px;padding:14px;text-decoration:none;color:var(--text)}.biglink.primary{border-color:var(--purple)}.biglink strong{display:block;margin-bottom:6px}.layout{display:grid;grid-template-columns:1fr 520px;gap:16px;padding:16px}.section,.card,.log,.note,.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px}.note{margin-bottom:14px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:14px}.card.recommended{border-color:var(--purple)}input,select{width:100%;background:#0d1117;color:var(--text);border:1px solid var(--line);border-radius:10px;padding:9px}.row{display:flex;gap:8px}.row input{flex:1}button{border:0;border-radius:10px;padding:9px 12px;color:white;background:var(--green);font-weight:700;cursor:pointer}.browse{background:#30363d}.run{width:100%;margin-top:12px}.danger{background:var(--red)}.checks{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}.checks input{width:auto}.log{position:sticky;top:16px;height:calc(100vh - 32px);overflow:auto}pre{white-space:pre-wrap;font-size:12px}.status{margin-top:8px;color:var(--muted);font-size:12px}.status.ok{color:#3fb950}.status.error{color:#ff7b72}summary{cursor:pointer;font-weight:800;margin:10px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.tab{background:#30363d}.tab.active{background:var(--purple)}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border-bottom:1px solid var(--line);padding:6px;text-align:left}.edit{border:1px solid var(--line);border-radius:12px;background:#0d1117;padding:10px}.swatch{display:inline-block;width:32px;height:20px;border:1px solid #555;vertical-align:middle;margin-right:6px}input[type=color]{height:38px;padding:2px}@media(max-width:1000px){.layout{grid-template-columns:1fr}.log{position:static;height:auto}}`;
}

function mainScript() {
    return `<script>(function(){
function esc(s){return String(s||'').replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c];});}
function xhr(method,url,data,cb){var x=new XMLHttpRequest();x.open(method,url,true);x.setRequestHeader('Content-Type','application/json');x.onreadystatechange=function(){if(x.readyState!==4)return;if(x.status>=200&&x.status<300){try{cb(null,JSON.parse(x.responseText||'{}'));}catch(e){cb(e);}}else{cb(new Error(x.responseText||('HTTP '+x.status)));}};x.send(data?JSON.stringify(data):null);}
function setStatus(el,msg,cls){if(!el)return;el.className='status '+(cls||'');el.textContent=msg||'';}
document.addEventListener('click',function(e){var b=e.target;if(!b.classList.contains('browse'))return;var row=b.parentNode;var input=row.getElementsByTagName('input')[0];var form=b.form;var status=form?form.querySelector('.status'):null;setStatus(status,'Opening native picker...','');b.disabled=true;var old=b.textContent;b.textContent='Opening...';xhr('POST','/api/browse',{kind:b.getAttribute('data-kind')},function(err,r){b.disabled=false;b.textContent=old;if(err){setStatus(status,'Browse failed: '+(err.message||err),'error');return;}if(r&&r.path){input.value=r.path;setStatus(status,'Selected: '+r.path,'ok');}else setStatus(status,'Browse cancelled.','');});});
document.addEventListener('submit',function(e){e.preventDefault();var f=e.target;var p={};var nodes=f.querySelectorAll('input,select');for(var i=0;i<nodes.length;i++){var n=nodes[i];p[n.name]=n.type==='checkbox'?n.checked:n.value;}var st=f.querySelector('.status');setStatus(st,'Starting job...','');xhr('POST','/api/run',{action:f.getAttribute('data-action'),params:p},function(err){if(err){setStatus(st,'Run failed: '+(err.message||err),'error');return;}setStatus(st,'Job started. See Jobs panel.','ok');refresh();});});
function refresh(){var x=new XMLHttpRequest();x.open('GET','/api/jobs',true);x.onreadystatechange=function(){if(x.readyState!==4||x.status!==200)return;var d=JSON.parse(x.responseText||'{"jobs":[]}');var html='';var jobs=(d.jobs||[]).slice().reverse();for(var i=0;i<jobs.length;i++){var j=jobs[i];html+='<div><b>#'+j.id+' '+esc(j.action)+' - '+esc(j.status)+'</b><pre>'+esc(j.log)+'</pre></div>';}document.getElementById('jobs').innerHTML=html;};x.send(null);}setInterval(refresh,1200);refresh();
})();</script>`;
}

function html() {
    return `<!doctype html><html><head><meta charset="utf-8"><title>CHoops Modding Suite</title><style>${commonStyle()}</style></head><body><header><h1>College Hoops 2K8 Modding Suite</h1><p>Desktop workflows for ripping, rebuilding, roster editing, and advanced archive research.</p></header><section class="quick"><a class="biglink primary" href="/roster-studio"><strong>Open Roster Editor</strong><span>School data, colors, rivals, roster slots, rotation slots, assets, conferences, and research fields.</span></a><a class="biglink" href="#rip"><strong>Game-Aware Rip</strong><span>Use the selected game profile and dynamic cache support.</span></a><a class="biglink" href="#advanced"><strong>Advanced Research</strong><span>IFF/SCNE/CDF tools are available but separated from normal workflows.</span></a></section><main class="layout"><div><div class="note"><b>Desktop mode:</b> The app runs inside a local desktop window. Tool jobs still use the CLI backend so every workflow remains scriptable and testable.</div><section class="section" id="rip"><h2>Main workflows</h2><div class="cards">${coreCards.map((c,i)=>cardHtml(c,i===0)).join('')}</div></section><section class="section"><h2>Roster utilities</h2><div class="cards">${rosterCards.map(c=>cardHtml(c)).join('')}</div></section><details id="advanced"><summary>Advanced / research tools</summary><p class="muted">Obsolete clutter has been moved out of the main view, but the prior tool functions remain available here.</p><div class="cards">${advancedCards.map(c=>cardHtml(c)).join('')}</div></details></div><aside class="log"><h2>Jobs</h2><p class="muted">Running commands and logs appear here.</p><div id="jobs"></div></aside></main>${mainScript()}</body></html>`;
}

function rosterStudioHtml() {
    return `<!doctype html><html><head><meta charset="utf-8"><title>CH2K8 Roster Studio</title><style>${commonStyle()}.bar{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line)}.content{padding:18px}@media(max-width:900px){.bar{grid-template-columns:1fr}}</style></head><body><header><h1>CH2K8 Roster Studio</h1><div class="muted">Built-in roster editor. Saves are written as copies; original files are never overwritten.</div></header><section class="bar"><div><div class="row"><input id="rosterPath" placeholder="Roster source: save ZIP, USERDATA, roster_english.iff, or raw ROST"><button class="browse" data-target="rosterPath" data-kind="file">Browse</button></div></div><div><div class="row"><input id="assetRoot" placeholder="Optional ripped asset folder for uh/ua/ux/s/m lookup"><button class="browse" data-target="assetRoot" data-kind="folder">Browse</button></div></div><button id="openBtn">Open Roster</button><div class="status" id="studioStatus" style="grid-column:1/-1"></div></section><main class="content" id="content"><section class="panel"><h2>Open a roster source</h2><p class="muted">Open a PS3 save ZIP, USERDATA, roster_english.iff, or raw ROST. Use Browse or type the full path directly.</p></section></main><script>(function(){
var state=null,selectedTeam=0,activeTab='Dashboard',edits=[];
var tabNames=['Dashboard','School','Spirit','Colors / Floor / Basket / Cheer','Roster Slots','Depth Chart / Rotation','Assets','Conferences','Unknown / Research'];
function esc(s){return String(s||'').replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c];});}
function xhr(method,url,data,cb){var x=new XMLHttpRequest();x.open(method,url,true);x.setRequestHeader('Content-Type','application/json');x.onreadystatechange=function(){if(x.readyState!==4)return;if(x.status>=200&&x.status<300){try{cb(null,JSON.parse(x.responseText||'{}'));}catch(e){cb(e);}}else{cb(new Error(x.responseText||('HTTP '+x.status)));}};x.send(data?JSON.stringify(data):null);}
function status(msg,cls){var el=document.getElementById('studioStatus');if(el){el.className='status '+(cls||'');el.textContent=msg||'';}}
document.addEventListener('click',function(e){var b=e.target;if(!b.classList.contains('browse'))return;status('Opening native picker...','');b.disabled=true;var old=b.textContent;b.textContent='Opening...';xhr('POST','/api/browse',{kind:b.getAttribute('data-kind')},function(err,r){b.disabled=false;b.textContent=old;if(err){status('Browse failed: '+(err.message||err),'error');return;}if(r&&r.path){document.getElementById(b.getAttribute('data-target')).value=r.path;status('Selected: '+r.path,'ok');}else status('Browse cancelled.','');});});
var openBtn=document.getElementById('openBtn');openBtn.onclick=function(){var rosterPath=document.getElementById('rosterPath').value;if(!rosterPath){status('Choose or type a roster path first.','error');return;}status('Opening roster...','');openBtn.disabled=true;xhr('POST','/api/roster/open',{rosterPath:rosterPath,assetRoot:document.getElementById('assetRoot').value},function(err,r){openBtn.disabled=false;if(err){status('Open failed: '+(err.message||err),'error');return;}state=r;selectedTeam=(state.teams&&state.teams[0]?state.teams[0].team_index:0);edits=[];activeTab='Dashboard';status('Roster loaded.','ok');render();});};
function team(){for(var i=0;i<state.teams.length;i++){if(Number(state.teams[i].team_index)===Number(selectedTeam))return state.teams[i];}return state.teams[0];}
function addEdit(edit){edit.teamIndex=Number(selectedTeam);edits.push(edit);render();}
function teamLabel(t){return (t.school||t.school_name||t.short_name||t.abbreviation||'Team');}
function playerLabel(p){return (p.display_name||((p.first_name||'')+' '+(p.last_name||''))).trim();}
function top(){var opts='';for(var i=0;i<state.teams.length;i++){var t=state.teams[i];opts+='<option value="'+t.team_index+'" '+(Number(t.team_index)===Number(selectedTeam)?'selected':'')+'>'+esc(t.team_index+' - '+teamLabel(t))+'</option>';}var tabs='';for(var j=0;j<tabNames.length;j++){tabs+='<button class="tab '+(activeTab===tabNames[j]?'active':'')+'" data-tab="'+esc(tabNames[j])+'">'+esc(tabNames[j])+'</button>';}return '<section class="panel"><div class="grid"><label>Team<select id="teamSelect">'+opts+'</select></label><label>Save output copy path<div class="row"><input id="outputPath" placeholder="Example: C:\\CH2K8\\USERDATA_modded"></div></label><div><button class="danger" id="saveBtn">Save Copy With Queued Edits</button><p class="muted">Queued edits: '+edits.length+'</p></div></div><div class="tabs">'+tabs+'</div></section>';}
function strBox(key,label,value,max){return '<div class="edit"><label>'+esc(label)+'<input id="str_'+key+'" maxlength="'+(max||32)+'" value="'+esc(value||'')+'"></label><button data-string="'+esc(key)+'">Queue</button></div>';}
function school(){var t=team();return '<section class="panel"><h2>School</h2><div class="grid">'+strBox('schoolNameShort','School Name short',t.short_name,16)+strBox('schoolNameFull','School Name full',t.school||t.school_name,16)+strBox('nickname','Nickname',t.mascot_plural||t.nickname,16)+strBox('abbreviation','Abbreviation',t.abbreviation,8)+strBox('mascotNameText','Mascot text',t.mascot_name,16)+'</div><p class="muted">Longer string support is still guarded by backend safety checks.</p></section>';}
function spirit(){var r=team().research||{};var rivals='';for(var i=1;i<=5;i++){var options='';for(var j=0;j<state.teams.length;j++){var tt=state.teams[j];var sel=(r.rivals&&r.rivals[i-1]&&Number(r.rivals[i-1].teamIndex)===Number(tt.team_index))?'selected':'';options+='<option value="'+tt.team_index+'" '+sel+'>'+esc(tt.team_index+' - '+teamLabel(tt))+'</option>';}rivals+='<div class="edit"><label>Rival #'+i+'<select id="riv_'+i+'">'+options+'</select></label><button data-rival="'+i+'">Queue Rival</button></div>';}return '<section class="panel"><h2>Spirit</h2><div class="grid">'+strBox('studentSection','Student Section',team().student_section,24)+strBox('midnightMadness','Mid. Madness',team().event_name,24)+'</div><h3>Rivals</h3><div class="grid">'+rivals+'</div></section>';}
function palette(){var t=team();var pal=t.palette||[];var rows='';for(var i=0;i<pal.length;i++){var c=pal[i];rows+='<tr><td>'+c.slot+'<br><span class="muted">'+esc(c.offset)+'</span></td><td><span class="swatch" style="background:'+esc(c.css)+'"></span>'+esc(c.hex)+'</td><td>'+esc(c.uiHint||'Research slot')+'</td><td><input type="color" id="pal_'+c.slot+'" value="'+esc(c.css)+'"></td><td><button data-pal="'+c.slot+'">Queue Color</button></td></tr>';}return '<section class="panel"><h2>Colors / Floor / Basket / Cheer</h2><p class="muted">These slots are still research labels. Queue edits and test in-game.</p><table><tr><th>Slot</th><th>Current</th><th>Hint</th><th>New RGB</th><th></th></tr>'+rows+'</table></section>';}
function playerOptions(current){var s='<option value="-1">Empty / None</option>';for(var i=0;i<state.players.length;i++){var p=state.players[i];s+='<option value="'+p.player_index+'" '+(Number(current)===Number(p.player_index)?'selected':'')+'>'+esc(p.player_index+' - '+playerLabel(p))+'</option>';}return s;}
function slots(kind){var research=team().research||{};var arr=(kind==='rosterSlot'?research.rosterSlots:research.rotationSlots)||[];var title=kind==='rosterSlot'?'Roster Slots':'Depth Chart / Rotation';var h='';for(var i=0;i<arr.length;i++){var s=arr[i];h+='<div class="edit"><label>Slot '+s.slot+' '+esc(s.offset)+'<select id="'+kind+'_'+s.slot+'">'+playerOptions(s.playerIndex)+'</select></label><button data-slot-kind="'+kind+'" data-slot="'+s.slot+'">Queue</button></div>';}return '<section class="panel"><h2>'+title+'</h2><div class="grid">'+h+'</div></section>';}
function assets(){return '<section class="panel"><h2>Uniforms & Assets</h2><p class="muted">Alternate assignment is safest when both ux### and selux### exist.</p><pre>'+esc(JSON.stringify({asset_id:team().asset_id,assets:team().assets,research:(team().research||{}).assetWords},null,2))+'</pre></section>';}
function conferences(){var h='';var rows=state.conferences||[];for(var i=0;i<rows.length;i++){var c=rows[i];h+='<tr><td>'+c.conference_index+'</td><td>'+esc(c.name)+'</td><td>'+esc(c.abbreviation)+'</td><td>'+esc(c.rank)+'</td><td>'+esc(c.tournament_slots||c.tournamentSlots)+'</td><td>'+esc(c.row_offset||'')+'</td></tr>';}return '<section class="panel"><h2>Conferences / Legacy Swaps</h2><p class="muted">Conference writes stay research-gated until controlled diffs prove the fields.</p><table><tr><th>#</th><th>Name</th><th>Abbr</th><th>Rank</th><th>Slots</th><th>Offset</th></tr>'+h+'</table></section>';}
function unknown(){return '<section class="panel"><h2>Unknown / Research</h2><pre>'+esc(JSON.stringify(team().research||{},null,2))+'</pre></section>';}
function dashboard(){return '<section class="panel"><h2>Loaded</h2><pre>'+esc(JSON.stringify({source:state.source,counts:state.counts,selectedTeam:teamLabel(team())},null,2))+'</pre></section>';}
function render(){if(!state)return;var body=top();if(activeTab==='Dashboard')body+=dashboard();else if(activeTab==='School')body+=school();else if(activeTab==='Spirit')body+=spirit();else if(activeTab==='Colors / Floor / Basket / Cheer')body+=palette();else if(activeTab==='Roster Slots')body+=slots('rosterSlot');else if(activeTab==='Depth Chart / Rotation')body+=slots('rotationSlot');else if(activeTab==='Assets')body+=assets();else if(activeTab==='Conferences')body+=conferences();else body+=unknown();document.getElementById('content').innerHTML=body;var select=document.getElementById('teamSelect');if(select){select.onchange=function(){selectedTeam=Number(this.value);render();};}}
document.addEventListener('click',function(e){var t=e.target;if(t.getAttribute('data-tab')){activeTab=t.getAttribute('data-tab');render();return;}if(t.getAttribute('data-string')){var k=t.getAttribute('data-string');addEdit({type:'teamString',field:k,value:document.getElementById('str_'+k).value});return;}if(t.getAttribute('data-pal')){var slot=Number(t.getAttribute('data-pal'));var val=document.getElementById('pal_'+slot).value.replace('#','').toUpperCase()+'FF';addEdit({type:'paletteSlot',slot:slot,value:val});return;}if(t.getAttribute('data-rival')){var rs=Number(t.getAttribute('data-rival'));addEdit({type:'rival',slot:rs,targetTeamIndex:Number(document.getElementById('riv_'+rs).value)});return;}if(t.getAttribute('data-slot-kind')){var sk=t.getAttribute('data-slot-kind');var ss=Number(t.getAttribute('data-slot'));addEdit({type:sk,slot:ss,playerIndex:Number(document.getElementById(sk+'_'+ss).value)});return;}if(t.id==='saveBtn'){var out=document.getElementById('outputPath').value;if(!out){status('Enter an output path first.','error');return;}status('Saving copy...','');xhr('POST','/api/roster/save-copy',{rosterPath:document.getElementById('rosterPath').value,outputPath:out,edits:edits},function(err,r){if(err){status('Save failed: '+(err.message||err),'error');return;}status('Saved copy: '+r.outputPath+' | Applied edits: '+r.applied.length,'ok');edits=[];render();});}});
})();</script></body></html>`;
}

function startGui(options = {}) {
    const host = options.host || '127.0.0.1';
    const port = options.port === undefined ? 8787 : Number(options.port);
    const jobs = new Jobs();
    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, `http://${req.headers.host}`);
            if (req.method === 'GET' && url.pathname === '/') {
                const body = html();
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(body);
            } else if (req.method === 'GET' && (url.pathname === '/api/games' || url.pathname === '/api/game-profiles')) {
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
        console.log(`CHoops Modding Suite local backend running at ${url}`);
        if (options.open !== false) openBrowser(url);
        resolve({ server, url });
    }));
}

module.exports = { startGui };
