/**
 * admin.js
 * Logic specifically for the Admin Dashboard
 */

let editQuestionIndex = null;
let currentQType = 'single';
let activeCorrect = 0;
let activeCorrectMultiple = [];
let resultsPollInterval = null;

function adminInit() {
    console.log('Admin Dashboard Initialized');
    showAdminSection('overview');
}

function showAdminSection(sec) {
    document.querySelectorAll('.admin-section').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById('admin-' + sec);
    if (target) {
        target.classList.remove('hidden');
        if (sec === 'overview') {
            updateStats();
            updateBackupInfo();
        }
    }
    document.querySelectorAll('.nav-link').forEach(l => {
        l.classList.remove('bg-sky-600', 'text-white');
        if (l.dataset.section === sec) l.classList.add('bg-sky-600', 'text-white');
    });

    if (sec === 'banksoal') {
        populateSelects(['filter-mapel', 'filter-rombel'], true);
        renderAdminQuestions();
    }
    if (sec === 'rombel') {
        renderRombelSection();
    }
    if (sec === 'students') {
        renderAdminStudents();
    }
    if (sec === 'results') {
        populateSelects(['results-filter-rombel', 'results-filter-mapel'], true);
        renderAdminResults();
        fetchAndMerge(); // Initial fetch
        if (resultsPollInterval) clearInterval(resultsPollInterval);
        resultsPollInterval = setInterval(fetchAndMerge, 5000);
    } else {
        if (resultsPollInterval) {
            clearInterval(resultsPollInterval);
            resultsPollInterval = null;
        }
    }
    if (sec === 'overview') {
        updateStats();
        if (typeof fetchIPs === 'function') fetchIPs();
    }
    if (sec === 'settings') {
        const admin = db.students.find(x => x.role === 'admin');
        if (admin) document.getElementById('set-admin-id').value = admin.id;
        renderTeacherSubjectCheckboxes();
        renderTeachersList();
        const remoteUrlInput = document.getElementById('set-remote-url');
        if (remoteUrlInput) {
            remoteUrlInput.value = localStorage.getItem(REMOTE_SERVER_KEY) || '';
        }
    }
    if (typeof fetchHotspotStatus === 'function') fetchHotspotStatus();
}

function updateStats() {
    const subjects = Array.isArray(db?.subjects) ? db.subjects : [];
    const questions = Array.isArray(db?.questions) ? db.questions : [];
    const rombels = Array.isArray(db?.rombels) ? db.rombels : [];
    const students = Array.isArray(db?.students) ? db.students : [];
    const results = Array.isArray(db?.results) ? db.results : [];

    const ids = ['stat-subjects', 'stat-questions', 'stat-rombel', 'stat-students', 'stat-results'];
    const vals = [
        subjects.length,
        questions.length,
        rombels.length,
        students.filter(x => x.role !== 'admin').length,
        results.filter(r => !r.deleted).length
    ];
    ids.forEach((id, i) => {
        const el = document.getElementById(id);
        if (el) el.innerText = vals[i];
    });
}

function renderRombelSection() {
    const mapelList = document.getElementById('mapel-list');
    const rombelList = document.getElementById('rombel-list');
    if (!mapelList || !rombelList) return;

    mapelList.innerHTML = db.subjects.map(s => {
        const name = typeof s === 'string' ? s : s.name;
        return `
            <div class="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                <span class="font-bold text-slate-700">${name}</span>
                <button onclick="deleteMapel('${name}')" class="text-red-400 hover:text-red-600"><i class="fas fa-trash"></i></button>
            </div>
        `;
    }).join('');

    rombelList.innerHTML = db.rombels.map(r => `
        <div class="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
            <span class="font-bold text-slate-700">${r}</span>
            <button onclick="deleteRombel('${r}')" class="text-red-400 hover:text-red-600"><i class="fas fa-trash"></i></button>
        </div>
    `).join('');
    if (typeof updateCompletionCharts === 'function') updateCompletionCharts();
}

function deleteMapel(name) {
    if (confirm(`Hapus mata pelajaran "${name}"?`)) {
        db.subjects = db.subjects.filter(s => (typeof s === 'string' ? s : s.name) !== name);
        save();
        renderRombelSection();
    }
}

function deleteRombel(name) {
    if (confirm(`Hapus rombel "${name}"?`)) {
        db.rombels = db.rombels.filter(r => r !== name);
        save();
        renderRombelSection();
    }
}

function populateSelects(ids, includeAll = false) {
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const list = id.includes('mapel') ? db.subjects : db.rombels;
        let html = includeAll ? `<option value="ALL">SEMUA</option>` : '';
        html += list.map(item => {
            const val = id.includes('mapel') ? (typeof item === 'string' ? item : item.name) : item;
            const display = val;
            return `<option value="${val}">${display}</option>`;
        }).join('');
        el.innerHTML = html;
    });
}

function renderAdminQuestions() {
    const fR = document.getElementById('filter-rombel').value;
    const fM = document.getElementById('filter-mapel').value;
    const searchTerm = document.getElementById('search-questions').value.toLowerCase();
    const tbody = document.getElementById('questions-table-body');
    if (!tbody) return;

    let filtered = db.questions.filter(q => (fR === 'ALL' || q.rombel === fR) && (fM === 'ALL' || q.mapel === fM));

    if (searchTerm) {
        filtered = filtered.filter(q => q.text.toLowerCase().includes(searchTerm));
    }

    // Update statistics markers on screen
    const tq = document.getElementById('total-questions');
    if (tq) tq.textContent = db.questions.length;
    const fq = document.getElementById('filtered-questions');
    if (fq) fq.textContent = filtered.length;
    const tc = document.getElementById('total-count');
    if (tc) tc.textContent = db.questions.length;
    const fc = document.getElementById('filtered-count');
    if (fc) fc.textContent = filtered.length;

    tbody.innerHTML = filtered.map((q, i) => {
        let typeName = { 'single': 'Pilihan Ganda', 'multiple': 'PG Kompleks', 'text': 'Uraian', 'tf': 'Benar/Salah', 'matching': 'Menjodohkan' }[q.type || 'single'] || 'Pilihan Ganda';
        let corrText = '';
        if (q.type === 'multiple') {
            corrText = (Array.isArray(q.correct) ? q.correct.map(x => ['A', 'B', 'C', 'D'][x]).join(',') : q.correct);
        } else if (q.type === 'text') {
            corrText = 'Teks';
        } else if (q.type === 'tf') {
            if (Array.isArray(q.options)) {
                corrText = q.options.map((stmt, j) => {
                    const val = Array.isArray(q.correct) ? q.correct[j] : false;
                    return `${stmt} (${val ? 'Benar' : 'Salah'})`;
                }).join(' / ');
            } else {
                corrText = 'Benar/Salah';
            }
        } else if (q.type === 'matching') {
            corrText = 'Match';
        } else {
            corrText = ['A', 'B', 'C', 'D'][q.correct];
        }
        const originalIndex = db.questions.indexOf(q);
        return `
        <tr class="hover:bg-slate-50 transition-colors">
            <td class="px-6 py-4 text-center">
                <div class="flex items-center justify-center gap-2">
                    <span class="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded">${originalIndex + 1}</span>
                    <div class="flex flex-col gap-1">
                        <button onclick="moveQuestionUp(${originalIndex})" class="text-slate-400 hover:text-slate-600 text-xs p-1 rounded hover:bg-slate-100 transition-colors ${originalIndex === 0 ? 'opacity-50 cursor-not-allowed' : ''}" ${originalIndex === 0 ? 'disabled' : ''}><i class="fas fa-chevron-up"></i></button>
                        <button onclick="moveQuestionDown(${originalIndex})" class="text-slate-400 hover:text-slate-600 text-xs p-1 rounded hover:bg-slate-100 transition-colors ${originalIndex === db.questions.length - 1 ? 'opacity-50 cursor-not-allowed' : ''}" ${originalIndex === db.questions.length - 1 ? 'disabled' : ''}><i class="fas fa-chevron-down"></i></button>
                    </div>
                </div>
            </td>
            <td class="px-6 py-4">
                <p class="font-medium text-slate-800 text-sm leading-relaxed line-clamp-2 break-words">${q.text}</p>
                ${(q.images && Array.isArray(q.images) && q.images.length > 0) ? `<div class="flex items-center gap-1 mt-1"><i class="fas fa-images text-xs text-sky-500"></i><span class="text-xs text-sky-600">${q.images.length} gambar</span></div>` : (q.image ? '<div class="flex items-center gap-1 mt-1"><i class="fas fa-image text-xs text-slate-400"></i><span class="text-xs text-slate-500">1 gambar</span></div>' : '')}
            </td>
            <td class="px-6 py-4">
                <div class="flex flex-col gap-1 items-start">
                    <span class="px-3 py-1 bg-sky-100 text-sky-700 rounded-full text-[10px] font-bold text-center inline-block">${q.mapel}</span>
                    <span class="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-[10px] font-bold text-center inline-block">${q.rombel}</span>
                </div>
            </td>
            <td class="px-6 py-4">
                <span class="font-bold text-sky-600 text-sm break-words">${corrText}</span>
            </td>
            <td class="px-6 py-4">
                <span class="inline-flex items-center justify-center px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-[10px] font-bold whitespace-nowrap">${typeName}</span>
            </td>
            <td class="px-6 py-4 text-center">
                <div class="flex items-center justify-center gap-1">
                    <button onclick="openEditQuestionModal(${originalIndex})" class="p-2 text-sky-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors" title="Edit"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteQuestion(${originalIndex})" class="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Hapus"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>
    `}).join('');

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-12 text-center text-slate-400 italic">Tidak ada soal ditemukan</td></tr>`;
    }
}

function deleteQuestion(idx) {
    if (confirm("Hapus soal?")) {
        db.questions.splice(idx, 1);
        save();
        renderAdminQuestions();
    }
}

function moveQuestionUp(idx) {
    if (idx > 0) {
        [db.questions[idx], db.questions[idx - 1]] = [db.questions[idx - 1], db.questions[idx]];
        save();
        renderAdminQuestions();
    }
}

function moveQuestionDown(idx) {
    if (idx < db.questions.length - 1) {
        [db.questions[idx], db.questions[idx + 1]] = [db.questions[idx + 1], db.questions[idx]];
        save();
        renderAdminQuestions();
    }
}

// Student Management
function renderAdminStudents() {
    const tbody = document.getElementById('students-table-body');
    const filterSelect = document.getElementById('students-filter-rombel');
    const selectedRombel = filterSelect ? filterSelect.value : '';

    if (filterSelect) {
        const current = filterSelect.value;
        filterSelect.innerHTML = '<option value="">Semua</option>' +
            db.rombels.map(r => `<option value="${r}"${r === current ? ' selected' : ''}>${r}</option>`).join('');
    }

    let list = db.students.filter(x => x.role !== 'admin');
    if (selectedRombel) {
        list = list.filter(s => s.rombel === selectedRombel);
    }

    if (tbody) {
        tbody.innerHTML = list.map(s => `
            <tr>
                <td class="px-6 py-4 font-bold">${s.name}</td>
                <td class="px-6 py-4 text-xs">${s.rombel}</td>
                <td class="px-6 py-4"><span class="bg-slate-100 px-2 py-1 rounded font-mono text-xs">${s.id} / ${s.password}</span></td>
                <td class="px-6 py-4 text-center">
                    <button onclick="resetStudentResults('${s.id}')" class="text-blue-400 hover:text-blue-600 mr-2" title="Reset Hasil Ujian"><i class="fas fa-sync-alt"></i></button>
                    <button onclick="deleteStudent('${s.id}')" class="text-red-400 hover:text-red-600" title="Hapus"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('');
    }
}

function deleteStudent(id) {
    if (confirm("Hapus siswa ini?")) {
        db.students = db.students.filter(x => x.id !== id);
        save();
        renderAdminStudents();
        if (typeof updateCompletionCharts === 'function') updateCompletionCharts();
    }
}

function resetStudentResults(studentId) {
    if (!confirm('Reset hasil ujian untuk siswa ini?')) return;
    let any = false;
    db.results = (db.results || []).map(r => {
        if (r.studentId === studentId && !r.deleted) {
            any = true;
            return { ...r, deleted: true, updatedAt: Date.now() };
        }
        return r;
    });
    if (!any) return alert('Tidak ada hasil ujian aktif untuk siswa ini.');
    save();
    renderAdminResults();
    renderAdminStudents();
    alert('Reset hasil ujian siswa berhasil.');
}

// Results
function renderAdminResults() {
    const tbody = document.getElementById('results-table-body');
    if (!tbody) return;

    const fR = document.getElementById('results-filter-rombel').value;
    const fM = document.getElementById('results-filter-mapel').value;
    const dateFrom = document.getElementById('results-date-from').value;
    const dateTo = document.getElementById('results-date-to').value;

    let list = db.results.filter(r => !r.deleted);

    if (fR !== 'ALL') list = list.filter(r => r.rombel === fR);
    if (fM !== 'ALL') list = list.filter(r => r.mapel === fM);
    if (dateFrom) list = list.filter(r => new Date(r.date) >= new Date(dateFrom));
    if (dateTo) {
        const dTo = new Date(dateTo);
        dTo.setHours(23, 59, 59);
        list = list.filter(r => new Date(r.date) <= dTo);
    }

    list.sort((a, b) => new Date(b.date) - new Date(a.date));

    tbody.innerHTML = list.map(r => {
        const originalIndex = db.results.indexOf(r);
        return `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="px-6 py-4 font-bold text-slate-700">${r.studentName}</td>
                <td class="px-6 py-4 text-xs font-semibold text-slate-500">${r.rombel}</td>
                <td class="px-6 py-4 text-xs font-bold text-sky-600 uppercase tracking-tighter">${r.mapel}</td>
                <td class="px-6 py-4 text-[10px] font-medium text-slate-400">${r.date ? new Date(r.date).toLocaleString('id-ID') : '-'}</td>
                <td class="px-6 py-4 text-center font-black text-sky-600 text-lg">${Number(r.score).toFixed(1)}</td>
                <td class="px-6 py-4 text-center">
                    <button onclick="viewDetailedResult(${originalIndex})" class="w-8 h-8 rounded-lg bg-sky-50 text-sky-500 hover:bg-sky-100 transition-all shadow-sm" title="Lihat"><i class="fas fa-eye"></i></button>
                    <button onclick="deleteResult(${originalIndex})" class="w-8 h-8 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-all shadow-sm ml-1" title="Hapus"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;
    }).join('');
}

function deleteResult(idx) {
    if (!confirm('Hapus hasil ujian ini?')) return;
    db.results[idx].deleted = true;
    db.results[idx].updatedAt = Date.now();
    save();
    renderAdminResults();
    updateStats();
}

function clearResultsFilter() {
    document.getElementById('results-filter-rombel').value = 'ALL';
    document.getElementById('results-filter-mapel').value = 'ALL';
    document.getElementById('results-date-from').value = '';
    document.getElementById('results-date-to').value = '';
    renderAdminResults();
}

// Backup / Database
function exportDatabase() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(db, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `BACKUP_CBT_DORKAS_${new Date().toISOString().split('T')[0]}.json`);
    dlAnchor.click();
    dlAnchor.remove();
}

async function importDatabase(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const parsed = JSON.parse(e.target.result);
            if (!parsed.students || !parsed.questions) throw new Error("File backup tidak valid");
            if (!confirm('Ganti seluruh database dengan file backup? Semua data saat ini akan terhapus.')) return;
            db = normalizeDb(parsed);
            await save();
            alert('Restore berhasil! Memuat ulang...');
            location.reload();
        } catch (err) { alert('Error: ' + err.message); }
    };
    reader.readAsText(file);
}

function updateBackupInfo() {
    const el = document.getElementById('backup-info-text');
    if (!el) return;
    const last = localStorage.getItem('last_restore_date');
    if (last) {
        el.innerText = `Terakhir direstore: ${new Date(last).toLocaleString('id-ID')}`;
    }
}

// Hotspot
async function fetchHotspotStatus() {
    try {
        const res = await fetch(getApiBaseUrl() + '/api/hotspot/status');
        const data = await res.json();
        const el = document.getElementById('hotspot-status');
        if (el) el.innerText = 'Status: ' + (data.status || 'Unknown');
    } catch (e) {
        const el = document.getElementById('hotspot-status');
        if (el) el.innerText = 'Status: Disconnected (Local)';
    }
}

// IP Fetch
async function fetchIPs() {
    try {
        const res = await fetch(getApiBaseUrl() + '/api/ips');
        const ips = await res.json();
        const container = document.getElementById('accessible-ips');
        if (container) {
            container.innerHTML = ips.map(ip => `<div class="font-mono bg-slate-50 px-3 py-2 rounded-lg mb-2">http://${ip}:3000</div>`).join('');
        }
    } catch (e) {
        const container = document.getElementById('accessible-ips');
        if (container) container.innerHTML = '<div class="text-red-500">Gagal memuat alamat IP. Pastikan server berjalan.</div>';
    }
}

// Teacher Mgmt in settings
function renderTeachersList() {
    const tbody = document.getElementById('teachers-table-body');
    if (!tbody) return;
    const teachers = db.students.filter(s => s.role === 'teacher');
    tbody.innerHTML = teachers.map(t => `
        <tr>
            <td class="px-6 py-4 font-bold">${t.name}</td>
            <td class="px-6 py-4 text-xs">${t.id}</td>
            <td class="px-6 py-4 text-sm">${(t.subjects || []).map(s => typeof s === 'string' ? s : `${s.name} (${(s.rombels || []).join(', ')})`).join(', ')}</td>
            <td class="px-6 py-4 text-sm">${(t.rombels || []).join(', ')}</td>
            <td class="px-6 py-4 text-center">
                <button onclick="deleteTeacher('${t.id}')" class="text-red-400 hover:text-red-600"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

function deleteTeacher(id) {
    if (confirm('Hapus guru ini?')) {
        db.students = db.students.filter(s => s.id !== id);
        save();
        renderTeachersList();
    }
}

function renderTeacherSubjectCheckboxes() {
    const container = document.getElementById('teacher-subjects');
    if (!container) return;
    container.innerHTML = db.subjects.map(s => {
        const name = typeof s === 'string' ? s : s.name;
        const rombCheckboxes = db.rombels.map(r =>
            `<label class="flex items-center gap-1"><input type="checkbox" disabled class="teacher-rombel-checkbox" data-parent-subject="${name}" data-rombel="${r}" /> <span class="text-[11px]">${r}</span></label>`
        ).join('');
        return `
            <div class="p-3 bg-slate-50 rounded-xl border border-slate-100 mb-2">
                <label class="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" class="teacher-subject-checkbox" data-subject="${name}" onchange="toggleTeacherRombels('${name}', this.checked)" />
                    <span class="text-sm font-medium">${name}</span>
                </label>
                <div class="mt-2 ml-6 flex flex-wrap gap-2">${rombCheckboxes}</div>
            </div>
        `;
    }).join('');
}

function toggleTeacherRombels(subject, checked) {
    document.querySelectorAll(`.teacher-rombel-checkbox[data-parent-subject="${subject}"]`).forEach(rb => {
        rb.disabled = !checked;
        if (!checked) rb.checked = false;
    });
}

function registerTeacher() {
    const name = document.getElementById('teacher-name').value.trim();
    const id = document.getElementById('teacher-id').value.toUpperCase().trim();
    const password = document.getElementById('teacher-password').value.trim();
    const checkedSubjects = document.querySelectorAll('.teacher-subject-checkbox:checked');

    if (!name || !id || !password) return alert('Lengkapi data guru!');
    if (checkedSubjects.length === 0) return alert('Pilih minimal satu mapel!');

    const selected = Array.from(checkedSubjects).map(cb => {
        const subj = cb.dataset.subject;
        const rombels = Array.from(document.querySelectorAll(`.teacher-rombel-checkbox[data-parent-subject="${subj}"]:checked`)).map(rb => rb.dataset.rombel);
        return { name: subj, rombels };
    });

    if (selected.some(s => s.rombels.length === 0)) return alert('Pilih rombel untuk setiap mapel!');

    db.students.push({ id, password, name, role: 'teacher', subjects: selected });
    save();
    renderTeachersList();
    alert('Guru berhasil didaftarkan!');
}

async function fetchAndMerge() {
    try {
        const res = await fetch(getApiBaseUrl() + '/api/results');
        if (res.ok) {
            const serverResults = await res.json();
            const merged = mergeResults(db.results, serverResults);
            if (JSON.stringify(merged) !== JSON.stringify(db.results)) {
                db.results = merged;
                updateStats();
                if (typeof renderAdminResults === 'function') renderAdminResults();
            }
        }
    } catch (e) { console.warn('Fetch and merge failed'); }
}

function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    if (menu) menu.classList.toggle('hidden');
}

function onQuestionTypeChange() {
    const sel = document.getElementById('q-type');
    if (!sel) return;
    currentQType = sel.value;
    const optsContainer = document.getElementById('q-opts-container');
    const buttons = document.querySelectorAll('.c-btn');
    const answerTextContainer = document.getElementById('q-answer-text-container');
    const tfContainer = document.getElementById('q-tf-container');
    const matchingContainer = document.getElementById('q-matching-container');
    const qTextGroup = document.getElementById('q-text-group');
    const qOpsiGroup = document.getElementById('q-opsi-group');
    const correctButtonsGroup = document.getElementById('q-correct-buttons-group');

    if (!optsContainer) return;

    // Reset visibility
    [optsContainer, answerTextContainer, tfContainer, matchingContainer, correctButtonsGroup, qOpsiGroup].forEach(el => el && el.classList.add('hidden'));
    if (qTextGroup) qTextGroup.classList.remove('hidden');

    if (currentQType === 'text') {
        if (answerTextContainer) answerTextContainer.classList.remove('hidden');
    } else if (currentQType === 'tf') {
        if (tfContainer) tfContainer.classList.remove('hidden');
    } else if (currentQType === 'matching') {
        if (matchingContainer) matchingContainer.classList.remove('hidden');
        if (qTextGroup) qTextGroup.classList.add('hidden');
    } else {
        // single or multiple
        if (optsContainer) optsContainer.classList.remove('hidden');
        if (correctButtonsGroup) correctButtonsGroup.classList.remove('hidden');
        if (qOpsiGroup) qOpsiGroup.classList.remove('hidden');
        optsContainer.querySelectorAll('.q-opt').forEach(inp => {
            inp.disabled = false;
        });
    }

    // Update correct button labels
    if (buttons && buttons.length >= 4) {
        if (currentQType === 'tf') {
            buttons[0].innerText = 'Benar';
            buttons[1].innerText = 'Salah';
            buttons[2].style.display = 'none';
            buttons[3].style.display = 'none';
        } else {
            ['A', 'B', 'C', 'D'].forEach((l, i) => {
                buttons[i].innerText = l;
                buttons[i].style.display = '';
            });
        }
    }

    activeCorrect = 0;
    activeCorrectMultiple = [];
    renderCorrectButtons();
}

function openQuestionModal() {
    editQuestionIndex = null;
    const modal = document.getElementById('question-modal');
    if (!modal) return;
    
    // Reset form
    document.getElementById('q-type').value = 'single';
    document.getElementById('q-text').value = '';
    document.getElementById('q-answer-text').value = '';
    document.querySelectorAll('.q-opt').forEach(opt => opt.value = '');
    document.getElementById('q-image-file').value = null;
    document.getElementById('q-images-preview').innerHTML = '';
    document.getElementById('q-images-list').innerHTML = '';
    window.storedImages = [];

    // Reset TF rows
    const tfCont = document.getElementById('q-tf-container');
    if (tfCont) {
        tfCont.querySelectorAll('.tf-row').forEach(r => r.remove());
        addTfRow();
        addTfRow();
    }

    populateSelects(['q-mapel', 'q-rombel']);
    onQuestionTypeChange();
    
    document.getElementById('question-modal-title').innerText = 'Tambah Soal Baru';
    document.getElementById('save-question-btn').innerText = 'SIMPAN SOAL';
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function openEditQuestionModal(idx) {
    editQuestionIndex = idx;
    const q = db.questions[idx];
    const modal = document.getElementById('question-modal');
    if (!modal) return;

    populateSelects(['q-mapel', 'q-rombel']);
    document.getElementById('q-mapel').value = q.mapel;
    document.getElementById('q-rombel').value = q.rombel;
    document.getElementById('q-text').value = q.text;
    document.getElementById('q-type').value = q.type || 'single';

    if (q.type === 'text') {
        document.getElementById('q-answer-text').value = q.correct || '';
    } else {
        document.getElementById('q-answer-text').value = '';
    }

    onQuestionTypeChange();

    if (q.type === 'tf') {
        const tfCont = document.getElementById('q-tf-container');
        tfCont.querySelectorAll('.tf-row').forEach(r => r.remove());
        (q.options || []).forEach((stmt, i) => {
            addTfRow();
            const rows = tfCont.querySelectorAll('.tf-row');
            const lastRow = rows[rows.length - 1];
            lastRow.querySelector('.tf-statement').value = stmt;
            lastRow.querySelector('.tf-correct').value = String(q.correct[i]);
        });
    } else if (q.type === 'matching') {
        const qCont = document.getElementById('q-matching-questions');
        const aCont = document.getElementById('q-matching-answers');
        qCont.innerHTML = '';
        aCont.innerHTML = '';
        (q.questions || []).forEach(sq => {
            addMatchingQRow();
            qCont.lastElementChild.querySelector('input').value = sq;
        });
        (q.answers || []).forEach(sa => {
            addMatchingARow();
            aCont.lastElementChild.querySelector('input').value = sa;
        });
    } else {
        const opts = document.querySelectorAll('.q-opt');
        (q.options || []).forEach((opt, i) => { if (opts[i]) opts[i].value = opt; });
    }

    if (q.type === 'multiple') {
        activeCorrectMultiple = Array.isArray(q.correct) ? q.correct.slice() : [];
    } else {
        activeCorrect = q.correct || 0;
    }

    window.storedImages = q.images ? q.images.slice() : (q.image ? [q.image] : []);
    renderImagePreviews();
    renderCorrectButtons();

    document.getElementById('question-modal-title').innerText = 'Edit Soal';
    document.getElementById('save-question-btn').innerText = 'UPDATE SOAL';
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function renderImagePreviews() {
    const previewContainer = document.getElementById('q-images-preview');
    const listContainer = document.getElementById('q-images-list');
    if (!previewContainer || !listContainer) return;

    previewContainer.innerHTML = '';
    listContainer.innerHTML = '';

    window.storedImages.forEach((img, idx) => {
        const imgSrc = typeof img === 'string' ? img : (img.data || '');
        const thumb = document.createElement('div');
        thumb.className = 'relative w-24 h-24 border-2 border-dashed border-sky-300 rounded-lg overflow-hidden';
        thumb.innerHTML = `
            <img src="${imgSrc}" class="w-full h-full object-cover">
            <div class="absolute top-1 right-1 bg-sky-600 text-white text-xs rounded px-1 font-bold">${idx + 1}</div>
            <button onclick="removeStoredImage(${idx})" class="absolute bottom-1 right-1 bg-red-500 text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px]"><i class="fas fa-trash"></i></button>
        `;
        previewContainer.appendChild(thumb);
    });
}

function removeStoredImage(idx) {
    window.storedImages.splice(idx, 1);
    renderImagePreviews();
}

function previewQuestionImages(event) {
    const files = Array.from(event.target.files);
    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            window.storedImages.push(e.target.result);
            renderImagePreviews();
        };
        reader.readAsDataURL(file);
    });
}

function renderCorrectButtons() {
    document.querySelectorAll('.c-btn').forEach((b, i) => {
        let selected = false;
        if (currentQType === 'multiple') {
            selected = activeCorrectMultiple.includes(i);
        } else {
            selected = activeCorrect === i;
        }
        b.className = selected ? 'c-btn flex-1 py-3 border-2 border-sky-600 bg-sky-50 text-sky-600 font-bold rounded-xl' : 'c-btn flex-1 py-3 border-2 border-slate-100 text-slate-400 font-bold rounded-xl';
    });
}

function setActiveCorrect(idx) {
    if (currentQType === 'multiple') {
        const pos = activeCorrectMultiple.indexOf(idx);
        if (pos === -1) activeCorrectMultiple.push(idx);
        else activeCorrectMultiple.splice(pos, 1);
    } else {
        activeCorrect = idx;
    }
    renderCorrectButtons();
}

function saveQuestion() {
    const text = document.getElementById('q-text').value;
    const options = Array.from(document.querySelectorAll('.q-opt')).map(i => i.value);
    const mapel = document.getElementById('q-mapel').value;
    const rombel = document.getElementById('q-rombel').value;
    const type = document.getElementById('q-type').value;

    if (type !== 'matching' && !text) return alert("Lengkapi pertanyaan!");
    if (!mapel || !rombel) return alert("Pilih Mapel dan Rombel!");

    let record = { text, mapel, rombel, type, images: window.storedImages.slice() };

    if (type === 'multiple') {
        if (options.some(o => !o)) return alert("Lengkapi semua pilihan!");
        if (activeCorrectMultiple.length === 0) return alert('Pilih minimal satu jawaban benar!');
        record.options = options;
        record.correct = activeCorrectMultiple.slice();
    } else if (type === 'text') {
        const ans = document.getElementById('q-answer-text').value.trim();
        if (!ans) return alert('Tuliskan jawaban esai yang benar!');
        record.correct = ans;
    } else if (type === 'tf') {
        const rows = Array.from(document.querySelectorAll('.tf-row'));
        const stmts = [];
        const corrs = [];
        for (const r of rows) {
            const s = r.querySelector('.tf-statement').value.trim();
            const c = r.querySelector('.tf-correct').value;
            if (!s || c === '') return alert('Lengkapi pernyataan dan pilih Benar/Salah!');
            stmts.push(s);
            corrs.push(c === 'true');
        }
        record.options = stmts;
        record.correct = corrs;
    } else if (type === 'matching') {
        const qRows = Array.from(document.querySelectorAll('.matching-question'));
        const aRows = Array.from(document.querySelectorAll('.matching-answer'));
        const qs = qRows.map(i => i.value.trim()).filter(Boolean);
        const as = aRows.map(i => i.value.trim()).filter(Boolean);
        if (qs.length === 0 || as.length === 0) return alert('Lengkapi data menjodohkan!');
        if (qs.length !== as.length) return alert('Jumlah pertanyaan dan jawaban harus sama!');
        record.questions = qs;
        record.answers = as;
        record.correct = as.slice();
    } else {
        if (options.some(o => !o)) return alert("Lengkapi semua pilihan!");
        record.options = options;
        record.correct = activeCorrect;
    }

    if (editQuestionIndex !== null) {
        db.questions[editQuestionIndex] = record;
    } else {
        db.questions.push(record);
    }

    save();
    renderAdminQuestions();
    closeModals();
}

function addTfRow() {
    const container = document.getElementById('q-tf-container');
    const row = document.createElement('div');
    row.className = 'tf-row flex items-center gap-2 mb-2';
    row.innerHTML = `
        <input type="text" class="tf-statement flex-1 p-3 bg-slate-50 rounded-xl text-sm" placeholder="Pernyataan">
        <select class="tf-correct p-3 bg-slate-50 rounded-xl text-sm">
            <option value="">--Benar/Salah--</option>
            <option value="true">Benar</option>
            <option value="false">Salah</option>
        </select>
        <button type="button" onclick="this.parentElement.remove()" class="text-red-500 font-bold p-2">&times;</button>
    `;
    container.insertBefore(row, container.lastElementChild);
}

function addMatchingQRow() {
    const container = document.getElementById('q-matching-questions');
    const div = document.createElement('div');
    div.className = 'flex gap-2 mb-2';
    div.innerHTML = `<input type="text" class="matching-question flex-1 p-3 bg-slate-50 rounded-xl text-sm" placeholder="Pertanyaan"><button type="button" onclick="this.parentElement.remove()" class="text-red-500">&times;</button>`;
    container.appendChild(div);
}

function addMatchingARow() {
    const container = document.getElementById('q-matching-answers');
    const div = document.createElement('div');
    div.className = 'flex gap-2 mb-2';
    div.innerHTML = `<input type="text" class="matching-answer flex-1 p-3 bg-slate-50 rounded-xl text-sm" placeholder="Jawaban"><button type="button" onclick="this.parentElement.remove()" class="text-red-500">&times;</button>`;
    container.appendChild(div);
}

function closeModals() {
    document.querySelectorAll('.fixed.inset-0').forEach(m => {
        if (!m.id.includes('loading') && !m.id.includes('mask')) {
            m.classList.add('hidden');
            m.classList.remove('flex');
        }
    });
}

function viewDetailedResult(idx) {
    const result = db.results[idx];
    if (!result || result.deleted) {
        alert('Hasil ujian tidak ditemukan atau sudah dihapus.');
        return;
    }

    const questions = Array.isArray(result.questions) ? result.questions : [];
    const answers = Array.isArray(result.answers) ? result.answers : [];

    if (questions.length === 0) {
        alert('Data soal tidak tersedia untuk hasil ujian ini.');
        return;
    }

    while (answers.length < questions.length) {
        answers.push(null);
    }

    const escapeHtml = (text) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };

    let content = `<div>
        <h3 class="text-xl font-bold text-slate-800">Detail Jawaban - ${escapeHtml(result.studentName)}</h3>
        <p class="text-sm">Rombel: ${result.rombel} | Mapel: ${result.mapel} | Skor: ${result.score}</p>
    </div>`;

    questions.forEach((q, i) => {
        if (!q) return;
        const studentAnswer = answers[i];
        const correctAnswer = q.correct;
        const qType = q.type || 'single';

        content += `<div class="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
            <p class="font-bold text-slate-800">Soal ${i + 1}</p>
            <p class="text-slate-600 mb-2">${escapeHtml(q.text)}</p>`;

        if (qType === 'single' || qType === 'multiple') {
            (q.options || []).forEach((opt, optIdx) => {
                let isStudent = qType === 'single' ? (studentAnswer === optIdx) : (Array.isArray(studentAnswer) && studentAnswer.includes(optIdx));
                let isCorrect = qType === 'single' ? (correctAnswer === optIdx) : (Array.isArray(correctAnswer) && correctAnswer.includes(optIdx));
                
                let colorClass = 'text-slate-600';
                if (isCorrect && isStudent) colorClass = 'text-emerald-600 font-bold';
                else if (isCorrect) colorClass = 'text-emerald-400 font-bold';
                else if (isStudent) colorClass = 'text-red-500 font-bold';

                content += `<div class="${colorClass}">${String.fromCharCode(65+optIdx)}. ${escapeHtml(opt)}</div>`;
            });
        }
        content += '</div>';
    });

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm';
    modal.innerHTML = `
        <div class="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-8 relative">
            <button onclick="this.closest('.fixed').remove()" class="absolute top-4 right-4 text-slate-400 hover:text-slate-600 font-bold">CLOSE</button>
            ${content}
        </div>
    `;
    document.body.appendChild(modal);
}

function exportResultsToExcel() {
    const list = db.results.filter(r => !r.deleted);
    if (list.length === 0) return alert('Tidak ada data results.');
    const data = list.map(r => ({
        'Siswa': r.studentName, 'Rombel': r.rombel, 'Mapel': r.mapel, 'Skor': r.score, 'Tanggal': r.date ? new Date(r.date).toLocaleString() : '-'
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    XLSX.writeFile(wb, "Hasil_Ujian_CBT.xlsx");
}

function clearAllResults() {
    if (confirm('Hapus seluruh hasil ujian?')) {
        db.results = db.results.map(r => ({ ...r, deleted: true, updatedAt: Date.now() }));
        save();
        renderAdminResults();
        updateStats();
    }
}
function exportDatabase() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(db, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `BACKUP_CBT_DORKAS_${new Date().toISOString().split('T')[0]}.json`);
    dlAnchor.click();
    dlAnchor.remove();
}

async function importDatabase(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const parsed = JSON.parse(e.target.result);
            if (!parsed.students || !parsed.questions) throw new Error("File backup tidak valid");
            if (!confirm('Ganti seluruh database dengan file backup? Semua data saat ini akan terhapus.')) return;
            db = normalizeDb(parsed);
            await save();
            alert('Restore berhasil! Memuat ulang...');
            location.reload();
        } catch (err) { alert('Error: ' + err.message); }
    };
    reader.readAsText(file);
}

function updateBackupInfo() {
    const el = document.getElementById('backup-info-text');
    if (!el) return;
    const last = localStorage.getItem('last_restore_date');
    if (last) {
        el.innerText = `Terakhir direstore: ${new Date(last).toLocaleString('id-ID')}`;
    }
}

function updateAdminAccount() {
    const admin = db.students.find(x => x.role === 'admin');
    if (!admin) return alert('Administrator tidak ditemukan.');
    const oldPass = document.getElementById('set-admin-old-pass').value;
    const newId = document.getElementById('set-admin-id').value.trim();
    const newPass = document.getElementById('set-admin-new-pass').value;

    if (oldPass !== admin.password) return alert('Password saat ini salah.');
    if (newId) admin.id = newId;
    if (newPass) admin.password = newPass;
    save();
    alert('Perubahan tersimpan.');
}

function renderSubjectsLockManagement() {
    const container = document.getElementById('subjects-lock-container');
    if (!container) return;
    container.innerHTML = db.subjects.map((s, idx) => {
        const name = typeof s === 'string' ? s : s.name;
        const locked = s.locked;
        return `
            <div class="bg-white p-4 rounded-xl border border-slate-100 flex justify-between items-center mb-2">
                <span class="font-bold text-slate-700">${name}</span>
                <button onclick="toggleSubjectLock(${idx})" class="px-4 py-2 ${locked ? 'bg-emerald-600' : 'bg-red-600'} text-white rounded-lg text-xs font-bold">
                    ${locked ? 'BUKA AKSES' : 'KUNCI AKSES'}
                </button>
            </div>
        `;
    }).join('');
}

function toggleSubjectLock(idx) {
    db.subjects[idx].locked = !db.subjects[idx].locked;
    save(); renderSubjectsLockManagement();
}

function openScheduleModal() {
    const container = document.getElementById('schedule-checklist');
    if (!container) return;
    const schedules = db.schedules || [];
    container.innerHTML = db.rombels.flatMap(r => db.subjects.map(s => {
        const name = typeof s === 'string' ? s : s.name;
        const key = `${r}|${name}`;
        const checked = schedules.includes(key);
        return `<label class="flex items-center p-3 bg-slate-50 rounded-xl mb-2 cursor-pointer border-2 ${checked ? 'border-purple-500' : 'border-slate-100'}">
            <input type="checkbox" class="schedule-checkbox" data-key="${key}" ${checked ? 'checked' : ''}>
            <span class="ml-3 font-bold text-slate-700">${r} - ${name}</span>
        </label>`;
    })).join('');
    const m = document.getElementById('schedule-modal');
    if (m) { m.classList.remove('hidden'); m.classList.add('flex'); }
}

function saveSchedules() {
    const boxes = document.querySelectorAll('.schedule-checkbox:checked');
    db.schedules = Array.from(boxes).map(b => b.dataset.key);
    save(); closeModals(); alert('Jadwal tersimpan.');
}

function openTimeLimitModal() {
    const container = document.getElementById('time-limit-list');
    if (!container) return;
    const limits = db.timeLimits || {};
    container.innerHTML = db.rombels.flatMap(r => db.subjects.map(s => {
        const name = typeof s === 'string' ? s : s.name;
        const key = `${r}|${name}`.toLowerCase().trim();
        const cur = limits[key] || 60;
        return `<div class="flex justify-between items-center p-3 bg-slate-50 rounded-xl mb-2">
            <span class="font-bold text-slate-700">${r} - ${name}</span>
            <div class="flex items-center gap-2"><input type="number" class="time-limit-input w-16 p-2 rounded border" data-key="${key}" value="${cur}"> min</div>
        </div>`;
    })).join('');
    const m = document.getElementById('time-limit-modal');
    if (m) { m.classList.remove('hidden'); m.classList.add('flex'); }
}

function saveTimeLimits() {
    const inputs = document.querySelectorAll('.time-limit-input');
    db.timeLimits = {};
    inputs.forEach(i => { db.timeLimits[i.dataset.key] = parseInt(i.value) || 60; });
    save(); closeModals(); alert('Waktu pengerjaan tersimpan.');
}

function shuffleQuestions() {
    if (confirm("Acak urutan semua soal?")) {
        for (let i = db.questions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [db.questions[i], db.questions[j]] = [db.questions[j], db.questions[i]];
        }
        save(); renderAdminQuestions();
    }
}

function clearSearch() {
    document.getElementById('search-questions').value = '';
    renderAdminQuestions();
}

function clearFilters() {
    document.getElementById('search-questions').value = '';
    document.getElementById('filter-rombel').value = 'ALL';
    document.getElementById('filter-mapel').value = 'ALL';
    renderAdminQuestions();
}

// Image Zoom
let zoomIndex = 0;
let zoomImages = [];

function openImageZoom(images, idx = 0) {
    zoomImages = images;
    zoomIndex = idx;
    const modal = document.getElementById('image-zoom-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        updateZoomDisplay();
    }
}

function closeImageZoom() {
    document.getElementById('image-zoom-modal').classList.add('hidden');
}

function updateZoomDisplay() {
    const img = document.getElementById('zoom-image-display');
    const counter = document.getElementById('zoom-image-counter');
    if (img && zoomImages[zoomIndex]) {
        img.src = zoomImages[zoomIndex];
        counter.innerText = `${zoomIndex + 1} / ${zoomImages.length}`;
    }
}

function nextZoomImage() {
    zoomIndex = (zoomIndex + 1) % zoomImages.length;
    updateZoomDisplay();
}

function previousZoomImage() {
    zoomIndex = (zoomIndex - 1 + zoomImages.length) % zoomImages.length;
    updateZoomDisplay();
}

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    adminInit();
});
