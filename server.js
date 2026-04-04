require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { parseWordDocument } = require('./wordParser');

const app = express();
app.use(cors());
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

const rootPath = process.cwd();

// ─── Environment ──────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Local fallback paths
const LOCAL_DATA = path.join(process.cwd(), 'database.json');
const LOCAL_RESULTS = path.join(process.cwd(), 'results.json');

const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY);
let supabase = null;

if (USE_SUPABASE) {
    console.log(`✅ Supabase mode: Connected to ${SUPABASE_URL}`);
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
} else {
    console.log('⚠️  Supabase not configured – using local JSON files as fallback.');
}

// ─── Default DB ───────────────────────────────────────────────────────────────
const DEFAULT_DB = {
    subjects: [
        { name: 'Pendidikan Agama', locked: false },
        { name: 'Bahasa Indonesia', locked: false },
        { name: 'Matematika', locked: false },
        { name: 'IPA', locked: false },
        { name: 'IPS', locked: false },
        { name: 'Bahasa Inggris', locked: false }
    ],
    rombels: ['VII', 'VIII', 'IX'],
    questions: [],
    students: [{ id: 'ADM', password: 'admin321', name: 'Administrator', role: 'admin' }],
    results: [],
    schedules: [],
    timeLimits: {}
};

// ─── Merge helpers ────────────────────────────────────────────────────────────
function mergeResults(existing = [], incoming = []) {
    const map = new Map();
    const key = r => `${r.studentId || ''}::${r.mapel || ''}::${r.rombel || ''}::${r.date || ''}`;
    existing.forEach(r => map.set(key(r), r));
    incoming.forEach(r => {
        const k = key(r);
        map.set(k, map.has(k) ? Object.assign({}, map.get(k), r) : r);
    });
    return Array.from(map.values());
}

// ─── Data Layer (Supabase Native + Fallback) ──────────────────────────────────
async function readDB() {
    if (USE_SUPABASE) {
        const { data, error } = await supabase
            .from('cbt_database')
            .select('data')
            .eq('id', 1)
            .single();
        if (error && error.code !== 'PGRST116') {
            console.error('Supabase readDB error:', error);
        }
        let dbObj = data ? data.data : null;
        if (dbObj) {
            // Also fetch results separately and merge them into the database object
            try {
                const results = await readResults();
                dbObj.results = results || [];
            } catch (e) {
                console.error('Error fetching results in readDB:', e.message);
                if (!dbObj.results) dbObj.results = [];
            }
        }
        return dbObj;
    }
    try {
        if (!fs.existsSync(LOCAL_DATA)) return null;
        return JSON.parse(fs.readFileSync(LOCAL_DATA, 'utf8'));
    } catch { return null; }
}

async function writeDB(obj) {
    if (USE_SUPABASE) {
        const { error } = await supabase
            .from('cbt_database')
            .upsert({ id: 1, data: obj, updated_at: new Date() });
        if (error) throw new Error('Supabase writeDB error: ' + error.message);
        return;
    }
    fs.writeFileSync(LOCAL_DATA, JSON.stringify(obj, null, 2), 'utf8');
}

async function readResults() {
    if (USE_SUPABASE) {
        const { data, error } = await supabase
            .from('cbt_results')
            .select('data')
            .order('created_at', { ascending: false });
        if (error) {
            console.error('Supabase readResults error:', error);
            return [];
        }
        return data.map(row => row.data);
    }
    try {
        if (!fs.existsSync(LOCAL_RESULTS)) return [];
        return JSON.parse(fs.readFileSync(LOCAL_RESULTS, 'utf8'));
    } catch { return []; }
}

async function writeResults(results) {
    if (USE_SUPABASE) {
        // Separate deleted and active results
        const toDelete = results.filter(r => r.deleted === true);
        const active = results.filter(r => r.deleted !== true);

        // 1. Physically delete from Supabase if marked for deletion (Optimized)
        if (toDelete.length > 0) {
            console.log(`🗑️ Deleting ${toDelete.length} results from Supabase...`);
            // Run deletions in parallel with a limited concurrency or just Promise.all if count is small
            await Promise.all(toDelete.map(r =>
                supabase
                    .from('cbt_results')
                    .delete()
                    .match({
                        student_id: r.studentId || '',
                        mapel: r.mapel || '',
                        rombel: r.rombel || '',
                        date: r.date || ''
                    })
            ));
        }

        // 2. Insert active results
        // Note: For full synchronization, we only insert if not already present, 
        // but current logic trusts admin dashboard for direct sync.
        if (active.length > 0) {
            const records = active.map(r => ({
                student_id: r.studentId || '',
                mapel: r.mapel || '',
                rombel: r.rombel || '',
                date: r.date || new Date().toISOString(),
                score: typeof r.score === 'string' ? parseFloat(r.score) : r.score,
                data: r
            }));
            const { error } = await supabase.from('cbt_results').insert(records);
            if (error) console.error('Supabase bulk insert error:', error.message);
        }
        return;
    }
    fs.writeFileSync(LOCAL_RESULTS, JSON.stringify(results, null, 2), 'utf8');
}

async function insertResultSingle(resultObj) {
    if (USE_SUPABASE) {
        if (resultObj.deleted) {
            const { error } = await supabase
                .from('cbt_results')
                .delete()
                .match({
                    student_id: resultObj.studentId || '',
                    mapel: resultObj.mapel || '',
                    rombel: resultObj.rombel || '',
                    date: resultObj.date || ''
                });
            if (error) throw new Error('Supabase insertResultSingle(delete) error: ' + error.message);
        } else {
            const { error } = await supabase.from('cbt_results').insert({
                student_id: resultObj.studentId || '',
                mapel: resultObj.mapel || '',
                rombel: resultObj.rombel || '',
                date: resultObj.date || new Date().toISOString(),
                score: typeof resultObj.score === 'string' ? parseFloat(resultObj.score) : resultObj.score,
                data: resultObj
            });
            if (error) throw new Error('Supabase insertResultSingle error: ' + error.message);
        }
    } else {
        const merged = mergeResults(await readResults(), [resultObj]);
        fs.writeFileSync(LOCAL_RESULTS, JSON.stringify(merged, null, 2), 'utf8');
    }
}

// ─── Static Files ─────────────────────────────────────────────────────────────
app.use(express.static(rootPath));
app.get('/', (req, res) => res.sendFile(path.join(rootPath, 'index.html')));
app.get('/logo.png', (req, res) => res.sendFile(path.join(rootPath, 'logo.png')));
app.get('/admin', (req, res) => res.sendFile(path.join(rootPath, 'admin.html')));
app.get('/teacher', (req, res) => res.sendFile(path.join(rootPath, 'teacher.html')));
app.get('/student', (req, res) => res.sendFile(path.join(rootPath, 'student.html')));


app.use((req, res, next) => { console.log(`${req.method} ${req.url}`); next(); });

// ─── Health Endpoint ──────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
    const status = {
        ok: false,
        mode: USE_SUPABASE ? 'supabase' : 'local',
        error: null
    };
    if (USE_SUPABASE) {
        try {
            const { error: dbError } = await supabase.from('cbt_database').select('id').limit(1);
            if (dbError) throw dbError;

            status.db_connection = 'OK';
            status.ok = true;
        } catch (e) {
            status.error = e.message;
        }
    } else {
        status.error = 'Set SUPABASE_URL and SUPABASE_KEY in environment variables.';
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
        // Backward compatibility: if entire DB is sent
        if (Array.isArray(payload.results)) {
            await writeResults(payload.results);
        }
        const { results, ...dbOnly } = payload;
        await writeDB(dbOnly);
        return res.json({ ok: true });
    } catch (e) {
        console.error('POST /api/db error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

// New granular endpoints
app.post('/api/db/settings', async (req, res) => {
    try {
        const settings = req.body;
        const current = await readDB() || { ...DEFAULT_DB };
        const updated = { ...current, ...settings };
        delete updated.questions; // Keep current questions
        delete updated.results;   // Keep current results
        await writeDB(updated);
        return res.json({ ok: true });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/db/questions', async (req, res) => {
    try {
        const { questions, append } = req.body;
        if (!Array.isArray(questions)) return res.status(400).json({ error: 'Questions array required' });
        
        const current = (await readDB()) || { ...DEFAULT_DB };
        if (append) {
            current.questions = [...(current.questions || []), ...questions];
        } else {
            current.questions = questions;
        }
        await writeDB(current);
        return res.json({ ok: true, count: current.questions.length });
    } catch (e) {
        console.error('POST /api/db/questions error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/db/results', async (req, res) => {
    try {
        const { results, append } = req.body;
        if (!Array.isArray(results)) return res.status(400).json({ error: 'Results array required' });
        
        if (append) {
            await writeResults(results); // writeResults is additive in Supabase, but replaces in local
            // In local mode, we need to read first if we want to append
            if (!USE_SUPABASE) {
                const current = await readResults();
                const merged = mergeResults(current, results);
                await writeResults(merged);
            }
        } else {
            // Replacement: In local mode just write. In Supabase, this is tricky.
            // For now, let's treat append:false as "clear and write"
            if (!USE_SUPABASE) {
                await writeResults(results);
            } else {
                // Supabase: we'd need to delete all then insert. 
                // But writeResults already handles deletions if the objects have deleted:true.
                await writeResults(results);
            }
        }
        return res.json({ ok: true });
    } catch (e) {
        console.error('POST /api/db/results error:', e.message);
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
        await writeResults(incoming);
        return res.json({ ok: true, count: incoming.length });
    } catch (e) {
        console.error('POST /api/results error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});


app.post('/api/result', async (req, res) => {
    try {
        const result = req.body;
        if (!result || typeof result !== 'object') return res.status(400).json({ error: 'Invalid payload' });
        await insertResultSingle(result);
        return res.json({ ok: true, count: 1 });
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
    const models = [
        'gemini-3.1-pro',
        'gemini-3-flash',
        'gemini-3.1-flash-lite',
        'nano-banana-2',
        'gemini-3.1-flash-image',
        'nano-banana-pro',
        'gemini-3-pro-image',
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-1.5-flash',
        'gemini-1.5-flash-latest',
        'gemini-1.5-pro',
        'gemini-1.5-pro-latest',
        'gemini-pro',
        'gemini-1.0-pro'
    ];
    let lastError;
    for (const model of models) {
        try {
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_API_KEY}`,
                {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                });
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
if (!USE_SUPABASE) {
    if (!fs.existsSync(LOCAL_DATA)) fs.writeFileSync(LOCAL_DATA, JSON.stringify(DEFAULT_DB, null, 2));
    if (!fs.existsSync(LOCAL_RESULTS)) fs.writeFileSync(LOCAL_RESULTS, '[]');
}

// ─── Listen (skip on Vercel) ──────────────────────────────────────────────────
if (!process.env.VERCEL) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 Server running at http://localhost:${PORT}`);
        console.log(`   Mode: ${USE_SUPABASE ? 'Supabase Database' : 'Local JSON'}`);
    });
}

module.exports = app;
