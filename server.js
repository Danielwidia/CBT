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

// ─── Supabase Setup ───────────────────────────────────────────────────────────
let supabase = null;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (SUPABASE_URL && SUPABASE_KEY) {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('✅ Supabase connected:', SUPABASE_URL);
} else {
    console.log('⚠️  Supabase not configured – using local JSON files as fallback.');
}

// ─── Local File Paths (Fallback) ──────────────────────────────────────────────
const DATA_FILE    = path.join(process.cwd(), 'database.json');
const RESULTS_FILE = path.join(process.cwd(), 'results.json');

// ─── Default DB structure ─────────────────────────────────────────────────────
const DEFAULT_DB = {
    subjects: [
        { name: 'Pendidikan Agama', locked: false },
        { name: 'Bahasa Indonesia', locked: false },
        { name: 'Matematika',       locked: false },
        { name: 'IPA',              locked: false },
        { name: 'IPS',              locked: false },
        { name: 'Bahasa Inggris',   locked: false }
    ],
    rombels:   ['VII', 'VIII', 'IX'],
    questions: [],
    students:  [{ id: 'ADM', password: 'admin321', name: 'Administrator', role: 'admin' }],
    results:   [],
    schedules: [],
    timeLimits: {}
};

// ─── Data Layer ───────────────────────────────────────────────────────────────

/** Merge two results arrays, de-duplicating by (studentId, mapel, rombel, date) */
function mergeResultsArrays(existing = [], incoming = []) {
    const map = new Map();
    const key = r => `${r.studentId||''}::${r.mapel||''}::${r.rombel||''}::${r.date||''}`;
    existing.forEach(r => map.set(key(r), r));
    incoming.forEach(r => {
        const k = key(r);
        map.set(k, map.has(k) ? Object.assign({}, map.get(k), r) : r);
    });
    return Array.from(map.values());
}

async function readDB() {
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('cbt_database')
                .select('data')
                .order('id', { ascending: false })
                .limit(1)
                .single();
            if (error) throw error;
            return data?.data ?? null;
        } catch (e) {
            console.error('Supabase readDB error:', e.message);
            return null;
        }
    }
    // fallback: local file
    try {
        if (!fs.existsSync(DATA_FILE)) return null;
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch { return null; }
}

async function writeDB(obj) {
    if (supabase) {
        const { error } = await supabase
            .from('cbt_database')
            .upsert({ id: 1, data: obj, updated_at: new Date().toISOString() }, { onConflict: 'id' });
        if (error) {
            console.error('Supabase writeDB error:', JSON.stringify(error));
            throw new Error(error.message || 'Supabase write failed');
        }
        return;
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

async function readResults() {
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('cbt_results')
                .select('data')
                .order('id', { ascending: true });
            if (error) throw error;
            return (data || []).map(row => row.data);
        } catch (e) {
            console.error('Supabase readResults error:', e.message);
            return [];
        }
    }
    try {
        if (!fs.existsSync(RESULTS_FILE)) return [];
        return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
    } catch { return []; }
}

async function writeResults(results) {
    if (supabase) {
        // Delete all then re-insert
        const { error: delErr } = await supabase
            .from('cbt_results')
            .delete()
            .gte('id', 0); // delete all rows
        if (delErr) {
            console.error('Supabase delete error:', JSON.stringify(delErr));
            throw new Error(delErr.message || 'Supabase delete failed');
        }
        if (results.length === 0) return;
        const rows = results.map(r => ({
            student_id: r.studentId || '',
            mapel:      r.mapel    || '',
            rombel:     r.rombel   || '',
            date:       r.date     || '',
            score:      r.score    ?? null,
            data:       r
        }));
        const { error: insErr } = await supabase.from('cbt_results').insert(rows);
        if (insErr) {
            console.error('Supabase insert error:', JSON.stringify(insErr));
            throw new Error(insErr.message || 'Supabase insert failed');
        }
        return;
    }
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2), 'utf8');
}

// ─── Static Files ─────────────────────────────────────────────────────────────
app.get('/',         (req, res) => res.sendFile(path.join(rootPath, 'index.html')));
app.get('/logo.png', (req, res) => res.sendFile(path.join(rootPath, 'logo.png')));

// ─── Request Logger ───────────────────────────────────────────────────────────
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

// ─── API Endpoints ────────────────────────────────────────────────────────────
app.get('/api/db', async (req, res) => {
    try {
        const data = await readDB();
        if (data) return res.json(data);
        return res.status(404).json({ error: 'Database not found' });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/db', async (req, res) => {
    try {
        const payload = req.body;
        // Merge results separately so they are never lost
        const resultsFromPayload = Array.isArray(payload.results) ? payload.results : [];
        if (resultsFromPayload.length > 0) {
            const currentResults = await readResults();
            await writeResults(mergeResultsArrays(currentResults, resultsFromPayload));
        }
        const { results, ...dbWithoutResults } = payload;
        await writeDB(dbWithoutResults);
        return res.json({ ok: true });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

app.get('/api/results', async (req, res) => {
    try {
        const results = await readResults();
        return res.json(results);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/results', async (req, res) => {
    try {
        const incoming = req.body;
        if (!Array.isArray(incoming)) return res.status(400).json({ error: 'Payload must be array' });
        const current = await readResults();
        const merged  = mergeResultsArrays(current, incoming);
        await writeResults(merged);
        return res.json({ ok: true, count: merged.length });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/result', async (req, res) => {
    try {
        const result = req.body;
        if (!result || typeof result !== 'object') return res.status(400).json({ error: 'Invalid payload' });
        const current = await readResults();
        const merged  = mergeResultsArrays(current, [result]);
        await writeResults(merged);
        return res.json({ ok: true, count: merged.length });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// ─── Word Import ──────────────────────────────────────────────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            file.originalname.endsWith('.docx')) {
            cb(null, true);
        } else {
            cb(new Error('Only .docx files are allowed'));
        }
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
        if (!db.questions) db.questions = [];
        db.questions.push(...result.questions);
        await writeDB(db);
        return res.json({ ok: true, imported: result.count, questions: result.questions, warnings: result.warnings || [] });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// ─── AI Question Generation ───────────────────────────────────────────────────
app.post('/api/generate-ai', async (req, res) => {
    const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
    if (!GOOGLE_API_KEY) return res.status(500).json({ error: 'GOOGLE_API_KEY not configured' });

    const { materi, jumlah = 5, tipe = 'single', mapel = '', rombel = '' } = req.body;
    if (!materi) return res.status(400).json({ error: 'Materi is required' });

    const models = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'];
    const prompt = `Buatkan ${jumlah} soal pilihan ganda (tipe: ${tipe}) untuk mata pelajaran ${mapel} kelas ${rombel} tentang: ${materi}.
Format JSON array tanpa teks lain:
[{"text":"Pertanyaan?","options":["A","B","C","D"],"correct":0,"mapel":"${mapel}","rombel":"${rombel}","type":"${tipe}"}]`;

    let lastError;
    for (const model of models) {
        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_API_KEY}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }
            );
            if (!response.ok) { lastError = `Model ${model}: ${response.status}`; continue; }
            const json = await response.json();
            const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const match = text.match(/\[[\s\S]*\]/);
            if (!match) { lastError = 'No JSON array in response'; continue; }
            const questions = JSON.parse(match[0]);
            return res.json({ ok: true, questions });
        } catch (e) {
            lastError = e.message;
        }
    }
    return res.status(500).json({ error: lastError || 'AI generation failed' });
});

// ─── IPs ──────────────────────────────────────────────────────────────────────
app.get('/api/ips', (req, res) => {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    const ips = [];
    for (const ifaces of Object.values(nets)) {
        for (const iface of ifaces) {
            if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
        }
    }
    res.json(ips);
});

// ─── 404 & Error Handlers ─────────────────────────────────────────────────────
app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));
app.use('/api', (err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));

// ─── Init Local Files if Running Locally ─────────────────────────────────────
if (!supabase) {
    if (!fs.existsSync(DATA_FILE))    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DB, null, 2));
    if (!fs.existsSync(RESULTS_FILE)) fs.writeFileSync(RESULTS_FILE, '[]');
}

// ─── Start (skip listen when running on Vercel) ───────────────────────────────
if (!process.env.VERCEL) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 Server running at http://localhost:${PORT}`);
        if (supabase) console.log('   Mode: Supabase (Cloud)');
        else          console.log('   Mode: Local JSON files');
    });
}

module.exports = app; // required for Vercel serverless
