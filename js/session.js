// --- GESTION DE LA SESSION DE SPORT, DU WAKE LOCK & DU GRAPHIQUE ---

let sessionTickInterval = null;
let chartInstance = null;
let wakeLockSentinel = null;
let lastBackupElapsed = 0;

function monotonicNow() {
    return (window.performance && typeof window.performance.now === 'function') ? window.performance.now() : Date.now();
}

function isMeasurementFresh(timestamp, freshnessMs, now = Date.now()) {
    return timestamp !== null && timestamp !== undefined && now - timestamp <= freshnessMs;
}

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
            settingsStatus.innerText = "Non supporté";
            settingsStatus.style.color = "var(--text-secondary)";
        } else if (state.wakeLockActive) {
            settingsStatus.innerText = "Actif";
            settingsStatus.style.color = "var(--success)";
        } else {
            settingsStatus.innerText = "Disponible";
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
    if (state.isRecording || (!state.isDemoMode && !state.gattConnected)) return;
    const activeProfile = window.profilesManager && window.profilesManager.activeProfile;
    if (!activeProfile) {
        window.profilesManager.showPicker(true);
        if (window.showAppToast) window.showAppToast('Choisissez le cycliste avant de démarrer.', 'warning');
        return;
    }
    state.isRecording = true;
    state.isPaused = false;
    state.pauseStartedMonotonic = null;
    state.sessionStatus = 'recording';
    state.currentSessionId = createCycloDashId();
    state.sessionProfileId = activeProfile.id;
    lastBackupElapsed = 0;
    state.startTime = new Date();
    state.stopTime = null;
    state.pedalingTime = 0;
    state.elapsedTime = 0;
    state.reliableDataTime = 0;
    state.powerMeasureTime = 0;
    state.speedMeasureTime = 0;
    state.totalWorkJ = 0;
    state.totalDistanceM = 0; 
    state.sumWatts = 0; 
    state.sumSpeed = 0;
    state.maxWatts = 0; 
    state.maxSpeed = 0;
    state.currentWorkoutStepIndex = 0; 
    state.workoutStepTimeElapsed = 0;
    
    state.sessionData = { time: [], timestamps: [], watts: [], speed: [], distance: [] };
    state.sessionStartMonotonic = monotonicNow();
    state.lastTickMonotonic = state.sessionStartMonotonic;
    state.lastTickWallTime = Date.now();
    
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
    if (window.CycloUI) window.CycloUI.renderCounter();
    
    if (sessionTickInterval) clearInterval(sessionTickInterval);
    sessionTickInterval = setInterval(tick, 1000);
}

// --- FIN DE SESSION ---
function stopSession() {
    if (!state.isRecording) return;
    if (!state.isPaused) tick();
    state.isRecording = false;
    state.isPaused = false;
    state.pauseStartedMonotonic = null;
    state.sessionStatus = 'stopped';
    state.stopTime = new Date();
    if (sessionTickInterval) {
        clearInterval(sessionTickInterval);
        sessionTickInterval = null;
    }
    
    if (state.isDemoMode) {
        if (state.demoInterval) clearInterval(state.demoInterval);
        state.demoInterval = null;
        state.isDemoMode = false;
        state.currentWatts = 0;
        state.currentSpeed = 0;
        state.lastPowerDataTime = null;
        state.lastSpeedDataTime = null;
        updateBleStatusUI('disconnected');
    }
    
    // Libérer Screen Wake Lock
    releaseWakeLock();
    
    // Masquer les bandeaux d'entraînement
    const wb = document.getElementById('workoutBanner');
    if (wb) wb.classList.remove('active');
    const kwb = document.getElementById('kioskWorkoutBanner');
    if (kwb) kwb.classList.remove('active');
    
    // La fin d'une séance ne modifie jamais l'état de la connexion GATT.
    if (!state.isDemoMode && state.gattConnected) {
        updateBleStatusUI('connected', state.bleDeviceName);
    }
    syncControlsUI();
    if (window.CycloUI) window.CycloUI.renderCounter();
    
    saveSessionToHistory();
}

// --- TICK DE MESURE (CHAQUE SECONDE) ---
function tick() {
    if (!state.isRecording || state.isPaused) return;

    const nowMonotonic = monotonicNow();
    const nowWall = Date.now();
    const rawElapsedMs = Math.max(0, nowMonotonic - state.lastTickMonotonic);
    const integrationMs = Math.min(rawElapsedMs, config.MAX_INTEGRATION_STEP_MS);
    const integrationSeconds = integrationMs / 1000;
    state.elapsedTime = Math.max(0, (nowMonotonic - state.sessionStartMonotonic) / 1000);
    state.lastTickMonotonic = nowMonotonic;
    state.lastTickWallTime = nowWall;

    const powerFresh = state.isDemoMode || (state.gattConnected && isMeasurementFresh(state.lastPowerDataTime, config.POWER_FRESHNESS_MS, nowWall));
    const speedFresh = state.isDemoMode || (state.gattConnected && isMeasurementFresh(state.lastSpeedDataTime, config.SPEED_FRESHNESS_MS, nowWall));
    const powerValue = powerFresh ? state.currentWatts : null;
    const speedValue = speedFresh ? state.currentSpeed : null;

    // Le statut global dépend de toute notification, sans masquer la fraîcheur
    // indépendante de la puissance et de la vitesse.
    if (!state.isDemoMode && state.gattConnected && state.lastBleNotificationTime) {
        if (nowWall - state.lastBleNotificationTime > config.BLE_NOTIFICATION_STALE_MS) {
            if (state.bleStatus !== 'stale') {
                updateBleStatusUI('stale', state.bleDeviceName);
            }
        }
    }

    if (!powerFresh || !speedFresh) updateLiveMetrics();

    // Les intégrales utilisent le temps monotone réellement écoulé, borné pour
    // ne pas extrapoler une valeur à travers une suspension du navigateur.
    if (powerFresh) {
        state.sumWatts += powerValue * integrationSeconds;
        state.totalWorkJ += powerValue * integrationSeconds;
        state.powerMeasureTime += integrationSeconds;
        state.maxWatts = Math.max(state.maxWatts, powerValue);
    }
    if (speedFresh) {
        state.sumSpeed += speedValue * integrationSeconds;
        state.totalDistanceM += (speedValue / 3.6) * integrationSeconds;
        state.speedMeasureTime += integrationSeconds;
        state.maxSpeed = Math.max(state.maxSpeed, speedValue);
    }
    if (powerFresh || speedFresh) {
        state.reliableDataTime += integrationSeconds;
    }
    if ((powerFresh && powerValue > 0) || (speedFresh && speedValue > 0.5)) {
        state.pedalingTime += integrationSeconds;
    }

    const avgW = state.powerMeasureTime > 0 ? Math.round(state.sumWatts / state.powerMeasureTime) : 0;
    const avgS = state.speedMeasureTime > 0 ? (state.sumSpeed / state.speedMeasureTime).toFixed(1) : '0.0';
    const distKm = (state.totalDistanceM / 1000).toFixed(2);
    const timeStr = formatTime(state.elapsedTime);
    const workKJ = Math.round(state.totalWorkJ / 1000);
    const caloriesKcal = workKJ;

    if (state.currentTab === 'dashboard') {
        // Mise à jour Dashboard uniquement lorsqu'il est visible.
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

    }

    if (state.currentTab === 'compteur') {
        // Mise à jour Compteur uniquement lorsqu'il est visible.
        const kioskDurationEl = document.getElementById('kioskDurationVal');
        const kioskDistanceEl = document.getElementById('kioskDistanceVal');
        const kioskAvgWattsEl = document.getElementById('kioskAvgWattsVal');
        const kioskAvgSpeedEl = document.getElementById('kioskAvgSpeedVal');

        if (kioskDurationEl) kioskDurationEl.innerText = timeStr;
        if (kioskDistanceEl) kioskDistanceEl.innerText = distKm;
        if (kioskAvgWattsEl) kioskAvgWattsEl.innerText = avgW;
        if (kioskAvgSpeedEl) kioskAvgSpeedEl.innerText = avgS;
    }

    // Le calcul de l'entraînement reste actif quel que soit l'onglet.
    advanceWorkout(rawElapsedMs / 1000);
    if (state.currentTab === 'dashboard') updateWorkoutBanner();
    if (state.currentTab === 'compteur') updateKioskWorkoutBanner();

    // null représente une mesure absente ; ce n'est jamais une fausse mesure à 0.
    state.sessionData.time.push(state.elapsedTime);
    state.sessionData.timestamps.push(new Date(nowWall).toISOString());
    state.sessionData.watts.push(powerValue);
    state.sessionData.speed.push(speedValue);
    state.sessionData.distance.push(state.totalDistanceM);

    if (window.CycloUI) window.CycloUI.renderCounter();

    // Sauvegarde de reprise toutes les 30 secondes de temps réellement écoulé.
    if (state.elapsedTime - lastBackupElapsed >= 30) {
        lastBackupElapsed = state.elapsedTime;
        try {
            const stored = localDataStore.setJSON('active_session_backup', {
                id: state.currentSessionId,
                profile_id: state.sessionProfileId,
                startTime: state.startTime,
                elapsedTime: state.elapsedTime,
                pedalingTime: state.pedalingTime,
                reliableDataTime: state.reliableDataTime,
                powerMeasureTime: state.powerMeasureTime,
                speedMeasureTime: state.speedMeasureTime,
                totalDistanceM: state.totalDistanceM,
                totalWorkJ: state.totalWorkJ,
                sumWatts: state.sumWatts,
                sumSpeed: state.sumSpeed,
                maxWatts: state.maxWatts,
                maxSpeed: state.maxSpeed,
                sessionData: state.sessionData
            });
            if (!stored) throw new Error('quota local dépassé');
        } catch (error) {
            debugLog(`Sauvegarde de reprise impossible : ${error.message}`, 'warn');
        }
    }

    // OPTIMISATION PERFORMANCE :
    // On ne recalcule et ne rafraîchit Chart.js QUE si l'onglet Dashboard est visible !
    if (state.currentTab === 'dashboard') {
        renderChartData();
    }
}

// Vérification au démarrage d'une éventuelle séance interrompue par crash/batterie
async function checkInterruptedSession() {
    try {
        const backup = localDataStore.getJSON('active_session_backup', null);
        if (!backup || (backup.elapsedTime || backup.pedalingTime || 0) <= 30) return;

        const duration = backup.elapsedTime || backup.pedalingTime;
        const ownerProfile = window.profilesManager && window.profilesManager.profiles.find(profile => profile.id === backup.profile_id);
        const ownerLabel = ownerProfile ? ` pour ${ownerProfile.display_name}` : '';
        const dateStr = backup.startTime ? new Date(backup.startTime).toLocaleString() : 'récente';
        if (!confirm(`Une séance interrompue${ownerLabel} (${formatTime(duration)}) du ${dateStr} a été retrouvée.\nElle restera associée à son profil d'origine. Voulez-vous la restaurer ?`)) {
            localDataStore.remove('active_session_backup');
            return;
        }

        state.currentSessionId = backup.id;
        state.sessionProfileId = backup.profile_id;
        state.startTime = new Date(backup.startTime || Date.now());
        state.stopTime = new Date();
        state.elapsedTime = duration;
        state.pedalingTime = backup.pedalingTime || 0;
        state.reliableDataTime = backup.reliableDataTime || 0;
        state.powerMeasureTime = backup.powerMeasureTime || 0;
        state.speedMeasureTime = backup.speedMeasureTime || 0;
        state.totalDistanceM = backup.totalDistanceM || 0;
        state.totalWorkJ = backup.totalWorkJ || backup.sumWatts || 0;
        state.sumWatts = backup.sumWatts || 0;
        state.sumSpeed = backup.sumSpeed || 0;
        state.maxWatts = backup.maxWatts || 0;
        state.maxSpeed = backup.maxSpeed || 0;

        const data = backup.sessionData || {};
        state.sessionData = {
            time: Array.isArray(data.time) ? data.time : [],
            timestamps: Array.isArray(data.timestamps) ? data.timestamps : [],
            watts: Array.isArray(data.watts) ? data.watts : [],
            speed: Array.isArray(data.speed) ? data.speed : [],
            distance: Array.isArray(data.distance) ? data.distance : []
        };
        if (window.saveSessionToHistory) {
            await window.saveSessionToHistory();
        }
    } catch (error) {
        console.warn('Erreur vérification séance interrompue:', error);
    }
}

// Mise à jour du bandeau compact en mode Compteur
function updateKioskWorkoutBanner() {
    const banner = document.getElementById('kioskWorkoutBanner');
    if (!banner) return;

    if (!state.activeWorkout) {
        banner.classList.remove('active');
        const nameEl = document.getElementById('kioskWorkoutNameDisplay');
        const timeEl = document.getElementById('kioskWorkoutTimeDisplay');
        const targetEl = document.getElementById('kioskWorkoutTargetDisplay');
        if (nameEl) nameEl.innerText = 'Roule libre';
        if (timeEl) timeEl.innerText = '--:--';
        if (targetEl) targetEl.innerText = 'Sans cible';
        if (window.CycloUI) window.CycloUI.renderCounter();
        return;
    }
    banner.classList.add('active');

    const nameEl = document.getElementById('kioskWorkoutNameDisplay');
    const timeEl = document.getElementById('kioskWorkoutTimeDisplay');
    const targetEl = document.getElementById('kioskWorkoutTargetDisplay');

    if (!state.isRecording) {
        if (nameEl) nameEl.innerText = `Prêt : ${state.activeWorkout.name}`;
        if (timeEl) timeEl.innerText = formatTime(state.activeWorkout.duration_seconds);
        if (targetEl) targetEl.innerText = 'Démarrez la séance pour lancer les intervalles';
        banner.style.borderLeftColor = 'var(--accent)';
        return;
    }

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
    if (window.CycloUI) window.CycloUI.renderCounter();
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
window.isMeasurementFresh = isMeasurementFresh;
window.checkInterruptedSession = checkInterruptedSession;
