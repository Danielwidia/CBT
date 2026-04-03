require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cors = require('cors');
const { parseWordDocument } = require('./wordParser');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const rootPath = __dirname;

// ─── Environment ──────────────────────────────────────────────────────────────
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_REPO   = process.env.GITHUB_REPO;   // e.g. "danielwidia/danielwidia.github.io"
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const DB_PATH       = '_data/cbt_db.json';
const RESULTS_PATH  = '_data/cbt_results.json';

// Local fallback paths
const LOCAL_DATA    = path.join(process.cwd(), 'database.json');
const LOCAL_RESULTS = path.join(process.cwd(), 'results.json');

const USE_GITHUB = !!(GITHUB_TOKEN && GITHUB_REPO);

if (USE_GITHUB) {
    console.log(`✅ GitHub DB mode: ${GITHUB_REPO} (branch: ${GITHUB_BRANCH})`);
} else {
    console.log('⚠️  GitHub not configured – using local JSON files as fallback.');
}

// ─── Default DB ───────────────────────────────────────────────────────────────
const DEFAULT_DB = {
    subjects: [
        { name: 'Pendidikan Agama', locked: false },
        { name: 'Bahasa Indonesia', locked: false },
        { name: 'Matematika',       locked: false },
        { name: 'IPA',              locked: false },
        { name: 'IPS',              locked: false },
        { name: 'Bahasa Inggris',   locked: false }
    ],
    rombels:    ['VII', 'VIII', 'IX'],
    questions:  [],
    students:   [{ id: 'ADM', password: 'admin321', name: 'Administrator', role: 'admin' }],
    results:    [],
    schedules:  [],
    timeLimits: {}
};

// ─── GitHub API Helpers ───────────────────────────────────────────────────────
const GH_HEADERS = () => ({
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept':        'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type':  'application/json'
});

async function ghReadFile(filePath) {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`;
    const res  = await fetch(url, { headers: GH_HEADERS() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub read metadata for ${filePath}: HTTP ${res.status}`);
    const json = await res.json();
    
    // Fallback khusus untuk file > 1MB, GitHub tidak akan memberikan json.content
    let contentStr = '';
    if (json.content && json.encoding === 'base64') {
        contentStr = Buffer.from(json.content, 'base64').toString('utf8');
    } else if (json.download_url || json.git_url) {
        // Ambil data langsung dari raw file jika ukurannya besar
        const rawRes = await fetch(json.download_url || `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${filePath}`, { 
            headers: { 'Authorization': `token ${GITHUB_TOKEN}` } 
        });
        if (!rawRes.ok) throw new Error(`GitHub Read Raw ${filePath}: HTTP ${rawRes.status}`);
        contentStr = await rawRes.text();
    } else {
        throw new Error(`File ${filePath} is too large and no download_url found (Size: ${json.size} bytes)`);
    }

    try {
        const parsed = JSON.parse(contentStr);
        return { data: parsed, sha: json.sha };
    } catch (e) {
        console.error(`Error parsing JSON for ${filePath}:`, e.message);
        throw new Error(`Invalid JSON format in ${filePath}`);
    }
}

async function ghWriteFile(filePath, data, sha) {
    const url  = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`;
    const body = {
        message:  `[CBT] update ${filePath}`,
        content:  Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
        branch:   GITHUB_BRANCH
    };
    if (sha) body.sha = sha;
    const res = await fetch(url, { method: 'PUT', headers: GH_HEADERS(), body: JSON.stringify(body) });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`GitHub write ${filePath}: ${err}`);
    }
    return res.json();
}

// ─── Merge helpers ────────────────────────────────────────────────────────────
function mergeResults(existing = [], incoming = []) {
    const map = new Map();
    const key = r => `${r.studentId||''}::${r.mapel||''}::${r.rombel||''}::${r.date||''}`;
    existing.forEach(r => map.set(key(r), r));
    incoming.forEach(r => {
        const k = key(r);
        map.set(k, map.has(k) ? Object.assign({}, map.get(k), r) : r);
    });
    return Array.from(map.values());
}

// ─── Data Layer ───────────────────────────────────────────────────────────────
async function readDB() {
    if (USE_GITHUB) {
        const file = await ghReadFile(DB_PATH);
        return file ? file.data : null;
    }
    try {
        if (!fs.existsSync(LOCAL_DATA)) return null;
        return JSON.parse(fs.readFileSync(LOCAL_DATA, 'utf8'));
    } catch { return null; }
}

async function writeDB(obj) {
    if (USE_GITHUB) {
        // Read current SHA first (required by GitHub API for updates)
        const existing = await ghReadFile(DB_PATH).catch(() => null);
        await ghWriteFile(DB_PATH, obj, existing?.sha);
        return;
    }
    fs.writeFileSync(LOCAL_DATA, JSON.stringify(obj, null, 2), 'utf8');
}

async function readResults() {
    if (USE_GITHUB) {
        const file = await ghReadFile(RESULTS_PATH);
        return file ? file.data : [];
    }
    try {
        if (!fs.existsSync(LOCAL_RESULTS)) return [];
        return JSON.parse(fs.readFileSync(LOCAL_RESULTS, 'utf8'));
    } catch { return []; }
}

async function writeResults(results) {
    if (USE_GITHUB) {
        const existing = await ghReadFile(RESULTS_PATH).catch(() => null);
        await ghWriteFile(RESULTS_PATH, results, existing?.sha);
        return;
    }
    fs.writeFileSync(LOCAL_RESULTS, JSON.stringify(results, null, 2), 'utf8');
}

// ─── Static Files ─────────────────────────────────────────────────────────────
app.get('/',         (req, res) => res.sendFile(path.join(rootPath, 'index.html')));
app.get('/logo.png', (req, res) => res.sendFile(path.join(rootPath, 'logo.png')));

app.use((req, res, next) => { console.log(`${req.method} ${req.url}`); next(); });

// ─── Health Endpoint ──────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
    const status = {
        ok: false,
        mode: USE_GITHUB ? 'github' : 'local',
        github_repo: GITHUB_REPO || null,
        github_token: GITHUB_TOKEN ? '***set***' : 'NOT SET',
        error: null
    };
    if (USE_GITHUB) {
        try {
            const db = await ghReadFile(DB_PATH);
            const results = await ghReadFile(RESULTS_PATH);
            status.db_file      = db      ? 'OK' : 'NOT FOUND (will be created on first save)';
            status.results_file = results ? 'OK' : 'NOT FOUND (will be created on first save)';
            status.ok = true;
        } catch (e) {
            status.error = e.message;
        }
    } else {
        status.error = 'Set GITHUB_TOKEN and GITHUB_REPO in Vercel environment variables.';
    }
    res.json(status);
});

// ─── API: Database ────────────────────────────────────────────────────────────
app.get('/api/db', async (req, res) => {
    try {
        const data = await readDB();
        if (data) return res.json(data);
        return res.status(404).json({ error: 'Database not found' });
    } catch (e) {
        console.error('GET /api/db error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/db', async (req, res) => {
    try {
        const payload = req.body;
        if (Array.isArray(payload.results) && payload.results.length > 0) {
            const current = await readResults();
            await writeResults(mergeResults(current, payload.results));
        }
        const { results, ...dbOnly } = payload;
        await writeDB(dbOnly);
        return res.json({ ok: true });
    } catch (e) {
        console.error('POST /api/db error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

// ─── API: Results ─────────────────────────────────────────────────────────────
app.get('/api/results', async (req, res) => {
    try {
        return res.json(await readResults());
    } catch (e) {
        console.error('GET /api/results error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/results', async (req, res) => {
    try {
        const incoming = req.body;
        if (!Array.isArray(incoming)) return res.status(400).json({ error: 'Array required' });
        const merged = mergeResults(await readResults(), incoming);
        await writeResults(merged);
        return res.json({ ok: true, count: merged.length });
    } catch (e) {
        console.error('POST /api/results error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/result', async (req, res) => {
    try {
        const result = req.body;
        if (!result || typeof result !== 'object') return res.status(400).json({ error: 'Invalid payload' });
        const merged = mergeResults(await readResults(), [result]);
        await writeResults(merged);
        return res.json({ ok: true, count: merged.length });
    } catch (e) {
        console.error('POST /api/result error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

// ─── API: Import Word ─────────────────────────────────────────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        if (file.originalname.endsWith('.docx')) cb(null, true);
        else cb(new Error('Only .docx files are allowed'));
    },
    limits: { fileSize: 10 * 1024 * 1024 }
});

app.post('/api/import-word', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file provided' });
        const metadata = { subject: req.body.subject || '', class: req.body.class || '', type: req.body.type || 'single' };
        const result = await parseWordDocument(req.file.buffer, metadata);
        if (!result.success) return res.status(400).json({ error: result.error });
        const db = (await readDB()) || { ...DEFAULT_DB };
        db.questions = [...(db.questions || []), ...result.questions];
        await writeDB(db);
        return res.json({ ok: true, imported: result.count, questions: result.questions, warnings: result.warnings || [] });
    } catch (e) {
        console.error('POST /api/import-word error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

// ─── API: AI Generate ─────────────────────────────────────────────────────────
app.post('/api/generate-ai', async (req, res) => {
    const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
    if (!GOOGLE_API_KEY) return res.status(500).json({ error: 'GOOGLE_API_KEY not configured' });
    const { materi, jumlah = 5, tipe = 'single', mapel = '', rombel = '' } = req.body;
    if (!materi) return res.status(400).json({ error: 'Materi is required' });
    const prompt = `Buatkan ${jumlah} soal pilihan ganda untuk mata pelajaran ${mapel} kelas ${rombel} tentang: ${materi}.\nFormat JSON array saja:\n[{"text":"Pertanyaan?","options":["A","B","C","D"],"correct":0,"mapel":"${mapel}","rombel":"${rombel}","type":"${tipe}"}]`;
    const models = ['gemini-1.5-flash', 'gemini-1.5-pro'];
    let lastError;
    for (const model of models) {
        try {
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_API_KEY}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
            if (!r.ok) { lastError = `${model}: HTTP ${r.status}`; continue; }
            const j = await r.json();
            const text = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const match = text.match(/\[[\s\S]*\]/);
            if (!match) { lastError = 'No JSON in response'; continue; }
            return res.json({ ok: true, questions: JSON.parse(match[0]) });
        } catch (e) { lastError = e.message; }
    }
    return res.status(500).json({ error: lastError || 'AI generation failed' });
});

// ─── API: IPs ─────────────────────────────────────────────────────────────────
app.get('/api/ips', (req, res) => {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    const ips = [];
    for (const ifaces of Object.values(nets))
        for (const iface of ifaces)
            if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    res.json(ips);
});

// ─── Catch-all ────────────────────────────────────────────────────────────────
app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));
app.use('/api', (err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));

// ─── Local Init ───────────────────────────────────────────────────────────────
if (!USE_GITHUB) {
    if (!fs.existsSync(LOCAL_DATA))    fs.writeFileSync(LOCAL_DATA, JSON.stringify(DEFAULT_DB, null, 2));
    if (!fs.existsSync(LOCAL_RESULTS)) fs.writeFileSync(LOCAL_RESULTS, '[]');
}

// ─── Listen (skip on Vercel) ──────────────────────────────────────────────────
if (!process.env.VERCEL) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 Server running at http://localhost:${PORT}`);
        console.log(`   Mode: ${USE_GITHUB ? 'GitHub DB' : 'Local JSON'}`);
    });
}

module.exports = app;
