const DB_KEY = "EXAM_DORKAS_DATABASE_OFFICIAL";
const SESSION_KEY = "EXAM_DORKAS_SESSION";
const REMOTE_SERVER_KEY = "EXAM_DORKAS_REMOTE_SERVER_URL";
const IDB_DB_NAME = 'DORKAS_EXAM_STORAGE';
const IDB_STORE = 'store';

// Global Database Object with defaults
let db = {
    subjects: [{ name: "Pendidikan Agama", locked: false }, { name: "Bahasa Indonesia", locked: false }, { name: "Matematika", locked: false }, { name: "IPA", locked: false }, { name: "IPS", locked: false }, { name: "Bahasa Inggris", locked: false }],
    rombels: ["VII", "VIII", "IX"],
    questions: [],
    students: [{ id: "ADM", password: "admin321", name: "Administrator", role: "admin" }],
    results: [],
    schedules: [],
    timeLimits: {}
};

let currentSiswa = null;

// --- UTILS ---

function mergeResults(localArr = [], serverArr = []) {
    const map = new Map();
    const makeKey = r => {
        if (!r || typeof r !== 'object') return JSON.stringify(r);
        if (r.id) return r.id;
        return `${r.studentId || ''}-${r.mapel || ''}-${r.rombel || ''}-${r.date || ''}`;
    };

    const getTimestamp = r => {
        if (!r || typeof r !== 'object') return 0;
        if (r.updatedAt) {
            const t = Number(r.updatedAt);
            if (!Number.isNaN(t) && t > 0) return t;
        }
        if (r.date) {
            const d = Date.parse(r.date);
            if (!Number.isNaN(d)) return d;
        }
        return 0;
    };

    const hasDetails = r => Array.isArray(r.questions) && r.questions.length > 0 && Array.isArray(r.answers);

    (Array.isArray(localArr) ? localArr : []).forEach(r => {
        const key = makeKey(r);
        map.set(key, r);
    });
    (Array.isArray(serverArr) ? serverArr : []).forEach(r => {
        const key = makeKey(r);
        if (!map.has(key)) {
            map.set(key, r);
            return;
        }
        const existing = map.get(key);
        const existingTs = getTimestamp(existing);
        const incomingTs = getTimestamp(r);

        if (incomingTs > existingTs) {
            map.set(key, Object.assign({}, existing, r));
            return;
        }
        if (!hasDetails(existing) && hasDetails(r)) {
            map.set(key, Object.assign({}, existing, r));
        }
    });
    return Array.from(map.values());
}

function getApiBaseUrl() {
    const remote = localStorage.getItem(REMOTE_SERVER_KEY);
    if (remote && remote.trim()) return remote.trim().replace(/\/$/, "");
    if (window.location.protocol === 'file:') return 'http://localhost:3000';
    return '';
}

function normalizeDb(d) {
    if (!d || typeof d !== 'object') d = {};
    return {
        subjects: Array.isArray(d.subjects) ? d.subjects : [],
        rombels: Array.isArray(d.rombels) ? d.rombels : [],
        questions: Array.isArray(d.questions) ? d.questions : [],
        students: Array.isArray(d.students) ? d.students : [],
        results: Array.isArray(d.results) ? d.results : [],
        schedules: Array.isArray(d.schedules) ? d.schedules : [],
        timeLimits: d.timeLimits && typeof d.timeLimits === 'object' ? d.timeLimits : {}
    };
}

// --- INDEXED DB ---

function openIdb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_DB_NAME, 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e.target.error);
    });
}

async function idbGet(key) {
    const idb = await openIdb();
    return new Promise((res, rej) => {
        const tx = idb.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const r = store.get(key);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    });
}

async function idbSet(key, value) {
    const idb = await openIdb();
    return new Promise((res, rej) => {
        const tx = idb.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        const r = store.put(value, key);
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
    });
}

async function loadLocalDb() {
    try {
        const raw = await idbGet(DB_KEY);
        if (raw) return JSON.parse(raw);
    } catch (e) {
        console.warn('IDB load failed:', e.message || e);
    }
    try {
        const saved = localStorage.getItem(DB_KEY);
        // If it's a number (timestamp), it's just a notification from another tab.
        // We should actually load from IDB in that case.
        return saved && isNaN(saved) ? JSON.parse(saved) : null;
    } catch (e) { return null; }
}

async function saveLocalDb() {
    try {
        await idbSet(DB_KEY, JSON.stringify(db));
    } catch (e) { console.warn('IDB save failed:', e.message); }
    try { localStorage.setItem(DB_KEY, Date.now()); } catch (e) { }
}

async function save() {
    let serverSaveSuccess = false;
    let retries = 3;

    while (retries > 0 && !serverSaveSuccess) {
        try {
            const res = await fetch(getApiBaseUrl() + '/api/db', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(db)
            });

            if (res.ok) {
                serverSaveSuccess = true;
                console.log('Database saved to server');
            } else {
                const errorText = await res.text().catch(() => '');
                console.warn(`Server save failed (attempt ${4 - retries}):`, res.status, res.statusText, errorText);
                retries--;
                if (retries > 0) await new Promise(r => setTimeout(r, 1000));
            }
        } catch (err) {
            console.warn(`Server save error (attempt ${4 - retries}):`, err.message);
            retries--;
            if (retries > 0) await new Promise(r => setTimeout(r, 1000));
        }
    }

    try {
        await saveLocalDb();
    } catch (e) { console.warn('Local persistence failed:', e.message); }

    if (typeof updateStats === 'function') updateStats();
    return serverSaveSuccess;
}

// --- AUTH & SESSION ---

function saveSession() {
    try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ user: currentSiswa, timestamp: Date.now() }));
    } catch (e) { console.warn('saveSession failed:', e); }
}

function clearSession() {
    try {
        localStorage.removeItem(SESSION_KEY);
        currentSiswa = null;
    } catch (e) { }
}

async function logout() {
    if (currentSiswa && currentSiswa.role === 'student') {
        const stu = db.students.find(s => s.id === currentSiswa.id);
        if (stu) {
            stu.isOnline = false;
            await save();
        }
    }
    clearSession();
    window.location.href = 'index.html';
}

function checkAccess(allowedRoles) {
    const saved = localStorage.getItem(SESSION_KEY);
    if (!saved) {
        window.location.href = 'index.html';
        return false;
    }
    try {
        const session = JSON.parse(saved);
        currentSiswa = session.user;
        if (!allowedRoles.includes(currentSiswa.role)) {
            window.location.href = 'index.html';
            return false;
        }
        return true;
    } catch (e) {
        window.location.href = 'index.html';
        return false;
    }
}

// --- INITIALIZATION ---

async function coreInit() {
    // Load local baseline
    try {
        const parsed = await loadLocalDb();
        if (parsed) db = normalizeDb(parsed);
    } catch (e) { console.warn('Baseline load failed'); }

    // Attempt server fetch
    try {
        let res = await fetch(getApiBaseUrl() + '/api/db');
        if (!res.ok) res = await fetch('database.json');
        
        if (res.ok) {
            const serverDb = await res.json();
            if (serverDb && serverDb.students) {
                db = normalizeDb({ ...serverDb });
                await saveLocalDb();
            }
        }
    } catch (err) { console.warn('Server fetch failed'); }
}

// --- UI HELPERS ---

function closeModals() {
    document.querySelectorAll('[id$="-modal"]').forEach(m => {
        m.classList.remove('flex');
        m.classList.add('hidden');
    });
}

function showLoginForm(type) {
    window.loginType = type;
    const modal = document.getElementById('auth-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}
