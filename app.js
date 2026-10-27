// ─── CONFIG ──────────────────────────────────────────────────────────────────
const GEMINI_MODEL = 'gemini-3.8-flash';
const GEMINI_API   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const INIT_API_KEY = 'AIzaSyA0IUKjkeHB8QMIEkAl6n8792Mh7iUKF9M'; // Pre-configured key

// ─── STATE ───────────────────────────────────────────────────────────────────
const state = {
    page: 'home',
    questions: [],
    session: { queue: [], idx: 0, results: [] },
    editId: null,
    recording: false,
    finalTranscript: '',
    interimTranscript: '',
    recognition: null,
    stats: { sessions: 0, scores: [] }
};

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Pre-load the provided API key if none exists
    if (!localStorage.getItem('vp_api_key')) {
        localStorage.setItem('vp_api_key', INIT_API_KEY);
    }

    loadFromStorage();
    setupSpeech();
    setupModalBackdrop();
    navigate('home');

    // Check speech support
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        document.getElementById('browser-warn').classList.remove('hidden');
    }
});

// ─── STORAGE ──────────────────────────────────────────────────────────────────
function loadFromStorage() {
    try {
        const q = localStorage.getItem('vp_questions');
        const s = localStorage.getItem('vp_stats');
        if (q) state.questions = JSON.parse(q);
        if (s) state.stats     = JSON.parse(s);
    } catch(e) { console.warn('Storage read error:', e); }
}
function saveQuestions() { localStorage.setItem('vp_questions', JSON.stringify(state.questions)); }
function saveStats()     { localStorage.setItem('vp_stats',     JSON.stringify(state.stats)); }

// ─── ROUTER ───────────────────────────────────────────────────────────────────
function navigate(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    const el = document.getElementById(`page-${page}`);
    if (el) el.classList.remove('hidden');

    document.querySelectorAll('.nav-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.page === page);
    });

    state.page = page;
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Page-specific actions
    if (page === 'home')      updateStats();
    if (page === 'questions') renderQuestions();
    if (page === 'settings')  initSettings();
}

// ─── HOME / STATS ─────────────────────────────────────────────────────────────
function updateStats() {
    document.getElementById('stat-questions').textContent = state.questions.length;
    document.getElementById('stat-sessions').textContent  = state.stats.sessions;

    if (state.stats.scores.length > 0) {
        const avg = Math.round(state.stats.scores.reduce((a,b) => a+b, 0) / state.stats.scores.length);
        document.getElementById('stat-avg').textContent = `${avg}%`;
    } else {
        document.getElementById('stat-avg').textContent = '—';
    }
}

// ─── INTERVIEW FLOW ───────────────────────────────────────────────────────────
function startInterview() {
    if (state.questions.length === 0) {
        showToast('Add some questions first!', 'error');
        navigate('questions');
        return;
    }
    if (!localStorage.getItem('vp_api_key')) {
        showToast('Please add your Gemini API key in Settings', 'error');
        navigate('settings');
        return;
    }

    // Shuffle the questions
    const shuffled = [...state.questions].sort(() => Math.random() - 0.5);
    state.session = { queue: shuffled, idx: 0, results: [] };
    navigate('interview');
    loadQuestion();
}

function loadQuestion() {
    const { queue, idx } = state.session;
    const q     = queue[idx];
    const total = queue.length;

    // Progress bar
    document.getElementById('q-curr').textContent = idx + 1;
    document.getElementById('q-tot').textContent  = total;
    const pct = Math.round((idx / total) * 100);
    document.getElementById('progress-pct').textContent   = `${pct}%`;
    document.getElementById('progress-fill').style.width  = `${pct}%`;

    // Question text
    document.getElementById('curr-q-text').textContent = q.question;

    // Reset UI state
    resetRecordingUI();
    showSection('rec-section');
    hideSection('eval-section');
}

function showSection(id) { document.getElementById(id).classList.remove('hidden'); }
function hideSection(id) { document.getElementById(id).classList.add('hidden'); }

// ─── SPEECH RECOGNITION ───────────────────────────────────────────────────────
function setupSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    state.recognition = new SR();
    state.recognition.continuous     = true;
    state.recognition.interimResults = true;
    state.recognition.lang           = 'en-US';

    state.recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const t = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                state.finalTranscript += t + ' ';
            } else {
                interim += t;
            }
        }
        state.interimTranscript = interim;
        renderTranscript();
    };

    state.recognition.onerror = (ev) => {
        console.error('Speech error:', ev.error);
        if (ev.error === 'not-allowed') {
            showToast('Microphone permission denied — please allow and retry', 'error');
        } else if (ev.error !== 'no-speech') {
            showToast(`Speech error: ${ev.error}`, 'error');
        }
        stopRecording();
    };

    state.recognition.onend = () => {
        // Auto-restart if still in recording mode (browser kills after silence)
        if (state.recording) {
            try { state.recognition.start(); } catch(e) { /* already starting */ }
        }
    };
}

function toggleRecording() {
    state.recording ? stopRecording() : startRecording();
}

function startRecording() {
    if (!state.recognition) {
        showToast('Speech recognition not supported. Use Chrome or Edge.', 'error');
        return;
    }
    state.recording = true;

    try { state.recognition.start(); } catch(e) { /* already started */ }

    document.getElementById('mic-btn').classList.add('recording');
    document.getElementById('r1').classList.add('active');
    document.getElementById('r2').classList.add('active');
    document.getElementById('r3').classList.add('active');
    document.getElementById('mic-status').textContent = 'Recording... Click to stop';
    document.getElementById('mic-hint').textContent   = 'Speak clearly and at a natural pace';
    document.getElementById('mic-icon').innerHTML = `
        <rect x="9" y="9" width="6" height="6" rx="1"/>
        <path d="M12 3a9 9 0 0 1 9 9 9 9 0 0 1-9 9A9 9 0 0 1 3 12a9 9 0 0 1 9-9z" fill="none" stroke="currentColor" stroke-width="2"/>
    `;
}

function stopRecording() {
    state.recording = false;
    if (state.recognition) { try { state.recognition.stop(); } catch(e) { } }

    document.getElementById('mic-btn').classList.remove('recording');
    document.getElementById('r1').classList.remove('active');
    document.getElementById('r2').classList.remove('active');
    document.getElementById('r3').classList.remove('active');
    document.getElementById('mic-status').textContent = 'Recording stopped. Click to re-record.';
    document.getElementById('mic-hint').textContent   = 'Review your answer below before submitting';
    document.getElementById('mic-icon').innerHTML = `
        <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
    `;

    const hasText = getFullTranscript().trim().length > 0;
    document.getElementById('submit-btn').disabled = !hasText;
}

function getFullTranscript() {
    return (state.finalTranscript + state.interimTranscript).trim();
}

function renderTranscript() {
    const full = getFullTranscript();
    const body = document.getElementById('transcript-body');

    if (full) {
        body.innerHTML = `<span class="transcript-text">${escapeHtml(full)}</span>`;
    } else {
        body.innerHTML = `<span class="transcript-placeholder">Your spoken words will appear here in real time...</span>`;
    }

    // Enable submit only when not recording (but has text)
    if (!state.recording) {
        document.getElementById('submit-btn').disabled = full.length === 0;
    }
}

function clearTranscript() {
    state.finalTranscript   = '';
    state.interimTranscript = '';
    renderTranscript();
    document.getElementById('submit-btn').disabled = true;
    if (state.recording) {
        document.getElementById('mic-status').textContent = 'Recording... Click to stop';
    }
}

function resetRecordingUI() {
    if (state.recording) stopRecording();
    state.finalTranscript   = '';
    state.interimTranscript = '';
    renderTranscript();
    document.getElementById('submit-btn').disabled = true;
    document.getElementById('mic-status').textContent = 'Click to start recording';
    document.getElementById('mic-hint').textContent   = 'Chrome & Edge recommended for best results';
}

// ─── SUBMIT ANSWER ────────────────────────────────────────────────────────────
async function submitAnswer() {
    const userAnswer = getFullTranscript();
    if (!userAnswer) { showToast('Please record an answer first', 'error'); return; }

    if (state.recording) stopRecording();

    // Show evaluation loader
    hideSection('rec-section');
    showSection('eval-section');
    showSection('eval-loading');
    hideSection('eval-result');

    const q = state.session.queue[state.session.idx];

    try {
        const ev = await evaluateWithGemini(q.question, q.modelAnswer, userAnswer);
        state.session.results.push({ question: q.question, modelAnswer: q.modelAnswer, userAnswer, evaluation: ev });
        renderEvaluation(ev);
    } catch(err) {
        console.error('Evaluation error:', err);
        showToast('Error: ' + err.message, 'error');
        // Let user retry
        hideSection('eval-section');
        showSection('rec-section');
    }
}

// ─── GEMINI API ───────────────────────────────────────────────────────────────
async function evaluateWithGemini(question, modelAnswer, userAnswer) {
    const apiKey = localStorage.getItem('vp_api_key');
    if (!apiKey) throw new Error('No API key configured. Go to Settings.');

    const prompt = `You are an expert interview coach evaluating a candidate's spoken response.

Question asked: "${question}"

Model answer (key concepts that a good answer should cover): "${modelAnswer}"

Candidate's answer (transcribed from speech): "${userAnswer}"

Evaluate whether the candidate covered the key concepts. Focus on semantic meaning, not exact wording. A paraphrase of the model answer is still correct.

Respond ONLY with a valid JSON object — no markdown fences, no extra text — in this exact format:
{
  "verdict": "correct",
  "score": 82,
  "feedback": "Two to three sentences of overall feedback about the candidate's answer.",
  "what_was_good": "Specific things the candidate said well.",
  "what_was_missing": "Key concepts that were missing or unclear."
}

Rules:
- "verdict" must be exactly one of: "correct", "partial", or "incorrect"
- "score" must be an integer 0–100
- If the answer is fully correct, set "what_was_missing" to "Nothing — great answer!"
- If nothing was good, set "what_was_good" to "Nothing notable"`;

    const resp = await fetch(`${GEMINI_API}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.25, maxOutputTokens: 600 }
        })
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error?.message || `Gemini API error ${resp.status}`);
    }

    const data = await resp.json();
    const raw  = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Extract JSON block robustly
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Could not parse Gemini response. Please try again.');

    return JSON.parse(match[0]);
}

// ─── RENDER EVALUATION ────────────────────────────────────────────────────────
function renderEvaluation(ev) {
    hideSection('eval-loading');
    showSection('eval-result');

    const STYLES = {
        correct:   { bg: 'var(--success-bg)', border: 'rgba(16,185,129,0.4)',  text: '✅ Correct',           color: 'var(--success)' },
        partial:   { bg: 'var(--warning-bg)', border: 'rgba(245,158,11,0.4)',  text: '⚠️ Partially Correct', color: 'var(--warning)' },
        incorrect: { bg: 'var(--error-bg)',   border: 'rgba(239,68,68,0.4)',   text: '❌ Incorrect',          color: 'var(--error)' }
    };
    const s = STYLES[ev.verdict] || STYLES.partial;

    // Verdict badge
    const badge = document.getElementById('verdict-badge');
    badge.textContent         = s.text;
    badge.style.background    = s.bg;
    badge.style.borderColor   = s.border;
    badge.style.color         = s.color;

    // Score number
    const scoreEl = document.getElementById('score-num');
    scoreEl.textContent = ev.score;
    const scoreColor = ev.score >= 70 ? 'var(--success)' : ev.score >= 40 ? 'var(--warning)' : 'var(--error)';
    scoreEl.style.color = scoreColor;

    // Score bar — animate after a tick
    const fill = document.getElementById('score-bar-fill');
    fill.style.width      = '0%';
    fill.style.background = scoreColor;
    setTimeout(() => { fill.style.width = `${Math.min(ev.score, 100)}%`; }, 80);

    // Feedback & details
    document.getElementById('eval-feedback-text').textContent = ev.feedback || '';
    document.getElementById('detail-good-text').textContent   = ev.what_was_good    || 'Nothing notable';
    document.getElementById('detail-missing-text').textContent = ev.what_was_missing || 'Nothing';

    // Next button label
    const isLast = state.session.idx >= state.session.queue.length - 1;
    document.getElementById('next-btn').textContent = isLast ? '🏁 View Results' : 'Next Question →';
}

// ─── NEXT QUESTION ────────────────────────────────────────────────────────────
function nextQuestion() {
    state.session.idx++;
    if (state.session.idx >= state.session.queue.length) {
        finishSession();
    } else {
        loadQuestion();
    }
}

// ─── RESULTS ──────────────────────────────────────────────────────────────────
function finishSession() {
    const results = state.session.results;
    if (results.length === 0) { navigate('home'); return; }

    const avg = Math.round(results.reduce((sum, r) => sum + (r.evaluation.score || 0), 0) / results.length);

    // Persist stats
    state.stats.sessions++;
    state.stats.scores.push(avg);
    if (state.stats.scores.length > 20) state.stats.scores.shift();
    saveStats();

    // Update final progress bar
    document.getElementById('progress-fill').style.width = '100%';
    document.getElementById('progress-pct').textContent  = '100%';

    // Emoji
    const emoji = avg >= 85 ? '🏆' : avg >= 70 ? '🎯' : avg >= 50 ? '📚' : '💪';
    document.getElementById('results-emoji').textContent = emoji;
    document.getElementById('overall-num').textContent   = avg;

    // Per-question breakdown
    const grid = document.getElementById('results-grid');
    grid.innerHTML = results.map((r, i) => {
        const ev = r.evaluation;
        const cls  = ev.verdict === 'correct' ? 'good' : ev.verdict === 'partial' ? 'warn' : 'bad';
        const icon = ev.verdict === 'correct' ? '✅' : ev.verdict === 'partial' ? '⚠️' : '❌';
        return `
            <div class="result-item glass">
                <div class="result-item-header">
                    <span class="result-q-num">Q${i + 1}</span>
                    <span class="result-verdict ${cls}">${icon} ${capitalize(ev.verdict)}</span>
                    <span class="result-score-badge">${ev.score}/100</span>
                </div>
                <div class="result-question">${escapeHtml(r.question)}</div>
                <div class="result-feedback">${escapeHtml(ev.feedback || '')}</div>
            </div>
        `;
    }).join('');

    navigate('results');
}

// ─── QUESTIONS CRUD ───────────────────────────────────────────────────────────
function renderQuestions() {
    const list  = document.getElementById('q-list');
    const empty = document.getElementById('q-empty');

    if (state.questions.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    list.innerHTML = state.questions.map(q => `
        <div class="q-item glass" data-id="${q.id}">
            <div class="q-item-body">
                <div class="q-item-question">${escapeHtml(q.question)}</div>
                <div class="q-item-answer">${escapeHtml(q.modelAnswer)}</div>
            </div>
            <div class="q-item-actions">
                <button class="icon-btn edit-btn" onclick="openModal('${q.id}')" title="Edit question">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                </button>
                <button class="icon-btn delete-btn" onclick="deleteQuestion('${q.id}')" title="Delete question">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
            </div>
        </div>
    `).join('');
}

function openModal(id = null) {
    state.editId = id;
    const isEdit = Boolean(id);

    document.getElementById('modal-title').textContent  = isEdit ? 'Edit Question' : 'Add Question';
    document.getElementById('save-q-btn').textContent   = isEdit ? 'Update Question' : 'Save Question';
    document.getElementById('edit-id').value            = id || '';
    document.getElementById('modal-q').value            = '';
    document.getElementById('modal-a').value            = '';

    if (isEdit) {
        const q = state.questions.find(q => q.id === id);
        if (q) {
            document.getElementById('modal-q').value = q.question;
            document.getElementById('modal-a').value = q.modelAnswer;
        }
    }

    document.getElementById('modal-overlay').classList.remove('hidden');
    setTimeout(() => document.getElementById('modal-q').focus(), 120);
}

function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    state.editId = null;
}

function setupModalBackdrop() {
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
        if (e.target.id === 'modal-overlay') closeModal();
    });
}

function saveQuestion() {
    const question    = document.getElementById('modal-q').value.trim();
    const modelAnswer = document.getElementById('modal-a').value.trim();

    if (!question)    { showToast('Please enter a question', 'error'); return; }
    if (!modelAnswer) { showToast('Please enter a model answer', 'error'); return; }

    if (state.editId) {
        const idx = state.questions.findIndex(q => q.id === state.editId);
        if (idx !== -1) state.questions[idx] = { id: state.editId, question, modelAnswer };
        showToast('Question updated!', 'success');
    } else {
        state.questions.push({ id: genId(), question, modelAnswer });
        showToast('Question added!', 'success');
    }

    saveQuestions();
    closeModal();
    renderQuestions();
    updateStats();
}

function deleteQuestion(id) {
    if (!confirm('Delete this question? This cannot be undone.')) return;
    state.questions = state.questions.filter(q => q.id !== id);
    saveQuestions();
    renderQuestions();
    updateStats();
    showToast('Question deleted', 'info');
}

// ─── EXPORT / IMPORT ──────────────────────────────────────────────────────────
function exportQuestions() {
    if (state.questions.length === 0) {
        showToast('No questions to export', 'error');
        return;
    }

    const payload = {
        app: 'VoicePrep',
        exportedAt: new Date().toISOString(),
        version: 1,
        questions: state.questions.map(({ question, modelAnswer }) => ({ question, modelAnswer }))
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `voiceprep-questions-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    showToast(`Exported ${state.questions.length} question${state.questions.length !== 1 ? 's' : ''}!`, 'success');
}

function importQuestions() {
    document.getElementById('import-file-input').value = ''; // reset so same file can be re-picked
    document.getElementById('import-file-input').click();
}

function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);

            // Validate structure
            if (!Array.isArray(data.questions)) {
                showToast('Invalid file — expected a VoicePrep export JSON', 'error');
                return;
            }

            const incoming = data.questions.filter(q => q.question && q.modelAnswer);
            if (incoming.length === 0) {
                showToast('No valid questions found in file', 'error');
                return;
            }

            // Merge: skip questions with identical text (case-insensitive)
            const existingTexts = new Set(state.questions.map(q => q.question.toLowerCase().trim()));
            const newOnes = incoming.filter(q => !existingTexts.has(q.question.toLowerCase().trim()));
            const skipped = incoming.length - newOnes.length;

            newOnes.forEach(q => state.questions.push({ id: genId(), question: q.question, modelAnswer: q.modelAnswer }));
            saveQuestions();
            renderQuestions();
            updateStats();

            let msg = `Imported ${newOnes.length} question${newOnes.length !== 1 ? 's' : ''}`;
            if (skipped > 0) msg += ` · ${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped`;
            showToast(msg, 'success');

        } catch(err) {
            showToast('Could not read file — make sure it is a valid JSON', 'error');
        }
    };
    reader.readAsText(file);
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function initSettings() {
    const key = localStorage.getItem('vp_api_key') || '';
    document.getElementById('api-key-field').value = key;
    renderKeyStatus(Boolean(key));
}

function saveApiKey() {
    const key = document.getElementById('api-key-field').value.trim();
    if (!key) { showToast('Please enter an API key', 'error'); return; }
    localStorage.setItem('vp_api_key', key);
    showToast('API key saved!', 'success');
    renderKeyStatus(true);
}

function renderKeyStatus(ok) {
    const el = document.getElementById('key-status');
    el.innerHTML = ok
        ? '<span class="key-ok">✅ API key is configured</span>'
        : '<span class="key-missing">❌ No API key — add one above</span>';
}

function toggleApiVis() {
    const f = document.getElementById('api-key-field');
    f.type = f.type === 'password' ? 'text' : 'password';
}

function clearAllData() {
    if (!confirm('This will permanently delete ALL questions and session history. Continue?')) return;
    localStorage.removeItem('vp_questions');
    localStorage.removeItem('vp_stats');
    state.questions           = [];
    state.stats               = { sessions: 0, scores: [] };
    showToast('All data cleared', 'info');
    navigate('home');
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = 'info') {
    const t  = document.getElementById('toast');
    t.textContent = msg;
    t.className   = `toast toast-${type} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 3200);
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

function escapeHtml(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
}
