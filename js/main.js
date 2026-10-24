// --- INITIALISATION & LOGIQUE PRINCIPALE ---

let waitingWorker = null;

window.addEventListener('DOMContentLoaded', () => {
    // 1. Boutons Dashboard (conservation stricte des IDs existants)
    const connectBtn = document.getElementById('connectBtn');
    const demoBtn = document.getElementById('demoBtn');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');

    if (connectBtn) connectBtn.onclick = connectTrainer;
    if (demoBtn) demoBtn.onclick = startDemo;
    if (startBtn) startBtn.onclick = startSession;
    if (stopBtn) stopBtn.onclick = stopSession;

    // 2. Boutons Kiosk Compteur
    const kioskConnectBtn = document.getElementById('kioskConnectBtn');
    const kioskDemoBtn = document.getElementById('kioskDemoBtn');
    const kioskStartBtn = document.getElementById('kioskStartBtn');
    const kioskStopBtn = document.getElementById('kioskStopBtn');

    if (kioskConnectBtn) kioskConnectBtn.onclick = connectTrainer;
    if (kioskDemoBtn) kioskDemoBtn.onclick = startDemo;
    if (kioskStartBtn) kioskStartBtn.onclick = startSession;
    if (kioskStopBtn) kioskStopBtn.onclick = stopSession;

    // 3. Bouton mise à jour Service Worker toast
    const applyUpdateBtn = document.getElementById('applyUpdateBtn');
    if (applyUpdateBtn) {
        applyUpdateBtn.onclick = () => {
            if (state.isRecording) {
                alert("Veuillez terminer votre séance avant d'appliquer la mise à jour.");
                return;
            }
            if (waitingWorker) {
                waitingWorker.postMessage({ action: 'skipWaiting' });
            }
        };
    }

    // 4. Initialisations
    loadSettings();
    renderHistory();
    initChart();
    syncControlsUI();
    updateWakeLockUI();

    // Onglet par défaut : Compteur
    switchTab('compteur');
});

// --- GESTION DES ONGLETS ---
window.switchTab = function(tabId) {
    state.currentTab = tabId;

    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    const targetContent = document.getElementById(tabId);
    if (targetContent) targetContent.classList.add('active');
    
    const targetBtn = document.querySelector(`.tab-btn[onclick="switchTab('${tabId}')"]`);
    if (targetBtn) targetBtn.classList.add('active');

    // Si on bascule sur le Dashboard et qu'une séance est en cours,
    // on rafraîchit immédiatement le graphique qui était en veille
    if (tabId === 'dashboard' && state.isRecording) {
        renderChartData();
        updateWorkoutBanner();
    }
    if (tabId === 'compteur' && state.isRecording) {
        updateKioskWorkoutBanner();
    }
    updateLiveMetrics();
};

// --- GESTION DES PARAMÈTRES ---
function loadSettings() {
    const savedFtp = localStorage.getItem('userFTP');
    const demoBtn = document.getElementById('demoBtn');
    const kioskDemoBtn = document.getElementById('kioskDemoBtn');
    
    if (savedFtp) {
        state.ftp = parseInt(savedFtp);
        const ftpInput = document.getElementById('ftpInput');
        if (ftpInput) ftpInput.value = state.ftp;
        updateZonesDisplay();
    }
    
    // Mode Développeur
    const devMode = localStorage.getItem('devMode') === 'true';
    const devModeToggle = document.getElementById('devModeToggle');
    if (devModeToggle) devModeToggle.checked = devMode;
    if (demoBtn) demoBtn.style.display = devMode ? 'block' : 'none';
    if (kioskDemoBtn && state.bleStatus === 'disconnected') {
        kioskDemoBtn.style.display = devMode ? 'flex' : 'none';
    }
}

function updateZonesDisplay() {
    const zonesDisplay = document.getElementById('zonesDisplay');
    if (!zonesDisplay) return;
    
    zonesDisplay.style.display = 'block';
    document.getElementById('z1Val').innerText = `< ${Math.round(state.ftp * 0.55)} W`;
    document.getElementById('z2Val').innerText = `${Math.round(state.ftp * 0.55)} - ${Math.round(state.ftp * 0.75)} W`;
    document.getElementById('z3Val').innerText = `${Math.round(state.ftp * 0.76)} - ${Math.round(state.ftp * 0.90)} W`;
    document.getElementById('z4Val').innerText = `${Math.round(state.ftp * 0.91)} - ${Math.round(state.ftp * 1.05)} W`;
    document.getElementById('z5Val').innerText = `${Math.round(state.ftp * 1.06)} - ${Math.round(state.ftp * 1.20)} W`;
    document.getElementById('z6Val').innerText = `> ${Math.round(state.ftp * 1.20)} W`;
}

window.updateZonesDisplay = updateZonesDisplay;

window.saveSettings = function() {
    const ftpInput = document.getElementById('ftpInput');
    if (!ftpInput) return;
    
    const val = ftpInput.value;
    if (val && parseInt(val) > 0) {
        state.ftp = parseInt(val);
        localStorage.setItem('userFTP', state.ftp);
        updateZonesDisplay();
        alert('Paramètres enregistrés !');
    }
};

window.toggleDevMode = function() {
    const devModeToggle = document.getElementById('devModeToggle');
    if (!devModeToggle) return;
    
    const checked = devModeToggle.checked;
    localStorage.setItem('devMode', checked ? 'true' : 'false');
    syncControlsUI();
};

// --- GESTION DU PLEIN ÉCRAN MANUEL ---
window.toggleFullscreen = function() {
    if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(err => {
                console.warn("Fullscreen request error:", err);
            });
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
};

// --- SÉCURISATION DU SERVICE WORKER (ZÉRO COUPURE EN SÉANCE) ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .then(reg => {
                // Détecter un worker déjà en attente
                if (reg.waiting) {
                    showUpdateToast(reg.waiting);
                }

                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            // Nouvelle version prête : on n'actualise JAMAIS brutalement
                            showUpdateToast(newWorker);
                        }
                    });
                });
            })
            .catch(err => console.error('Service Worker registration failed:', err));

        // Rechargement sécurisé uniquement lorsque le nouveau worker prend le contrôle
        // ET qu'aucune séance n'est en cours d'enregistrement
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            if (!state.isRecording) {
                refreshing = true;
                window.location.reload();
            } else {
                debugLog("Mise à jour en attente : séance en cours", "info");
            }
        });
    });
}

function showUpdateToast(worker) {
    waitingWorker = worker;
    const toast = document.getElementById('updateToast');
    if (toast) {
        toast.style.display = 'flex';
        // Si en cours d'enregistrement, message adapté
        const toastText = document.getElementById('updateToastText');
        if (toastText && state.isRecording) {
            toastText.innerText = "Mise à jour prête (sera appliquée après la séance)";
        }
    }
}
