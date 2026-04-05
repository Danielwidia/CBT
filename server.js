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
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));

const rootPath = __dirname;

// ─── Environment ──────────────────────────────────────────────────────────────
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_KEY;

// Local fallback paths
const LOCAL_DATA    = path.join(process.cwd(), 'database.json');
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
        { name: 'Matematika',       locked: false },
        { name: 'IPA',              locked: false },
        { name: 'IPS',              locked: false },
        { name: 'Bahasa Inggris',   locked: false }
    ],
    rombels:    ['Fase D (Kelas 7)', 'Fase D (Kelas 8)', 'Fase D (Kelas 9)'],
    questions:  [],
    students:   [{ id: 'ADM', password: 'admin321', name: 'Administrator', role: 'admin' }],
    results:    [],
    schedules:  [],
    timeLimits: {}
};

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

function normalizeQuestionType(type = '') {
    const t = type.toLowerCase().trim();
    if (['single', 'pilihan_ganda', 'pg', 'multiple_choice'].includes(t)) return 'single';
    if (['multiple', 'pg_kompleks', 'complex', 'checkbox'].includes(t)) return 'multiple';
    if (['text', 'uraian', 'isian', 'essay', 'short_answer'].includes(t)) return 'text';
    if (['tf', 'boolean', 'benar_salah', 'true_false', 'bs'].includes(t)) return 'tf';
    if (['matching', 'jodohkan', 'pasangkan', 'pairing', 'match'].includes(t)) return 'matching';
    return 'single';
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

        // 1. Physically delete from Supabase if marked for deletion
        if (toDelete.length > 0) {
            console.log(`🗑️ Deleting ${toDelete.length} results from Supabase...`);
            for (const r of toDelete) {
                const { error } = await supabase
                    .from('cbt_results')
                    .delete()
                    .match({
                        student_id: r.studentId || '',
                        mapel: r.mapel || '',
                        rombel: r.rombel || '',
                        date: r.date || ''
                    });
                if (error) console.error('Supabase deletion error:', error.message);
            }
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
                score: typeof r.score === 'string' ? parseFloat(r.score) : (r.score || 0),
                data: r
            }));
            const { error } = await supabase.from('cbt_results').upsert(records, { 
                onConflict: 'student_id,mapel,rombel,date' 
            });
            if (error) console.error('Supabase bulk upsert error:', error.message);
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
            let finalScore = typeof resultObj.score === 'string' ? parseFloat(resultObj.score) : resultObj.score;
            if (isNaN(finalScore)) finalScore = 0;

            const { error } = await supabase.from('cbt_results').upsert({
                student_id: resultObj.studentId || '',
                mapel: resultObj.mapel || '',
                rombel: resultObj.rombel || '',
                date: resultObj.date || new Date().toISOString(),
                score: finalScore,
                data: resultObj
            }, {
                onConflict: 'student_id,mapel,rombel,date'
            });
            if (error) throw new Error('Supabase insertResultSingle(upsert) error: ' + error.message);
        }
    } else {
        const merged = mergeResults(await readResults(), [resultObj]);
        fs.writeFileSync(LOCAL_RESULTS, JSON.stringify(merged, null, 2), 'utf8');
    }
}

// ─── Static Files ─────────────────────────────────────────────────────────────
app.get('/',         (req, res) => res.sendFile(path.join(rootPath, 'index.html')));
app.get('/logo.png', (req, res) => res.sendFile(path.join(rootPath, 'logo.png')));
app.get('/administrasi_guru.html', (req, res) => res.sendFile(path.join(rootPath, 'administrasi_guru.html')));

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
        if (Array.isArray(payload.results) && payload.results.length > 0) {
            // Bulk insert results directly in standard payload format
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
// ─── API: AI Generate ─────────────────────────────────────────────────────────
/**
 * Helper to call Gemini with key rotation and model fallback
 */
async function callGeminiAI(prompt) {
    const rawKey = process.env.GOOGLE_API_KEY || '';
    const keys = rawKey.split(',').map(k => k.trim()).filter(k => k);

    console.log('[AI] GOOGLE_API_KEY present:', rawKey.length > 0, '| Keys count:', keys.length);

    if (keys.length === 0) throw new Error('GOOGLE_API_KEY tidak dikonfigurasi di Environment Variables Vercel');

    // ⚠️ PENTING: Models diurutkan dari terbaru/terbaik ke fallback lama.
    // Model yang belum tersedia di API akan mendapat 404 dan di-skip otomatis.
    const models = [
        // ── Gemini 3.x (terbaru, di-skip otomatis jika belum tersedia) ─────────
        'gemini-3.1-pro',
        'gemini-3.1-flash',
        'gemini-3.1-flash-lite',
        'gemini-3.0-flash',
        'gemini-3.0',

        // ── Gemini 2.5 ──────────────────────────────────────────────────────────
        'gemini-2.5-pro',
        'gemini-2.5-pro-preview',
        'gemini-2.5-pro-exp-03-25',
        'gemini-2.5-flash',
        'gemini-2.5-flash-preview',
        'gemini-2.5-flash-image',
        'gemini-2.5-pro-computer-use',

        // ── Gemini 2.0 ──────────────────────────────────────────────────────────
        'gemini-2.0-flash-lite',       // free tier terpisah
        'gemini-2.0-flash',
        'gemini-2.0-flash-001',

        // ── Gemini 1.5 (fallback stabil) ────────────────────────────────────────
        'gemini-1.5-flash-8b',
        'gemini-1.5-flash-8b-latest',
        'gemini-1.5-flash',
        'gemini-1.5-flash-latest',
        'gemini-1.5-pro',
        'gemini-1.5-pro-latest'
    ];

    let lastError;

    // ✅ FIX: Model sebagai outer loop, key sebagai inner loop.
    // Jika SEMUA key habis quota untuk model A → coba model B (bukan sebaliknya).
    for (const model of models) {
        let allKeysQuotaExceeded = true; // asumsi semua key habis untuk model ini

        for (const key of keys) {
            try {
                console.log(`[AI] Trying model: ${model} with key: ${key.substring(0, 10)}...`);

                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                });

                if (response.ok) {
                    const data = await response.json();
                    const result = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    console.log(`[AI] ✅ Success with model: ${model}`);
                    return result;
                }

                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message?.split('\n')[0] || response.statusText; // ambil baris pertama saja
                lastError = `${model}: HTTP ${response.status} - ${errMsg}`;

                if (response.status === 429) {
                    // Key ini habis quota untuk model ini, coba key berikutnya
                    console.warn(`[AI] ⚠️ Quota exceeded: model=${model}, key=${key.substring(0, 10)}...`);
                    continue; // coba key berikutnya
                }

                if (response.status === 404) {
                    // Model tidak ditemukan, skip semua key untuk model ini
                    console.warn(`[AI] Model ${model} not found. Skipping all keys for this model.`);
                    allKeysQuotaExceeded = false; // bukan masalah quota, model memang tidak ada
                    break; // lanjut ke model berikutnya
                }

                // Error lain (500, dll) - anggap key ini tidak habis quota
                console.error(`[AI] Error with ${model} (key ${key.substring(0, 10)}...):`, lastError);
                allKeysQuotaExceeded = false;

            } catch (e) {
                lastError = e.message;
                console.error(`[AI] Fetch Error with ${model}:`, e.message);
                allKeysQuotaExceeded = false;
            }
        }

        if (allKeysQuotaExceeded) {
            console.warn(`[AI] ⛔ Semua key habis quota untuk model ${model}. Mencoba model berikutnya...`);
        }
    }

    throw new Error(
        (lastError || 'Semua model Gemini gagal') +
        ' | Coba gunakan provider AI lain (OpenAI) atau periksa kunci API Anda.'
    );
}

/**
 * Helper to call OpenAI / ChatGPT
 */
async function callOpenAI(prompt) {
    const rawKey = process.env.OPENAI_API_KEY || '';
    const keys = rawKey.split(',').map(k => k.trim()).filter(k => k);

    console.log('[AI] OPENAI_API_KEY present:', rawKey.length > 0, '| Keys count:', keys.length);

    if (keys.length === 0) throw new Error('OPENAI_API_KEY tidak dikonfigurasi di Environment Variables');

    const models = ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'];
    let lastError;

    for (const model of models) {
        for (const key of keys) {
            try {
                console.log(`[AI] Trying OpenAI model: ${model} with key: ${key.substring(0, 10)}...`);

                const response = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${key}`
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [{ role: 'user', content: prompt }]
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    const result = data.choices?.[0]?.message?.content || '';
                    console.log(`[AI] ✅ Success with OpenAI model: ${model}`);
                    return result;
                }

                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message || response.statusText;
                lastError = `${model}: HTTP ${response.status} - ${errMsg}`;

                if (response.status === 429) {
                    console.warn(`[AI] ⚠️ Quota/Rate limit exceeded: model=${model}`);
                    continue; // coba key berikutnya
                }

                console.error(`[AI] Error with ${model}:`, lastError);

            } catch (e) {
                lastError = e.message;
                console.error(`[AI] Fetch Error with OpenAI ${model}:`, e.message);
            }
        }
    }
    throw new Error('OpenAI gagal: ' + (lastError || 'Semua model OpenAI gagal'));
}

/**
 * Unified AI caller with fully automatic fallback mechanism
 */
async function callAI(prompt) {
    try {
        // Coba OpenAI (ChatGPT) lebih dulu karena unggul di struktur
        return await callOpenAI(prompt);
    } catch (e) {
        console.warn(`[AI] OpenAI failed (${e.message}), automatically falling back to Gemini...`);
        return await callGeminiAI(prompt);
    }
}

app.post('/api/generate-ai', async (req, res) => {
    const { materi, jumlah = 5, tipe = 'single', mapel = '', rombel = '' } = req.body;
    if (!materi) return res.status(400).json({ error: 'Materi is required' });

    console.log(`[/api/generate-ai] Request: mapel=${mapel}, rombel=${rombel}, jumlah=${jumlah}, tipe=${tipe}`);
    console.log(`[/api/generate-ai] API keys configured - Google: ${!!process.env.GOOGLE_API_KEY}, OpenAI: ${!!process.env.OPENAI_API_KEY}`);

    const typeMap = {
        single: 'pilihan ganda biasa (1 jawaban benar)',
        multiple: 'pilihan ganda kompleks (bisa lebih dari 1 jawaban benar)',
        text: 'isian / uraian singkat',
        tf: 'benar/salah (berikan 4 pernyataan per soal)',
        matching: 'menjodohkan'
    };
    const tipeDeskripsi = typeMap[tipe] || 'pilihan ganda';
    
    const prompt = `Buatkan ${jumlah} soal bertipe ${tipeDeskripsi} untuk mata pelajaran ${mapel} kelas ${rombel} tentang: ${materi}.\nBalas HANYA dengan JSON array valid tanpa markdown, contoh format:\n[{"text":"Pertanyaan?","options":["A","B","C","D"],"correct":0,"mapel":"${mapel}","rombel":"${rombel}","type":"${tipe}"}]`;
    
    try {
        let text = await callAI(prompt);
        
        // Clean up JSON response
        text = text.replace(/```json\n?|```/g, '').trim();
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) {
            console.error('[/api/generate-ai] AI returned no JSON array. Raw response:', text.substring(0, 200));
            return res.status(500).json({ error: 'AI tidak mengembalikan data soal yang valid. Coba lagi.' });
        }
        
        const parsed = JSON.parse(match[0]);
        console.log(`[/api/generate-ai] Success: generated ${parsed.length} questions`);
        return res.json({ ok: true, questions: parsed });
    } catch (e) {
        console.error('[/api/generate-ai] Fatal error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

// ─── API: Generate Admin Doc ──────────────────────────────────────────────────
app.post('/api/generate-admin-doc', async (req, res) => {
    const { type, mapel, fase, semester, topik, extraData } = req.body;
    
    if (!mapel || !topik) {
        return res.status(400).json({ error: 'Mapel dan Topik diwajibkan' });
    }
    
    let promptText = '';
    let docType = '';

    if (type === 'atp-cp') {
        docType = `Capaian Pembelajaran (CP) dan Alur Tujuan Pembelajaran (ATP)`;
        promptText = `Buatkan rumusan ${docType} untuk mata pelajaran ${mapel} kelas/fase ${fase} semester ${semester} dengan materi pokok "${topik}". Sertakan Elemen, Capaian Pembelajaran, Tujuan Pembelajaran, dan Alur Tujuan Pembelajaran secara sistematis dalam bentuk paragraf atau tabel sesuai standar Kurikulum Merdeka.`;
    } else if (type === 'kktp') {
        docType = `Kriteria Ketercapaian Tujuan Pembelajaran (KKTP)`;
        promptText = `Buatkan rancangan ${docType} (berupa rubrik penilaian/deskripsi ketercapaian) untuk mata pelajaran ${mapel} kelas/fase ${fase} dengan topik/materi "${topik}". Standar pengisian mengikuti Kurikulum Merdeka, cantumkan Interval Nilai dan Deskripsinya.`;
    } else if (type === 'modul-ajar') {
        docType = `Modul Ajar (RPP Plus)`;
        promptText = `Buatkan draf Modul Ajar untuk kelas/fase ${fase} mata pelajaran ${mapel} semester ${semester} mengenai topik "${topik}". Alokasi waktu cadangan: ${extraData?.waktu || '2 x 40 Menit'}. Gunakan Model Pembelajaran: ${extraData?.model || 'Problem Based Learning'}. Berisikan Identitas, Kompetensi Awal, Profil Pelajar Pancasila, Kegiatan Pendahuluan, Kegiatan Inti, Kegiatan Penutup, dan Asesmen secara rinci.`;
    } else if (type === 'prota-promes') {
        docType = `Prota dan Promes`;
        promptText = `Rancang secara ringkas Program Tahunan (Prota) dan Program Semester (Promes) pada mata pelajaran ${mapel} fase ${fase} semester ${semester} mengenai ranah materi "${topik}". Total Pekan Efektif yang direncanakan: ${extraData?.pekan || '18'} Pekan.`;
    } else if (type === 'kisi-kisi') {
        docType = `Kisi-kisi Ujian`;
        promptText = `Buatkan ${docType} (Bentuk: ${extraData?.jenis || 'Soal Ujian Tertulis'}) untuk mata pelajaran ${mapel} materi "${topik}" fase ${fase}. Sajikan dalam bentuk format matriks yang merinci: Indikator Soal, Level Kognitif (seperti L1/L2/L3 atau C1-C6), dan Bentuk Soal.`;
    } else if (type === 'soal-jawaban') {
        docType = `Soal dan Kunci Jawaban`;
        promptText = `Buatkan instrumen Soal dan Kunci Jawaban untuk mata pelajaran ${mapel} fase ${fase} materi "${topik}". Rincian jumlah dan bentuk soal yang diharapkan adalah: ${extraData?.jumlahPerBentuk || '5 soal Pilihan Ganda'}. Usahakan tipe soal HOTS (Higher Order Thinking Skills). Berikan juga pembahasan singkat untuk masing-masing soal.`;
        
        if (extraData?.opsiGambar === 'placeholder') {
            promptText += `\nUntuk soal yang memerlukan ilustrasi gambar, JANGAN gunakan placeholder gambar biasa. Gunakan blok HTML berikut sebagai "Area Ilustrasi" agar terlihat profesional:\n<div style="border: 2px dashed #cbd5e1; border-radius: 8px; padding: 20px; text-align: center; background-color: #f8fafc; margin: 15px 0;"><i class="fas fa-image" style="font-size: 32px; color: #94a3b8; margin-bottom: 10px; display: block;"></i><p style="font-weight: bold; color: #475569; margin: 0; font-size: 14px;">[Area Ilustrasi: DESKRIPSI_GAMBAR]</p><p style="font-size: 11px; color: #94a3b8; margin-top: 5px;">(Guru dapat menyisipkan gambar spesifik di sini)</p></div>\nGanti teks DESKRIPSI_GAMBAR dengan nama/objek gambar yang relevan (misal: "Struktur Akar Tumbuhan").`;
        } else if (extraData?.opsiGambar === 'auto') {
            promptText += `\nUntuk soal yang memerlukan ilustrasi gambar, tampilkan gambar asli secara otomatis dengan memanfaatkan layanan pihak ketiga menggunakan tag HTML ini: <br><img src="https://image.pollinations.ai/prompt/[ENGLISH_VISUAL_DESCRIPTION]?width=500&height=300&nologo=true" alt="Ilustrasi AI" style="border-radius: 8px; margin: 15px 0; max-width: 100%; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); border: 1px solid #e2e8f0;">\nGantikan [ENGLISH_VISUAL_DESCRIPTION] dengan deskripsi visual yang sangat detail dalam BAHASA INGGRIS yang merangkum maksud soal (misalnya: "detailed educational anatomical cross section diagram of human heart on white background"). Semakin detail instruksinya, gambar akan tampil semakin akurat.`;
        }
        
        if (extraData?.generateKisiKisi) {
            promptText += `\n\nPenting: Berdasarkan soal-soal yang Anda buat, buatkan juga matriks KISI-KISI UJIAN yang menjadi panduannya (Lengkap dengan Indikator Soal dan Level Kognitif) dan tampilkan matriks tersebut pada bagian PALING ATAS / AWAL dari dokumen sebelum daftar soal.`;
        }
        
        if (extraData?.pisahLembar) {
            promptText += `\nPenting: Karena fitur 'Pisahkan Halaman' diaktifkan, Anda WAJIB menyisipkan tag HTML ini: <div style="page-break-before: always;"></div> tepat sebelum judul "KUNCI JAWABAN" dimulai.`;
        }

        if (extraData?.simpanBankSoal) {
            promptText += `\nSANGAT PENTING (INSTRUKSI DATABASE): Pada bagian PALING AKHIR dokumen dokumen HTML Anda, sematkan array JSON data soal-soal tersebut HANYA di dalam tag ini persis: <script id="ai-json-data" type="application/json"> [ARRAY_JSON] </script>. ARRAY_JSON adalah format pertanyaan seperti ini: { "text": "Pertanyaan?", "options": ["A","B","C","D"], "correct": 0, "type": "single", "mapel": "${mapel}", "rombel": "${fase}" }.\nWAJIB GUNAKAN TYPE BERIKUT: "single" (PG), "multiple" (PG Kompleks), "text" (Uraian), "tf" (Benar/Salah), "matching" (Menjodohkan). Opsi array kosongkan untuk tipe Isian/Benar-Salah/Menjodohkan. Correct dapat berupa indeks jawaban (untuk PG) atau string kunci jawaban.`;
        }
    } else {
        return res.status(400).json({ error: 'Tipe dokumen tidak valid' });
    }

    const fullPrompt = `${promptText}

PERINTAH FORMATTING: 
Tulis output HANYA MENGGUNAKAN tag HTML (tanpa tag <html>, <head>, atau <body>) agar saya bisa langsung menampilkannya di div innerHTML. Gunakan tag <h1>, <h2>, <h3>, <ul>, <ol>, <li>, <strong>, <em>, <p>, dan <table> (untuk data matriks).
Berikan juga CSS inline jika dibutuhkan untuk struktur tabel (seperti: <table border="1" style="width:100%; border-collapse: collapse; text-align: left; margin-bottom: 20px;"><tr><th style="padding: 8px; background: #f1f5f9;">...</th></tr>).
DILARANG memberikan kalimat pembuka atau penutup di luar tag HTML. DILARANG menggunakan markdown block (seperti \`\`\`html). Output harus 100% kode HTML mentah.`;

    try {
        let text = await callAI(fullPrompt);
        
        // Membersihkan markdown wrapper (```html ... ```) jika AI membocorkannya
        text = text.replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();

        // Cek apakah ada script JSON Bank Soal
        let parsedQuestions = null;
        if (extraData?.simpanBankSoal) {
            const match = text.match(/<script id="ai-json-data"[^>]*>([\s\S]*?)<\/script>/i);
            if (match && match[1]) {
                try {
                    parsedQuestions = JSON.parse(match[1].trim());
                    // Tambahkan ke database
                    const db = (await readDB()) || { questions: [] };
                    if (!db.questions) db.questions = [];
                    // Inject basic standard properties
                    parsedQuestions = parsedQuestions.map(q => ({
                        ...q,
                        mapel: q.mapel || mapel,
                        rombel: q.rombel || fase,
                        type: normalizeQuestionType(q.type)
                    }));
                    db.questions = [...db.questions, ...parsedQuestions];
                    await writeDB(db);
                    console.log(`[AI Bank Soal] Successfully saved ${parsedQuestions.length} questions to database.`);
                    
                    // Hilangkan tag script dari HTML render
                    text = text.replace(match[0], '');
                } catch (parseError) {
                    console.error('[AI Bank Soal] Failed to parse generated JSON:', parseError);
                }
            }
        }

        console.log(`[/api/generate-admin-doc] Success for ${docType}`);
        return res.json({ ok: true, html: text, savedToBankSoal: !!parsedQuestions });
    } catch (e) {
        console.error('[/api/generate-admin-doc] Fatal error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

// ─── API: Kisi-kisi Generate ──────────────────────────────────────────────────
app.post('/api/generate-kisi-kisi', async (req, res) => {
    const { questions, mapel = '', rombel = '' } = req.body;
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ error: 'Questions are required' });
    }

    const limitedQuestions = questions.slice(0, 50);
    const questionsText = limitedQuestions.map((q, i) => `[${i+1}] ${q.text} (Type: ${q.type || 'single'})`).join('\n');

    const prompt = `Analisis soal-soal berikut dan buatkan matriks Kisi-kisi Ujian untuk mata pelajaran ${mapel} kelas ${rombel}.\n` +
        `Berikan output dalam format JSON array of objects dengan properti:\n` +
        `- no: nomor urut (1, 2, ...)\n` +
        `- kd: Kompetensi Dasar (analisis dari konten soal)\n` +
        `- materi: materi pokok\n` +
        `- indikator: indikator soal\n` +
        `- level: level kognitif (L1, L2, L3)\n` +
        `- no_soal: nomor soal asli\n` +
        `- bentuk: bentuk soal (PG, PGK, Isian, Menjodohkan)\n\n` +
        `Soal-soal:\n${questionsText}\n\n` +
        `Hanya kembalikan JSON array saja tanpa markdown code block.`;

    try {
        let text = await callAI(prompt);
        
        // Clean up JSON response
        text = text.replace(/```json\n?|```/g, '').trim();
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) return res.status(500).json({ error: 'No JSON array in AI response' });
        
        const parsed = JSON.parse(match[0]);
        return res.json({ ok: true, kisiKisi: parsed });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
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
    if (!fs.existsSync(LOCAL_DATA))    fs.writeFileSync(LOCAL_DATA, JSON.stringify(DEFAULT_DB, null, 2));
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
