const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

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
    if (action === 'roster-decode') return ['__roster', 'decode', p.inputFile, p.outputDir];
    if (action === 'roster-compare') return ['__roster', 'compare', p.baseRoster, p.customRoster, p.outputDir];
    throw new Error(`Unknown action: ${action}`);
}

class Jobs {
    constructor() { this.next = 1; this.items = []; }
    run(action, params) {
        const id = this.next++;
        const args = argsFor(action, params || {});
        const job = { id, action, args, status: 'running', exitCode: null, log: '', startedAt: new Date().toISOString(), finishedAt: null };
        this.items.push(job);
        const isPkg = !!process.pkg;
        const command = process.execPath;
        const spawnArgs = isPkg ? args : [path.join(__dirname, '..', 'gui.js'), ...args];
        job.log += `> ${command} ${spawnArgs.join(' ')}\n`;
        const child = spawn(command, spawnArgs, { cwd: process.cwd(), env: process.env, windowsHide: false });
        child.stdout.on('data', c => job.log += c.toString('utf8'));
        child.stderr.on('data', c => job.log += c.toString('utf8'));
        child.on('error', e => { job.status = 'error'; job.log += `\n[ERROR] ${e.stack || e.message || e}`; job.finishedAt = new Date().toISOString(); });
        child.on('close', code => { job.exitCode = code; job.status = code === 0 ? 'complete' : 'failed'; job.finishedAt = new Date().toISOString(); job.log += `\n[DONE] Exit code ${code}\n`; });
        return job;
    }
}

function html() {
    return `<!doctype html><html><head><meta charset="utf-8"><title>College Hoops 2K8 Modding Suite</title><style>
body{margin:0;background:#0d1117;color:#e6edf3;font-family:Segoe UI,Arial,sans-serif}header{padding:22px;border-bottom:1px solid #30363d}main{display:grid;grid-template-columns:1fr 520px;gap:16px;padding:16px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:14px}.card,.log{background:#161b22;border:1px solid #30363d;border-radius:14px;padding:14px}h1{margin:0;font-size:24px}h2{margin:0;font-size:17px}p,label{color:#8b949e;font-size:13px}label{display:block;margin-top:9px}input,select{width:100%;box-sizing:border-box;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:10px;padding:9px}.row{display:flex;gap:8px}.row input{flex:1}button{border:0;border-radius:10px;padding:9px 12px;color:white;background:#238636;font-weight:700;cursor:pointer}.browse{background:#30363d}.run{width:100%;margin-top:12px}.checks{display:flex;flex-wrap:wrap;gap:10px}.checks label{color:#e6edf3}.checks input{width:auto}pre{white-space:pre-wrap;font-size:12px}.log{position:sticky;top:16px;height:calc(100vh - 32px);overflow:auto}@media(max-width:950px){main{grid-template-columns:1fr}.log{position:static;height:auto}}
</style></head><body><header><h1>College Hoops 2K8 Modding Suite</h1><p>Pick files/folders and run extractor, CDF/IFF, SCNE, smart-scan, build, and roster research tools without cmd.</p></header><main><div class="cards" id="cards"></div><aside class="log"><h2>Jobs</h2><div id="jobs"></div></aside></main><script>
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
            } else if (req.method === 'POST' && url.pathname === '/api/browse') {
                const body = await readBody(req);
                sendJson(res, 200, { path: await browse(body.kind) });
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
