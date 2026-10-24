// --- INITIALISATION & LOGIQUE PRINCIPALE ---

let waitingWorker = null;

window.addEventListener('DOMContentLoaded', async () => {
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

    // 4. Initialisation Multi-Profils & Supabase
    if (window.profilesManager) {
        await window.profilesManager.init();
    }

    // 5. Initialisations interface & graphiques
    loadSettings();
    renderHistory();
    initChart();
    syncControlsUI();
    updateWakeLockUI();
    updateSupabaseAccountUI();

    // 6. Vérifier si une séance précédente a été interrompue inopinément
    if (window.checkInterruptedSession) {
        window.checkInterruptedSession();
    }

    // 7. Traiter la file d'attente de synchronisation hors-ligne
    if (window.processSyncQueue) {
        window.processSyncQueue();
    }

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
    }

    // Si on bascule sur l'Historique, rafraîchir
    if (tabId === 'history' && window.renderHistory) {
        window.renderHistory();
    }
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
    
    const val = parseInt(ftpInput.value);
    if (val && val > 0) {
        state.ftp = val;
        localStorage.setItem('userFTP', state.ftp);
        
        // Mettre également à jour le profil actif
        if (window.profilesManager && window.profilesManager.activeProfile) {
            window.profilesManager.updateProfile(window.profilesManager.activeProfile.id, { ftp_watts: val })
                .catch(e => console.warn(e));
        }

        updateZonesDisplay();
        alert('Paramètres et FTP enregistrés !');
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

// --- GESTION DU COMPTE SUPABASE D'INSTALLATION DANS PARAMÈTRES ---
function updateSupabaseAccountUI() {
    const isAuth = window.supabaseClient && window.supabaseClient.isAuthenticated();
    const statusEl = document.getElementById('supabaseAccountStatus');
    const loginForm = document.getElementById('supabaseLoginForm');
    const loggedInBox = document.getElementById('supabaseLoggedInBox');
    const userEmailEl = document.getElementById('supabaseUserEmail');

    if (!statusEl) return;

    if (isAuth) {
        const user = window.supabaseClient.getUser();
        statusEl.innerText = "Connecté au cloud Supabase";
        statusEl.style.color = "var(--success)";
        if (loginForm) loginForm.style.display = 'none';
        if (loggedInBox) loggedInBox.style.display = 'block';
        if (userEmailEl) userEmailEl.innerText = user ? user.email : 'Installation connectée';
    } else {
        statusEl.innerText = "Mode local (Non connecté à Supabase)";
        statusEl.style.color = "var(--warning)";
        if (loginForm) loginForm.style.display = 'block';
        if (loggedInBox) loggedInBox.style.display = 'none';
    }
}

window.handleSupabaseLogin = async function() {
    const email = document.getElementById('supabaseEmailInput').value;
    const password = document.getElementById('supabasePasswordInput').value;
    if (!email || !password) {
        alert("Veuillez renseigner un email et un mot de passe.");
        return;
    }

    try {
        await window.supabaseClient.signIn(email, password);
        alert("Connexion Supabase réussie !");
        updateSupabaseAccountUI();
        if (window.profilesManager) await window.profilesManager.syncFromSupabase();
        if (window.processSyncQueue) window.processSyncQueue();
    } catch (err) {
        alert(`Erreur de connexion : ${err.message}`);
    }
};

window.handleSupabaseSignup = async function() {
    const email = document.getElementById('supabaseEmailInput').value;
    const password = document.getElementById('supabasePasswordInput').value;
    if (!email || !password) {
        alert("Veuillez renseigner un email et un mot de passe pour l'installation.");
        return;
    }

    try {
        await window.supabaseClient.signUp(email, password);
        alert("Compte d'installation créé avec succès !");
        updateSupabaseAccountUI();
        if (window.profilesManager) await window.profilesManager.syncFromSupabase();
    } catch (err) {
        alert(`Erreur d'inscription : ${err.message}`);
    }
};

window.handleSupabaseLogout = async function() {
    if (confirm("Voulez-vous déconnecter ce compte d'installation Supabase ? (Vos profils locaux resteront disponibles)")) {
        await window.supabaseClient.signOut();
        updateSupabaseAccountUI();
        alert("Déconnecté.");
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
                            showUpdateToast(newWorker);
                        }
                    });
                });
            })
            .catch(err => console.error('Service Worker registration failed:', err));

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
        const toastText = document.getElementById('updateToastText');
        if (toastText && state.isRecording) {
            toastText.innerText = "Mise à jour prête (sera appliquée après la séance)";
        }
    }
}
