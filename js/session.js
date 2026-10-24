// --- GESTION DE LA SESSION DE SPORT, DU WAKE LOCK & DU GRAPHIQUE ---

let sessionTickInterval = null;
let chartInstance = null;
let wakeLockSentinel = null;

// --- SCREEN WAKE LOCK API ---
async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLockSentinel = await navigator.wakeLock.request('screen');
            state.wakeLockActive = true;
            wakeLockSentinel.addEventListener('release', () => {
                wakeLockSentinel = null;
                state.wakeLockActive = false;
                updateWakeLockUI();
            });
            updateWakeLockUI();
            debugLog("Screen Wake Lock actif", "info");
        } catch (err) {
            state.wakeLockActive = false;
            updateWakeLockUI();
            debugLog(`Screen Wake Lock non obtenu : ${err.message}`, "warn");
        }
    } else {
        state.wakeLockActive = false;
        updateWakeLockUI();
    }
}

async function releaseWakeLock() {
    if (wakeLockSentinel) {
        try {
            await wakeLockSentinel.release();
        } catch (err) {
            debugLog(`Erreur libération Wake Lock : ${err.message}`, "warn");
        }
        wakeLockSentinel = null;
        state.wakeLockActive = false;
        updateWakeLockUI();
    }
}

// Réacquisition automatique du Wake Lock si l'utilisateur revient sur l'application pendant une séance
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && state.isRecording && !wakeLockSentinel) {
        await requestWakeLock();
    }
});

function updateWakeLockUI() {
    const kioskBadge = document.getElementById('kioskWakeLockBadge');
    const settingsStatus = document.getElementById('wakeLockSettingStatus');

    if (kioskBadge) {
        if (state.wakeLockActive) {
            kioskBadge.classList.add('active');
            kioskBadge.innerText = '☀️ Écran verrouillé actif';
        } else {
            kioskBadge.classList.remove('active');
        }
    }

    if (settingsStatus) {
        if (!('wakeLock' in navigator)) {
            settingsStatus.innerText = "Non supporté par ce navigateur (réglez la mise en veille dans les paramètres Android)";
            settingsStatus.style.color = "var(--text-secondary)";
        } else if (state.wakeLockActive) {
            settingsStatus.innerText = "Actif (maintien de l'écran pendant la séance)";
            settingsStatus.style.color = "var(--success)";
        } else {
            settingsStatus.innerText = "Disponible (s'active automatiquement au début d'une séance)";
            settingsStatus.style.color = "var(--accent)";
        }
    }
}

// --- INITIALISATION GRAPHIQUE ---
function initChart() {
    const canvas = document.getElementById('mainChart');
    if (!canvas) return;
    
    // Si Chart.js n'est pas encore disponible
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js non disponible au moment de initChart');
        return;
    }

    const ctx = canvas.getContext('2d');
    Chart.defaults.color = '#94a3b8';
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: { 
            labels: [], 
            datasets: [
                { label: 'Puissance (W)', borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', data: [], yAxisID: 'y' },
                { label: 'Vitesse (km/h)', borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.0)', data: [], yAxisID: 'y1' }
            ] 
        },
        options: { 
            responsive: true, maintainAspectRatio: false, animation: false,
            elements: { point: { radius: 0 } },
            scales: { 
                y: { type: 'linear', display: true, position: 'left', title: {display: true, text: 'Watts'} },
                y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, title: {display: true, text: 'km/h'} }
            } 
        }
    });
}

function renderChartData() {
    if (!chartInstance) return;
    const displayLen = 600;
    chartInstance.data.labels = state.sessionData.time.slice(-displayLen).map(t => formatTime(t));
    chartInstance.data.datasets[0].data = state.sessionData.watts.slice(-displayLen);
    chartInstance.data.datasets[1].data = state.sessionData.speed.slice(-displayLen);
    chartInstance.update();
}

// --- DÉBUT DE SESSION ---
function startSession() {
    state.isRecording = true;
    state.currentSessionId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : ('sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
    state.sessionProfileId = (window.profilesManager && window.profilesManager.activeProfile) ? window.profilesManager.activeProfile.id : 'default-profile';
    state.startTime = new Date();
    state.pedalingTime = 0; 
    state.totalDistanceM = 0; 
    state.sumWatts = 0; 
    state.sumSpeed = 0;
    state.maxWatts = 0; 
    state.maxSpeed = 0;
    state.currentWorkoutStepIndex = 0; 
    state.workoutStepTimeElapsed = 0;
    
    state.sessionData.time = []; 
    state.sessionData.watts = []; 
    state.sessionData.speed = [];
    
    // Réinitialisation des affichages Dashboard
    const resetFields = {
        'wattsMaxVal': '0',
        'speedMaxVal': '0.0',
        'caloriesVal': '0',
        'workVal': '0',
        'durationVal': '00:00',
        'distanceVal': '📏 0.0 km',
        'avgWattsVal': 'Moyenne: 0 W',
        'avgSpeedVal': 'Moyenne: 0.0 km/h'
    };
    for (const [id, val] of Object.entries(resetFields)) {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    }

    // Réinitialisation des affichages Compteur
    const kioskResetFields = {
        'kioskDurationVal': '00:00',
        'kioskDistanceVal': '0.00',
        'kioskAvgWattsVal': '0',
        'kioskAvgSpeedVal': '0.0'
    };
    for (const [id, val] of Object.entries(kioskResetFields)) {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    }

    if (chartInstance) {
        chartInstance.data.labels = [];
        chartInstance.data.datasets[0].data = [];
        chartInstance.data.datasets[1].data = [];
        chartInstance.update();
    }
    
    // Activer Screen Wake Lock
    requestWakeLock();
    
    // Synchroniser les contrôles (afficher bouton TERMINER sur Compteur & Dashboard)
    syncControlsUI();
    
    if (sessionTickInterval) clearInterval(sessionTickInterval);
    sessionTickInterval = setInterval(tick, 1000);
}

// --- FIN DE SESSION ---
function stopSession() {
    state.isRecording = false;
    state.stopTime = new Date();
    if (sessionTickInterval) clearInterval(sessionTickInterval);
    
    if (state.isDemoMode) {
        if (state.demoInterval) clearInterval(state.demoInterval);
        state.isDemoMode = false;
    }
    
    // Libérer Screen Wake Lock
    releaseWakeLock();
    
    // Masquer les bandeaux d'entraînement
    const wb = document.getElementById('workoutBanner');
    if (wb) wb.classList.remove('active');
    const kwb = document.getElementById('kioskWorkoutBanner');
    if (kwb) kwb.classList.remove('active');
    
    updateBleStatusUI('disconnected');
    syncControlsUI();
    
    saveSessionToHistory();
}

// --- TICK DE MESURE (CHAQUE SECONDE) ---
function tick() {
    if (!state.isRecording) return;

    // Détection de données périmées (Stale data timeout de 4 secondes)
    if (!state.isDemoMode && state.device && state.lastBleDataTime) {
        if (Date.now() - state.lastBleDataTime > 4000) {
            if (state.bleStatus !== 'stale') {
                updateBleStatusUI('stale', state.bleDeviceName);
            }
        }
    }

    // Accumulation d'effort si mouvement détecté
    if (state.currentWatts > 0 || state.currentSpeed > 0.5) {
        state.pedalingTime += 1;
        state.sumWatts += state.currentWatts;
        state.sumSpeed += state.currentSpeed;
        state.totalDistanceM += (state.currentSpeed / 3.6);
    }

    if (state.pedalingTime > 0) {
        state.maxWatts = Math.max(state.maxWatts, state.currentWatts);
        state.maxSpeed = Math.max(state.maxSpeed, state.currentSpeed);
        const avgW = Math.round(state.sumWatts / state.pedalingTime);
        const avgS = (state.sumSpeed / state.pedalingTime).toFixed(1);
        const distKm = (state.totalDistanceM / 1000).toFixed(2);
        const timeStr = formatTime(state.pedalingTime);
        const workKJ = Math.round(state.sumWatts / 1000);
        const caloriesKcal = workKJ;

        // Mise à jour Dashboard
        const avgWattsEl = document.getElementById('avgWattsVal');
        const avgSpeedEl = document.getElementById('avgSpeedVal');
        const durationEl = document.getElementById('durationVal');
        const distanceEl = document.getElementById('distanceVal');
        const wattsMaxEl = document.getElementById('wattsMaxVal');
        const speedMaxEl = document.getElementById('speedMaxVal');
        const caloriesEl = document.getElementById('caloriesVal');
        const workEl = document.getElementById('workVal');

        if (avgWattsEl) avgWattsEl.innerText = `Moyenne: ${avgW} W`;
        if (avgSpeedEl) avgSpeedEl.innerText = `Moyenne: ${avgS} km/h`;
        if (durationEl) durationEl.innerText = timeStr;
        if (distanceEl) distanceEl.innerText = `📏 ${distKm} km`;
        if (wattsMaxEl) wattsMaxEl.innerText = Math.round(state.maxWatts);
        if (speedMaxEl) speedMaxEl.innerText = state.maxSpeed.toFixed(1);
        if (caloriesEl) caloriesEl.innerText = caloriesKcal;
        if (workEl) workEl.innerText = workKJ;

        // Mise à jour Compteur Kiosk
        const kioskDurationEl = document.getElementById('kioskDurationVal');
        const kioskDistanceEl = document.getElementById('kioskDistanceVal');
        const kioskAvgWattsEl = document.getElementById('kioskAvgWattsVal');
        const kioskAvgSpeedEl = document.getElementById('kioskAvgSpeedVal');

        if (kioskDurationEl) kioskDurationEl.innerText = timeStr;
        if (kioskDistanceEl) kioskDistanceEl.innerText = distKm;
        if (kioskAvgWattsEl) kioskAvgWattsEl.innerText = avgW;
        if (kioskAvgSpeedEl) kioskAvgSpeedEl.innerText = avgS;
    }

    // Mise à jour de la télémétrie de workout
    updateWorkoutBanner();
    updateKioskWorkoutBanner();

    // Enregistrement inconditionnel des données brutes pour l'export TCX et l'historique
    state.sessionData.time.push(state.pedalingTime);
    state.sessionData.watts.push(state.currentWatts);
    state.sessionData.speed.push(state.currentSpeed);

    // Sauvegarde locale intermédiaire toutes les 30s pour limiter les pertes en cas d'arrêt accidentel
    if (state.pedalingTime > 0 && state.pedalingTime % 30 === 0) {
        try {
            localStorage.setItem('cyclodash_active_session_backup', JSON.stringify({
                id: state.currentSessionId,
                profile_id: state.sessionProfileId,
                startTime: state.startTime,
                pedalingTime: state.pedalingTime,
                totalDistanceM: state.totalDistanceM,
                sumWatts: state.sumWatts,
                sumSpeed: state.sumSpeed,
                maxWatts: state.maxWatts,
                maxSpeed: state.maxSpeed,
                sessionData: state.sessionData
            }));
        } catch(e) {}
    }

    // OPTIMISATION PERFORMANCE :
    // On ne recalcule et ne rafraîchit Chart.js QUE si l'onglet Dashboard est visible !
    if (state.currentTab === 'dashboard') {
        renderChartData();
    }
}

// Vérification au démarrage d'une éventuelle séance interrompue par crash/batterie
function checkInterruptedSession() {
    try {
        const backupRaw = localStorage.getItem('cyclodash_active_session_backup');
        if (!backupRaw) return;
        const b = JSON.parse(backupRaw);
        if (b && b.pedalingTime > 30) {
            const dateStr = b.startTime ? new Date(b.startTime).toLocaleString() : 'récente';
            if (confirm(`Une séance interrompue (${formatTime(b.pedalingTime)}) du ${dateStr} a été retrouvée.\nVoulez-vous la restaurer et l'enregistrer dans votre historique ?`)) {
                state.currentSessionId = b.id;
                state.sessionProfileId = b.profile_id;
                state.startTime = new Date(b.startTime || Date.now());
                state.stopTime = new Date();
                state.pedalingTime = b.pedalingTime;
                state.totalDistanceM = b.totalDistanceM || 0;
                state.sumWatts = b.sumWatts || 0;
                state.sumSpeed = b.sumSpeed || 0;
                state.maxWatts = b.maxWatts || 0;
                state.maxSpeed = b.maxSpeed || 0;
                state.sessionData = b.sessionData || { time: [], watts: [], speed: [] };

                if (window.saveSessionToHistory) {
                    window.saveSessionToHistory();
                }
            } else {
                localStorage.removeItem('cyclodash_active_session_backup');
            }
        }
    } catch(e) {
        console.warn("Erreur vérification séance interrompue:", e);
    }
}

// Mise à jour du bandeau compact en mode Compteur
function updateKioskWorkoutBanner() {
    const banner = document.getElementById('kioskWorkoutBanner');
    if (!banner) return;

    if (!state.activeWorkout || !state.isRecording) {
        banner.classList.remove('active');
        return;
    }
    banner.classList.add('active');

    const nameEl = document.getElementById('kioskWorkoutNameDisplay');
    const timeEl = document.getElementById('kioskWorkoutTimeDisplay');
    const targetEl = document.getElementById('kioskWorkoutTargetDisplay');

    if (state.currentWorkoutStepIndex >= state.activeWorkout.steps.length) {
        if (nameEl) nameEl.innerText = "Entraînement terminé";
        if (timeEl) timeEl.innerText = "";
        if (targetEl) targetEl.innerText = "Roule libre";
        banner.style.borderLeftColor = "var(--success)";
        return;
    }

    const steps = state.activeWorkout.steps;
    const step = steps[state.currentWorkoutStepIndex];
    const timeRemaining = step.duration - state.workoutStepTimeElapsed;

    if (nameEl) nameEl.innerText = `${step.desc} (${state.currentWorkoutStepIndex + 1}/${steps.length})`;
    if (timeEl) timeEl.innerText = formatTime(timeRemaining);
    if (targetEl) targetEl.innerText = `Cible : Zone ${step.type} (${getZoneTargetString(step.type)})`;

    const color = getZoneColor(step.type);
    banner.style.borderLeftColor = color;
}

// Expositions globales
window.sessionTickInterval = sessionTickInterval;
window.chartInstance = chartInstance;
window.initChart = initChart;
window.startSession = startSession;
window.stopSession = stopSession;
window.tick = tick;
window.renderChartData = renderChartData;
window.requestWakeLock = requestWakeLock;
window.releaseWakeLock = releaseWakeLock;
window.updateWakeLockUI = updateWakeLockUI;
window.updateKioskWorkoutBanner = updateKioskWorkoutBanner;
window.checkInterruptedSession = checkInterruptedSession;
