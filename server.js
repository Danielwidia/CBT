const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const multer = require('multer');
const { parseWordDocument } = require('./wordParser');
const app = express();
const os = require('os');

// Standard Node.js environment paths
// Root folder contains: server.js, wordParser.js, package.json, index.html, logo.png
const rootPath = __dirname;

console.log(`🚀 Server starting...`);
console.log(`   Root path: ${rootPath}`);

// Request logger for diagnostic purposes
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url} from ${req.ip}`);
    next();
});

// Main entry point - serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(rootPath, 'index.html'));
});

// Serve logo.png explicitly for security (don't serve entire root)
app.get('/logo.png', (req, res) => {
    res.sendFile(path.join(rootPath, 'logo.png'));
});

// JSON body parser with limit for Large DB transfers
app.use(express.json({ limit: '10mb' }));

// Database and results files in root directory
const DATA_FILE = path.join(process.cwd(), 'database.json');
const RESULTS_FILE = path.join(process.cwd(), 'results.json');

function readDB() {
    try {
        if (!fs.existsSync(DATA_FILE)) return null;
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (err) {
        return null;
    }
}

function writeDB(obj) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

function readResults() {
    try {
        if (!fs.existsSync(RESULTS_FILE)) return [];
        return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
    } catch (err) {
        return [];
    }
}

function writeResults(results) {
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2), 'utf8');
}

function resultUniqueKey(result) {
    if (!result || typeof result !== 'object') return null;
    const sid = result.studentId || '';
    const mapel = result.mapel || '';
    const rombel = result.rombel || '';
    const date = result.date || '';
    return `${sid}::${mapel}::${rombel}::${date}`;
}

function mergeResultsArrays(existing, incoming) {
    const mergedMap = new Map();
    (Array.isArray(existing) ? existing : []).forEach(item => {
        const key = resultUniqueKey(item) || JSON.stringify(item);
        mergedMap.set(key, item);
    });
    (Array.isArray(incoming) ? incoming : []).forEach(item => {
        const key = resultUniqueKey(item) || JSON.stringify(item);
        if (!key) return;
        const old = mergedMap.get(key);
        if (!old) {
            mergedMap.set(key, item);
        } else {
            mergedMap.set(key, Object.assign({}, old, item));
        }
    });
    return Array.from(mergedMap.values());
}

// API Endpoints
app.get('/api/db', (req, res) => {
    const data = readDB();
    if (data) return res.json(data);
    return res.status(404).json({ error: 'Database file not found' });
});

app.post('/api/db', (req, res) => {
    const payload = req.body;
    try {
        const resultsFromPayload = Array.isArray(payload.results) ? payload.results : [];
        if (resultsFromPayload.length > 0) {
            const currentResults = readResults();
            const mergedResults = mergeResultsArrays(currentResults, resultsFromPayload);
            writeResults(mergedResults);
        }
        const { results, ...dbWithoutResults } = payload;
        writeDB(dbWithoutResults);
        return res.json({ ok: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get('/api/results', (req, res) => {
    const results = readResults();
    return res.json(results);
});

app.post('/api/results', (req, res) => {
    const results = req.body;
    try {
        if (!Array.isArray(results)) {
            return res.status(400).json({ error: 'Payload must be array of results' });
        }
        const currentResults = readResults();
        const merged = mergeResultsArrays(currentResults, results);
        writeResults(merged);
        return res.json({ ok: true, count: merged.length });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/result', (req, res) => {
    const result = req.body;
    if (!result || typeof result !== 'object') {
        return res.status(400).json({ error: 'Result payload must be object' });
    }
    try {
        const currentResults = readResults();
        const merged = mergeResultsArrays(currentResults, [result]);
        writeResults(merged);
        return res.json({ ok: true, count: merged.length });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Configure multer for file uploads (.docx)
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
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

app.post('/api/import-word', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file provided' });
        }
        const metadata = {
            subject: req.body.subject || '',
            class: req.body.class || '',
            type: req.body.type || 'single'
        };
        const result = await parseWordDocument(req.file.buffer, metadata);
        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }
        const db = readDB() || { questions: [], subjects: [], rombels: [], students: [], results: [] };
        if (!db.questions) db.questions = [];
        db.questions.push(...result.questions);
        writeDB(db);
        return res.json({
            ok: true,
            imported: result.count,
            questions: result.questions,
            warnings: result.warnings || []
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Windows virtual hotspot functionality
function runNetsh(args) {
    return new Promise((resolve, reject) => {
        if (process.platform !== 'win32') {
            return reject(new Error('netsh is only available on Windows'));
        }
        exec(`netsh wlan ${args}`, { windowsHide: true }, (err, stdout, stderr) => {
            if (err) {
                const msg = stderr || err.message || err.toString();
                const isPermission = /access is denied|requires elevation|akses ditolak|memerlukan elevasi/i.test(msg);
                const e = new Error(msg);
                e.code = isPermission ? 'ELEVATION' : undefined;
                return reject(e);
            }
            resolve(stdout);
        });
    });
}

function hotspotError(res, err) {
    console.error('hotspot error:', err);
    if (err && (err.code === 'ELEVATION' || /access is denied|akses ditolak/i.test(err.message || ''))) {
        return res.status(403).json({ error: 'Please run as Administrator to enable hotspot.' });
    }
    res.status(500).json({ error: err.toString() });
}

app.post('/api/hotspot/start', async (req, res) => {
    const { ssid = 'ExamBrowser', key = '12345678' } = req.body || {};
    if (process.platform !== 'win32') {
        return res.status(400).json({ error: 'Feature only supported on Windows' });
    }
    try {
        await runNetsh(`set hostednetwork mode=allow ssid="${ssid}" key="${key}"`);
        await runNetsh('start hostednetwork');
        res.json({ ok: true });
    } catch (err) {
        hotspotError(res, err);
    }
});

app.post('/api/hotspot/stop', async (req, res) => {
    if (process.platform !== 'win32') {
        return res.status(400).json({ error: 'Feature only supported on Windows' });
    }
    try {
        await runNetsh('stop hostednetwork');
        res.json({ ok: true });
    } catch (err) {
        hotspotError(res, err);
    }
});

app.get('/api/hotspot/status', async (req, res) => {
    if (process.platform !== 'win32') {
        return res.json({ status: 'unsupported' });
    }
    try {
        const output = await runNetsh('show hostednetwork');
        const active = /Status\s*:\s*Started/i.test(output);
        res.json({ status: active ? 'started' : 'stopped', info: output });
    } catch (err) {
        hotspotError(res, err);
    }
});

app.get('/api/ips', (req, res) => {
    res.json(getLocalIPv4Addresses());
});

app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

app.use('/api', (err, req, res, next) => {
    console.error('API error:', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Internal server error' });
});

// Environment configuration
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Initialize data files if missing
if (!fs.existsSync(DATA_FILE)) {
    const defaultDb = {
        subjects: ["Pendidikan Agama", "Bahasa Indonesia", "Matematika", "IPA", "IPS", "Bahasa Inggris", "Seni Budaya", "Informatika", "PJOK", "Bahasa Jawa", "Mandarin"],
        rombels: ["VII", "VIII", "IX"],
        questions: [],
        students: [{ id: "ADM", password: "admin321", name: "Administrator", role: "admin" }]
    };
    writeDB(defaultDb);
}
if (!fs.existsSync(RESULTS_FILE)) {
    writeResults([]);
}

function getLocalIPv4Addresses() {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    const results = [];
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                results.push(net.address);
            }
        }
    }
    return results;
}

function startServer(port, host) {
    app.listen(port, host, async () => {
        console.log(`Server starting at:`);
        console.log(`  - Local:   http://localhost:${port}`);
        const ips = getLocalIPv4Addresses();
        ips.forEach(ip => console.log(`  - Network: http://${ip}:${port}`));
        console.log(`\nReady to accept connections.`);
    }).on('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
            console.error(`Port ${port} is already in use.`);
        } else {
            console.error('Failed to start server:', err);
        }
        process.exit(1);
    });
}

startServer(parseInt(PORT, 10), HOST);
