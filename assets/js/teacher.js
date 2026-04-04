/**
 * teacher.js
 * Logic specifically for the Teacher Dashboard
 */

let editQuestionIndex = null;
let currentQType = 'single';
let activeCorrect = 0;
let activeCorrectMultiple = [];

function teacherInit() {
    const user = JSON.parse(localStorage.getItem(USER_KEY));
    if (!user || user.role !== 'teacher') {
        window.location.href = 'index.html';
        return;
    }

    const label = document.getElementById('teacher-info-label');
    if (label) label.innerText = user.name;

    populateTeacherSelects();
    renderTeacherQuestions();
}

function populateTeacherSelects() {
    const user = JSON.parse(localStorage.getItem(USER_KEY));
    const mSelect = document.getElementById('teacher-filter-mapel');
    const rSelect = document.getElementById('teacher-filter-rombel');
    const qMSelect = document.getElementById('q-mapel');
    const qRSelect = document.getElementById('q-rombel');
    const resMSelect = document.getElementById('teacher-results-filter-mapel');
    const resRSelect = document.getElementById('teacher-results-filter-rombel');

    const subjects = user.subjects || [];
    const mapels = subjects.map(s => s.name);
    const rombels = [...new Set(subjects.flatMap(s => s.rombels))];

    const fill = (el, list, all = false) => {
        if (!el) return;
        let html = all ? '<option value="">Semua</option>' : '';
        html += list.map(item => `<option value="${item}">${item}</option>`).join('');
        el.innerHTML = html;
    };

    fill(mSelect, mapels, true);
    fill(rSelect, rombels, true);
    fill(qMSelect, mapels);
    fill(qRSelect, rombels);
    fill(resMSelect, mapels, true);
    fill(resRSelect, rombels, true);
}

function switchTeacherTab(tab) {
    document.querySelectorAll('.teacher-tab-content').forEach(c => c.classList.add('hidden'));
    document.getElementById('teacher-tab-' + tab).classList.remove('hidden');

    document.getElementById('tab-bank-soal').className = (tab === 'bank-soal') ? 'px-6 py-3 font-bold text-amber-600 border-b-2 border-amber-600 transition-all' : 'px-6 py-3 font-bold text-slate-400 border-b-2 border-transparent hover:text-slate-700 transition-all';
    document.getElementById('tab-hasil-ujian').className = (tab === 'hasil-ujian') ? 'px-6 py-3 font-bold text-amber-600 border-b-2 border-amber-600 transition-all' : 'px-6 py-3 font-bold text-slate-400 border-b-2 border-transparent hover:text-slate-700 transition-all';

    if (tab === 'bank-soal') renderTeacherQuestions();
    if (tab === 'hasil-ujian') renderTeacherResults();
}

function renderTeacherQuestions() {
    const user = JSON.parse(localStorage.getItem(USER_KEY));
    const fM = document.getElementById('teacher-filter-mapel').value;
    const fR = document.getElementById('teacher-filter-rombel').value;
    const search = document.getElementById('teacher-search-questions').value.toLowerCase();
    const tbody = document.getElementById('teacher-questions-table-body');
    if (!tbody) return;

    const teacherMapels = (user.subjects || []).map(s => s.name);
    let filtered = db.questions.filter(q => teacherMapels.includes(q.mapel));

    if (fM) filtered = filtered.filter(q => q.mapel === fM);
    if (fR) filtered = filtered.filter(q => q.rombel === fR);
    if (search) filtered = filtered.filter(q => q.text.toLowerCase().includes(search));

    tbody.innerHTML = filtered.map(q => {
        const idx = db.questions.indexOf(q);
        return `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="px-6 py-4">
                    <p class="font-medium text-slate-800 line-clamp-2">${q.text}</p>
                    <div class="flex gap-2 mt-1">
                        <span class="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded uppercase">${q.mapel}</span>
                        <span class="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded uppercase">${q.type || 'single'}</span>
                    </div>
                </td>
                <td class="px-6 py-4 text-xs font-bold text-slate-500">${q.rombel}</td>
                <td class="px-6 py-4 text-center">
                    <button onclick="openEditQuestionModal(${idx})" class="p-2 text-sky-400 hover:text-sky-600"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteQuestion(${idx})" class="p-2 text-red-400 hover:text-red-600"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderTeacherResults() {
    const user = JSON.parse(localStorage.getItem(USER_KEY));
    const fM = document.getElementById('teacher-results-filter-mapel').value;
    const fR = document.getElementById('teacher-results-filter-rombel').value;
    const tbody = document.getElementById('teacher-results-table-body');
    if (!tbody) return;

    const teacherMapels = (user.subjects || []).map(s => s.name);
    let list = db.results.filter(r => !r.deleted && teacherMapels.includes(r.mapel));

    if (fM) list = list.filter(r => r.mapel === fM);
    if (fR) list = list.filter(r => r.rombel === fR);

    tbody.innerHTML = list.map(r => `
        <tr>
            <td class="px-6 py-4 font-bold text-slate-700">${r.studentName}</td>
            <td class="px-6 py-4 text-xs font-semibold text-slate-500">${r.rombel}</td>
            <td class="px-6 py-4 text-xs font-bold text-amber-600 uppercase tracking-tighter">${r.mapel}</td>
            <td class="px-6 py-4 text-center font-black text-amber-600 text-lg">${Number(r.score).toFixed(1)}</td>
            <td class="px-6 py-4 text-center">
                <button onclick="viewDetailedResult(${db.results.indexOf(r)})" class="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 transition-all flex items-center justify-center mx-auto"><i class="fas fa-eye"></i></button>
            </td>
        </tr>
    `).join('');
}

// Reuse modal functions from admin.js logic (but rewritten or shared)
// For simplicity in this modular migration, we can copy the essential ones or import from a shared UI helper.
// I'll add the essential question modal functions here as well.

function onQuestionTypeChange() {
    const type = document.getElementById('q-type').value;
    currentQType = type;
    const opts = document.getElementById('q-opsi-group');
    const textAns = document.getElementById('q-answer-text-container');
    const tf = document.getElementById('q-tf-container');
    const match = document.getElementById('q-matching-container');

    [opts, textAns, tf, match].forEach(el => el.classList.add('hidden'));

    if (type === 'text') textAns.classList.remove('hidden');
    else if (type === 'tf') tf.classList.remove('hidden');
    else if (type === 'matching') match.classList.remove('hidden');
    else opts.classList.remove('hidden');
}

function openQuestionModal() {
    editQuestionIndex = null;
    document.getElementById('q-text').value = '';
    document.querySelectorAll('.q-opt').forEach(o => o.value = '');
    document.getElementById('question-modal-title').innerText = 'Tambah Soal Baru';
    document.getElementById('question-modal').classList.remove('hidden');
    document.getElementById('question-modal').classList.add('flex');
}

function openEditQuestionModal(idx) {
    editQuestionIndex = idx;
    const q = db.questions[idx];
    document.getElementById('q-text').value = q.text;
    document.getElementById('q-type').value = q.type || 'single';
    document.getElementById('q-mapel').value = q.mapel;
    document.getElementById('q-rombel').value = q.rombel;
    onQuestionTypeChange();
    
    if (q.options) {
        const oInputs = document.querySelectorAll('.q-opt');
        q.options.forEach((opt, i) => { if(oInputs[i]) oInputs[i].value = opt; });
    }
    
    document.getElementById('question-modal-title').innerText = 'Edit Soal';
    document.getElementById('question-modal').classList.remove('hidden');
    document.getElementById('question-modal').classList.add('flex');
}

function saveQuestion() {
    const text = document.getElementById('q-text').value;
    const mapel = document.getElementById('q-mapel').value;
    const rombel = document.getElementById('q-rombel').value;
    const type = document.getElementById('q-type').value;
    const options = Array.from(document.querySelectorAll('.q-opt')).map(o => o.value);

    const record = { text, mapel, rombel, type, options, correct: activeCorrect };
    if (editQuestionIndex !== null) db.questions[editQuestionIndex] = record;
    else db.questions.push(record);

    save(); renderTeacherQuestions(); closeModals();
}

function deleteQuestion(idx) {
    if (confirm('Hapus soal ini?')) {
        db.questions.splice(idx, 1);
        save(); renderTeacherQuestions();
    }
}

function logout() {
    localStorage.removeItem(USER_KEY);
    window.location.href = 'index.html';
}

function closeModals() {
    document.getElementById('question-modal').classList.add('hidden');
    document.getElementById('question-modal').classList.remove('flex');
}

document.addEventListener('DOMContentLoaded', teacherInit);
