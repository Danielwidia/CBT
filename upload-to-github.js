/**
 * upload-to-github.js
 * 
 * Script untuk upload database lokal ke GitHub.
 * Jalankan dengan: node upload-to-github.js
 * 
 * Pastikan GITHUB_TOKEN dan GITHUB_REPO sudah di-set di .env
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_REPO   = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.error('\n❌ ERROR: GITHUB_TOKEN dan GITHUB_REPO harus di-set di file .env\n');
    console.error('Tambahkan baris berikut ke .env:');
    console.error('  GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx');
    console.error('  GITHUB_REPO=username/nama-repo\n');
    process.exit(1);
}

const GH_HEADERS = {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept':        'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type':  'application/json'
};

async function ghReadFile(filePath) {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`;
    const res  = await fetch(url, { headers: GH_HEADERS });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub read ${filePath}: HTTP ${res.status}`);
    const json = await res.json();
    return { sha: json.sha };
}

async function ghWriteFile(filePath, data, sha) {
    const url  = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`;
    const body = {
        message:  `[CBT] update ${filePath}`,
        content:  Buffer.from(data).toString('base64'),
        branch:   GITHUB_BRANCH
    };
    if (sha) body.sha = sha;
    const res = await fetch(url, { method: 'PUT', headers: GH_HEADERS, body: JSON.stringify(body) });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`GitHub write ${filePath}: ${err}`);
    }
    return res.json();
}

async function uploadFile(localPath, remotePath, description) {
    process.stdout.write(`⬆️  Uploading ${description}...`);
    
    if (!fs.existsSync(localPath)) {
        console.log(` SKIPPED (file not found: ${localPath})`);
        return false;
    }
    
    const content = fs.readFileSync(localPath, 'utf8');
    
    try {
        // Validate JSON
        JSON.parse(content);
    } catch (e) {
        console.log(` ❌ GAGAL (bukan JSON valid: ${e.message})`);
        return false;
    }
    
    try {
        // Check for existing file (need SHA for updates)
        const existing = await ghReadFile(remotePath);
        await ghWriteFile(remotePath, content, existing?.sha);
        console.log(` ✅ OK`);
        return true;
    } catch (e) {
        console.log(` ❌ GAGAL: ${e.message}`);
        return false;
    }
}

async function main() {
    console.log('\n🚀 Upload Database ke GitHub');
    console.log(`   Repo   : ${GITHUB_REPO}`);
    console.log(`   Branch : ${GITHUB_BRANCH}\n`);
    
    const LOCAL_DB      = path.join(__dirname, 'database.json');
    const LOCAL_RESULTS = path.join(__dirname, 'results.json');
    const LOCAL_DB_DATA      = path.join(__dirname, '_data', 'cbt_db.json');
    const LOCAL_RESULTS_DATA = path.join(__dirname, '_data', 'cbt_results.json');
    
    // Determine which DB file to use (prefer _data/cbt_db.json, fallback to database.json)
    let dbLocalPath = LOCAL_DB_DATA;
    if (!fs.existsSync(LOCAL_DB_DATA) && fs.existsSync(LOCAL_DB)) {
        dbLocalPath = LOCAL_DB;
        console.log('ℹ️  Menggunakan database.json sebagai sumber data DB\n');
    }
    
    // Determine which results file to use
    let resultsLocalPath = LOCAL_RESULTS_DATA;
    if (!fs.existsSync(LOCAL_RESULTS_DATA) && fs.existsSync(LOCAL_RESULTS)) {
        resultsLocalPath = LOCAL_RESULTS;
        console.log('ℹ️  Menggunakan results.json sebagai sumber data hasil\n');
    }
    
    const ok1 = await uploadFile(dbLocalPath,      '_data/cbt_db.json',      'Database (soal, siswa, jadwal)');
    const ok2 = await uploadFile(resultsLocalPath,  '_data/cbt_results.json', 'Hasil Ujian');
    
    console.log('\n' + (ok1 && ok2 ? '✅ Semua file berhasil di-upload ke GitHub!' : '⚠️  Ada file yang gagal di-upload.'));
    console.log('\n📋 Langkah selanjutnya:');
    console.log('   1. Set GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH di Vercel Environment Variables');
    console.log('   2. Redeploy aplikasi di Vercel');
    console.log('   3. Buka /api/health untuk verifikasi\n');
}

main().catch(e => {
    console.error('\n❌ Fatal error:', e.message);
    process.exit(1);
});
