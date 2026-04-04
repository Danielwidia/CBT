/**
 * student.js
 * Logic specifically for the Student Dashboard and Exam Interface
 */

let examData = {
    questions: [],
    answers: {},
    currentIndex: 0,
    startTime: null,
    timeLimit: 0,
    timerInterval: null,
    rombel: '',
    mapel: ''
};

let isExamActive = false;
let cheatingCount = 0;

function studentInit() {
    const user = JSON.parse(localStorage.getItem(USER_KEY));
    if (!user || user.role !== 'student') {
        window.location.href = 'index.html';
        return;
    }

    const label = document.getElementById('st-info-label');
    if (label) label.innerText = `${user.name} | ${user.rombel}`;

    renderStudentExamList();
    setupAntiCheat();
}

function setupAntiCheat() {
    document.addEventListener('visibilitychange', () => {
        if (isExamActive) {
            if (document.visibilityState === 'hidden') {
                document.getElementById('cheat-mask').classList.remove('hidden');
                document.getElementById('cheat-mask').classList.add('flex');
                handleCheating('Berpindah tab/aplikasi');
            } else {
                document.getElementById('cheat-mask').classList.add('hidden');
                document.getElementById('cheat-mask').classList.remove('flex');
            }
        }
    });

    window.addEventListener('blur', () => {
        if (isExamActive) handleCheating('Meninggalkan jendela ujian');
    });

    // Anti-Copy/Select/Screenshot
    ['contextmenu', 'copy', 'cut', 'paste', 'selectstart'].forEach(ev => {
        document.addEventListener(ev, e => isExamActive && e.preventDefault());
    });

    document.addEventListener('keydown', e => {
        if (isExamActive) {
            if (e.key === 'PrintScreen' || e.keyCode === 44) {
                e.preventDefault();
                handleCheating('Screenshot terdeteksi');
            }
            if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) e.preventDefault();
            if (e.key === 'F12') e.preventDefault();
        }
    });
}

function handleCheating(reason) {
    if (!isExamActive) return;
    cheatingCount++;
    console.warn(`Anti-Cheat Triggered: ${reason} (Attempt: ${cheatingCount})`);

    if (cheatingCount >= 3) {
        isExamActive = false;
        alert('UJIAN DIBERHENTIKAN! Terdeteksi kecurangan berulang kali. Jawaban Anda telah dikirim.');
        submitExam();
    } else {
        const modal = document.getElementById('cheat-warning-modal');
        const text = document.getElementById('cheat-warning-text');
        if (modal) {
            if (text) text.innerText = `${reason}. Peringatan ${cheatingCount}/3. Jika mencapai 3, ujian akan otomatis diberhentikan!`;
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }
    }
}

function closeCheatWarning() {
    const modal = document.getElementById('cheat-warning-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

function renderStudentExamList() {
    const user = JSON.parse(localStorage.getItem(USER_KEY));
    const container = document.getElementById('student-exam-list');
    if (!container) return;

    const schedules = db.schedules || [];
    const available = schedules.filter(s => s.startsWith(user.rombel + '|')).map(s => s.split('|')[1]);

    const alreadyDone = db.results.filter(r => r.studentId === user.id && !r.deleted).map(r => r.mapel);

    container.innerHTML = available.map(mapel => {
        const isDone = alreadyDone.includes(mapel);
        const mapelObj = db.subjects.find(s => (typeof s === 'string' ? s : s.name) === mapel);
        const isLocked = mapelObj && mapelObj.locked;
        
        return `
            <div class="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm transition-all hover:shadow-md ${isDone ? 'opacity-60 bg-emerald-50' : ''}">
                <div class="flex justify-between items-start mb-4">
                    <div class="w-12 h-12 bg-sky-100 text-sky-600 rounded-2xl flex items-center justify-center font-black text-xl">${mapel.charAt(0)}</div>
                    ${isDone ? '<span class="text-[10px] font-black text-emerald-600 bg-white px-2 py-1 rounded-full border border-emerald-100 uppercase italic">Selesai</span>' : ''}
                </div>
                <h3 class="text-xl font-black text-slate-800 mb-1">${mapel}</h3>
                <p class="text-slate-400 text-xs mb-6">Ujian Tengah Semester Ganjil</p>
                ${isDone ? 
                    `<button disabled class="w-full py-3 bg-emerald-500 text-white rounded-xl font-black text-xs opacity-50 cursor-not-allowed">SUDAH DIKERJAKAN</button>` :
                    (isLocked ? 
                        `<button disabled class="w-full py-3 bg-slate-200 text-slate-400 rounded-xl font-black text-xs cursor-not-allowed"><i class="fas fa-lock mr-2"></i>AKSES DIKUNCI</button>` :
                        `<button onclick="startExam('${mapel}', '${user.rombel}')" class="w-full py-3 bg-sky-600 text-white rounded-xl font-black text-xs hover:bg-sky-700 transition-all shadow-lg shadow-sky-100 uppercase tracking-widest">Mulai Ujian</button>`
                    )
                }
            </div>
        `;
    }).join('');

    if (available.length === 0) {
        container.innerHTML = `<div class="col-span-full py-20 text-center text-slate-400 font-bold italic">Belum ada jadwal ujian tersedia untuk kelas Anda.</div>`;
    }
}

function startExam(mapel, rombel) {
    const user = JSON.parse(localStorage.getItem(USER_KEY));
    const questions = db.questions.filter(q => q.mapel === mapel && q.rombel === rombel);
    
    if (questions.length === 0) return alert('Soal belum tersedia untuk mapel ini!');

    if (!confirm(`Mulai ujian ${mapel}?`)) return;

    isExamActive = true;
    examData = {
        questions: shuffleArray([...questions]),
        answers: {},
        currentIndex: 0,
        startTime: Date.now(),
        timeLimit: (db.timeLimits && db.timeLimits[`${rombel}|${mapel}`.toLowerCase()]) || 60,
        rombel,
        mapel
    };

    document.getElementById('student-exam-list-container').classList.add('hidden');
    document.getElementById('exam-interface').classList.remove('hidden');
    document.getElementById('exam-timer-container').classList.remove('hidden');
    document.getElementById('exam-timer-container').classList.add('flex');
    
    startTimer();
    renderQuestion();
    showStudentInstructionModal();
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function startTimer() {
    const timerEl = document.getElementById('exam-timer');
    const totalMs = examData.timeLimit * 60 * 1000;
    
    if (examData.timerInterval) clearInterval(examData.timerInterval);

    examData.timerInterval = setInterval(() => {
        const elapsed = Date.now() - examData.startTime;
        const remaining = totalMs - elapsed;

        if (remaining <= 0) {
            clearInterval(examData.timerInterval);
            alert('Waktu habis! Jawaban Anda akan dikirim otomatis.');
            submitExam();
            return;
        }

        const h = Math.floor(remaining / 3600000);
        const m = Math.floor((remaining % 3600000) / 60000);
        const s = Math.floor((remaining % 60000) / 1000);
        timerEl.innerText = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        
        if (remaining < 300000) timerEl.parentElement.classList.add('animate-pulse', 'border-red-500', 'bg-red-50');
    }, 1000);
}

function renderQuestion() {
    const q = examData.questions[examData.currentIndex];
    const qNum = examData.currentIndex + 1;
    document.getElementById('current-q-num').innerText = qNum;
    
    const label = { single: 'PILIHAN GANDA', multiple: 'PG KOMPLEKS', tf: 'BENAR/SALAH', text: 'URAIAN', matching: 'MENJODOHKAN' }[q.type || 'single'];
    document.getElementById('q-type-label').innerText = label;

    const content = document.getElementById('question-content');
    content.innerHTML = `<p class="whitespace-pre-wrap">${q.text}</p>`;
    
    if (q.images && q.images.length > 0) {
        const imgCont = document.createElement('div');
        imgCont.className = 'grid grid-cols-1 md:grid-cols-2 gap-4 mt-6';
        q.images.forEach((img, idx) => {
            imgCont.innerHTML += `<img src="${typeof img === 'string' ? img : img.data}" class="rounded-2xl border border-slate-100 cursor-zoom-in" onclick="openImageZoom(examData.questions[examData.currentIndex].images, ${idx})">`;
        });
        content.appendChild(imgCont);
    }

    const optsCont = document.getElementById('options-container');
    optsCont.innerHTML = '';

    const currentAns = examData.answers[examData.currentIndex];

    if (q.type === 'text') {
        const area = document.createElement('textarea');
        area.className = 'w-full p-6 bg-slate-50 rounded-2xl border-2 border-slate-100 focus:border-sky-500 outline-none font-medium h-40';
        area.placeholder = 'Ketik jawaban Anda di sini...';
        area.oninput = (e) => examData.answers[examData.currentIndex] = e.target.value;
        area.value = currentAns || '';
        optsCont.appendChild(area);
    } else if (q.type === 'tf') {
        (q.options || []).forEach((stmt, idx) => {
            const div = document.createElement('div');
            div.className = 'p-4 bg-slate-50 rounded-2xl border-2 border-slate-100 mb-4';
            div.innerHTML = `
                <p class="text-sm font-bold text-slate-700 mb-3">${stmt}</p>
                <div class="flex gap-2">
                    <button onclick="setTfAns(${idx}, true)" class="tf-btn-${idx}-true flex-1 py-3 rounded-xl border-2 font-bold text-xs">BENAR</button>
                    <button onclick="setTfAns(${idx}, false)" class="tf-btn-${idx}-false flex-1 py-3 rounded-xl border-2 font-bold text-xs">SALAH</button>
                </div>
            `;
            optsCont.appendChild(div);
            updateTfUI(idx);
        });
    } else if (q.type === 'matching') {
        (q.questions || []).forEach((mq, idx) => {
            const div = document.createElement('div');
            div.className = 'flex flex-col sm:flex-row gap-3 items-center mb-4';
            div.innerHTML = `
                <div class="flex-1 p-4 bg-slate-100 rounded-xl text-sm font-bold text-slate-600 w-full">${mq}</div>
                <i class="fas fa-link text-slate-300 hidden sm:block"></i>
                <select onchange="setMatchAns(${idx}, this.value)" class="flex-1 p-4 bg-white border-2 border-slate-100 rounded-xl text-sm font-bold outline-none focus:border-sky-500 w-full">
                    <option value="">Pilih Pasangan...</option>
                    ${(q.answers || []).map(a => `<option value="${a}" ${currentAns && currentAns[idx] === a ? 'selected' : ''}>${a}</option>`).join('')}
                </select>
            `;
            optsCont.appendChild(div);
        });
    } else {
        // Pilihan Ganda (Single/Multiple)
        (q.options || []).forEach((opt, idx) => {
            const btn = document.createElement('button');
            const isSel = q.type === 'multiple' ? (Array.isArray(currentAns) && currentAns.includes(idx)) : (currentAns === idx);
            btn.className = `w-full p-4 md:p-5 rounded-2xl border-2 text-left transition-all flex gap-4 items-center group
                ${isSel ? 'bg-sky-50 border-sky-600 shadow-lg shadow-sky-100' : 'bg-white border-slate-100 hover:border-sky-300'}`;
            btn.onclick = () => setOptionAns(idx);
            btn.innerHTML = `
                <span class="w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm
                    ${isSel ? 'bg-sky-600 text-white' : 'bg-slate-50 text-slate-400 group-hover:bg-sky-100 group-hover:text-sky-600'}">
                    ${['A', 'B', 'C', 'D'][idx]}
                </span>
                <span class="${isSel ? 'text-sky-900 font-bold' : 'text-slate-600 font-medium'}">${opt}</span>
            `;
            optsCont.appendChild(btn);
        });
    }

    renderNav();
}

function setOptionAns(idx) {
    const q = examData.questions[examData.currentIndex];
    if (q.type === 'multiple') {
        if (!Array.isArray(examData.answers[examData.currentIndex])) examData.answers[examData.currentIndex] = [];
        const pos = examData.answers[examData.currentIndex].indexOf(idx);
        if (pos === -1) examData.answers[examData.currentIndex].push(idx);
        else examData.answers[examData.currentIndex].splice(pos, 1);
    } else {
        examData.answers[examData.currentIndex] = idx;
    }
    renderQuestion();
}

function setTfAns(row, val) {
    if (!Array.isArray(examData.answers[examData.currentIndex])) {
        const q = examData.questions[examData.currentIndex];
        examData.answers[examData.currentIndex] = new Array((q.options || []).length).fill(null);
    }
    examData.answers[examData.currentIndex][row] = val;
    updateTfUI(row);
}

function updateTfUI(row) {
    const val = examData.answers[examData.currentIndex] ? examData.answers[examData.currentIndex][row] : null;
    ['true', 'false'].forEach(v => {
        const btn = document.querySelector(`.tf-btn-${row}-${v}`);
        if (!btn) return;
        const active = (v === 'true' && val === true) || (v === 'false' && val === false);
        btn.className = `tf-btn-${row}-${v} flex-1 py-3 rounded-xl border-2 font-bold text-xs transition-all ` + 
            (active ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-400 border-slate-100');
    });
}

function setMatchAns(row, val) {
    if (!Array.isArray(examData.answers[examData.currentIndex])) {
        const q = examData.questions[examData.currentIndex];
        examData.answers[examData.currentIndex] = new Array((q.questions || []).length).fill(null);
    }
    examData.answers[examData.currentIndex][row] = val;
}

function nextQuestion() {
    if (examData.currentIndex < examData.questions.length - 1) {
        examData.currentIndex++;
        renderQuestion();
    }
}

function prevQuestion() {
    if (examData.currentIndex > 0) {
        examData.currentIndex--;
        renderQuestion();
    }
}

function renderNav() {
    const grid = document.getElementById('q-nav-grid');
    if (!grid) return;
    grid.innerHTML = examData.questions.map((_, i) => {
        const isCur = i === examData.currentIndex;
        const isDone = examData.answers[i] !== undefined && examData.answers[i] !== null && 
                       (Array.isArray(examData.answers[i]) ? examData.answers[i].some(v => v !== null) : examData.answers[i] !== '');
        return `<button onclick="goToQ(${i})" class="w-full h-10 rounded-lg text-xs font-black transition-all
            ${isCur ? 'ring-2 ring-sky-600 ring-offset-2' : ''}
            ${isDone ? 'bg-sky-600 text-white shadow-lg shadow-sky-100' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}">
            ${i + 1}
        </button>`;
    }).join('');
}

function goToQ(i) {
    examData.currentIndex = i;
    renderQuestion();
}

function confirmSubmit() {
    const total = examData.questions.length;
    const answered = Object.keys(examData.answers).filter(k => examData.answers[k] !== undefined && examData.answers[k] !== null).length;
    if (answered < total) {
        if (!confirm(`Terdapat ${total - answered} soal belum dijawab. Yakin ingin mengakhiri?`)) return;
    } else {
        if (!confirm('Yakin ingin menyelesaikan ujian?')) return;
    }
    submitExam();
}

async function submitExam() {
    isExamActive = false;
    clearInterval(examData.timerInterval);

    // Show Progress Modal with countdown (staggered queue)
    const modal = document.getElementById('submitting-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    let waitSec = 3 + Math.floor(Math.random() * 8); // 3 - 10 sec
    const timerText = document.getElementById('submitting-timer');
    
    for (let i = waitSec; i >= 0; i--) {
        timerText.innerText = `SIAP DALAM ${i} DETIK`;
        await new Promise(r => setTimeout(r, 1000));
    }

    // Calculate score
    let score = 0;
    examData.questions.forEach((q, i) => {
        const ans = examData.answers[i];
        if (q.type === 'multiple') {
            if (Array.isArray(ans) && Array.isArray(q.correct)) {
                if (ans.length === q.correct.length && ans.every(v => q.correct.includes(v))) score++;
            }
        } else if (q.type === 'text') {
            // Very basic exact match for text; usually teachers grade this later
            if (ans && q.correct && ans.trim().toLowerCase() === q.correct.trim().toLowerCase()) score++;
        } else if (q.type === 'tf') {
            if (Array.isArray(ans) && Array.isArray(q.correct)) {
                if (ans.every((v, idx) => v === q.correct[idx])) score++;
            }
        } else if (q.type === 'matching') {
            if (Array.isArray(ans) && Array.isArray(q.correct)) {
                if (ans.every((v, idx) => v === q.correct[idx])) score++;
            }
        } else {
            if (ans === q.correct) score++;
        }
    });

    const finalScore = (score / examData.questions.length) * 100;
    const user = JSON.parse(localStorage.getItem(USER_KEY));

    const result = {
        studentId: user.id,
        studentName: user.name,
        rombel: examData.rombel,
        mapel: examData.mapel,
        score: finalScore,
        date: new Date().toISOString(),
        questions: examData.questions,
        answers: examData.questions.map((_, i) => examData.answers[i] || null)
    };

    try {
        db.results.push(result);
        await save();
        alert(`Ujian selesai! Skor Anda: ${finalScore.toFixed(1)}`);
    } catch (e) {
        alert('Gagal mengirim ke server. Data tersimpan lokal, hubungi admin.');
    }

    location.reload();
}

function showStudentInstructionModal() {
    const modal = document.getElementById('student-instruction-modal');
    if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
}

function closeStudentInstructionModal() {
    const modal = document.getElementById('student-instruction-modal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
}

function logout() {
    if (isExamActive) {
        if (!confirm('Anda sedang ujian! Jika keluar sekarang, ujian akan otomatis dikirim. Lanjutkan?')) return;
        submitExam();
    } else {
        localStorage.removeItem(USER_KEY);
        window.location.href = 'index.html';
    }
}

// Image Zoom for Student
function openImageZoom(images, idx = 0) {
    const modal = document.getElementById('image-zoom-modal');
    const display = document.getElementById('zoom-image-display');
    if (modal && display && images[idx]) {
        display.src = typeof images[idx] === 'string' ? images[idx] : images[idx].data;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

function closeImageZoom() {
    document.getElementById('image-zoom-modal').classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', studentInit);
