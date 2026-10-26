// --- INITIALISATION & LOGIQUE PRINCIPALE ---

let waitingWorker = null;
let appToastTimer = null;

if (typeof document !== 'undefined' && document.addEventListener) {
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(e => document.addEventListener(e, ev => ev.preventDefault()));
}

window.showAppToast = function(message, type = 'success') {
    const toast = document.getElementById('appToast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `app-toast ${type}`;
    toast.style.display = 'block';
    if (appToastTimer) clearTimeout(appToastTimer);
    appToastTimer = setTimeout(() => { toast.style.display = 'none'; }, 3600);
};

window.addEventListener('DOMContentLoaded', async () => {
    if (window.supabaseClient) await window.supabaseClient.ready();
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
        await window.checkInterruptedSession();
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
    if (tabId === 'dashboard') tabId = 'compteur';
    state.currentTab = tabId;

    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    const targetContent = document.getElementById(tabId);
    if (targetContent) targetContent.classList.add('active');
    
    const targetBtn = document.querySelector(`.tab-btn[onclick="switchTab('${tabId}')"]`);
    if (targetBtn) targetBtn.classList.add('active');

    if (tabId === 'compteur') {
        updateKioskWorkoutBanner();
        if (window.CycloUI && window.CycloUI.renderCounter) window.CycloUI.renderCounter();
    }
    updateLiveMetrics();

    // Si on bascule sur l'Historique, rafraîchir
    if (tabId === 'history' && window.renderHistory) {
        window.renderHistory();
    }
    if ((tabId === 'workouts' || tabId === 'settings') && window.CycloTrainingUI) {
        window.CycloTrainingUI.refresh();
    }
    if (tabId === 'settings' && window.updateSettingsSummaryUI) {
        window.updateSettingsSummaryUI();
    }
};

// --- GESTION DES PARAMÈTRES / RÉGLAGES ---
window.updateSettingsSummaryUI = function() {
    const p = window.profilesManager ? window.profilesManager.activeProfile : null;
    const profileValEl = document.getElementById('settingsCurrentProfileVal');
    if (profileValEl) {
        profileValEl.textContent = p ? p.display_name : 'Aucun';
    }

    const ftpValEl = document.getElementById('settingsCurrentFtpVal');
    if (ftpValEl) {
        ftpValEl.textContent = state.ftp ? `${state.ftp} W` : (p && p.ftp_watts ? `${p.ftp_watts} W` : 'Inconnue');
    }

    const ftpSmartValEl = document.getElementById('settingsCurrentFtpSmartVal');
    if (ftpSmartValEl) {
        if (p && p.ftp_confidence && p.ftp_confidence !== 'unknown' && p.ftp_watts) {
            ftpSmartValEl.textContent = `${p.ftp_watts} W`;
        } else {
            ftpSmartValEl.textContent = 'Analyser';
        }
    }

    const goalLabels = {
        restart: 'Reprise',
        endurance: 'Endurance',
        general_progress: 'Progression générale',
        ftp: 'Amélioration FTP',
        performance: 'Performance'
    };
    const intensityLabels = {
        gentle: 'Plutôt douce',
        balanced: 'Équilibrée',
        intense: 'Plutôt intense'
    };

    const goalValEl = document.getElementById('settingsCurrentGoalVal');
    if (goalValEl) {
        goalValEl.textContent = p && p.training_goal ? (goalLabels[p.training_goal] || p.training_goal) : 'Progression générale';
    }

    const sessionsValEl = document.getElementById('settingsCurrentSessionsVal');
    if (sessionsValEl) {
        sessionsValEl.textContent = p && p.sessions_per_week ? `${p.sessions_per_week}` : 'Non défini';
    }

    const durationValEl = document.getElementById('settingsCurrentDurationVal');
    if (durationValEl) {
        durationValEl.textContent = p && p.session_duration_minutes ? `${p.session_duration_minutes} min` : 'Non définie';
    }

    const intensityValEl = document.getElementById('settingsCurrentIntensityVal');
    if (intensityValEl) {
        intensityValEl.textContent = p && p.intensity_preference ? (intensityLabels[p.intensity_preference] || p.intensity_preference) : 'Équilibrée';
    }

    const cloudValEl = document.getElementById('settingsCurrentCloudVal');
    if (cloudValEl) {
        const isAuth = window.supabaseClient && window.supabaseClient.isAuthenticated();
        if (isAuth) {
            const user = window.supabaseClient.getUser();
            cloudValEl.textContent = user && user.email ? user.email : 'Connecté';
        } else {
            cloudValEl.textContent = 'Non connecté';
        }
    }
};

window.openSettingsModal = function(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    if (id === 'settingsProfilesModal' && window.profilesManager) {
        window.profilesManager.renderProfilesListInSettings();
    }
    if (id === 'settingsFtpSmartModal' && window.CycloTrainingUI) {
        window.CycloTrainingUI.refresh();
    }
    if (id === 'settingsTrainingModal' && window.CycloTrainingUI) {
        window.CycloTrainingUI.refresh();
    }
    if (id === 'settingsSyncModal') {
        updateSupabaseAccountUI();
    }
    modal.style.display = 'flex';
};

window.closeSettingsModal = function(id) {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = 'none';
    if (window.updateSettingsSummaryUI) window.updateSettingsSummaryUI();
};

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
    if (window.updateSettingsSummaryUI) window.updateSettingsSummaryUI();
}

function updateZonesDisplay() {
    const zonesDisplay = document.getElementById('zonesDisplay');
    if (!zonesDisplay) return;
    if (!Number(state.ftp)) {
        zonesDisplay.style.display = 'none';
        return;
    }
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
            const p = window.profilesManager.activeProfile;
            const history = Array.isArray(p.ftp_history) ? p.ftp_history.slice() : [];
            history.push({ watts: val, source: 'manual', confidence: 'manual', recorded_at: new Date().toISOString() });
            window.profilesManager.updateProfile(p.id, { ftp_watts: val, ftp_origin: 'manual', ftp_confidence: 'manual', ftp_history: history })
                .catch(e => console.warn(e));
        }

        updateZonesDisplay();
        if (window.updateSettingsSummaryUI) window.updateSettingsSummaryUI();
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
    if (window.updateSettingsSummaryUI) window.updateSettingsSummaryUI();
}

window.handleSupabaseLogin = async function() {
    if (state.isRecording) {
        alert('Terminez la séance avant de changer de compte Supabase.');
        return;
    }
    const email = document.getElementById('supabaseEmailInput').value;
    const password = document.getElementById('supabasePasswordInput').value;
    if (!email || !password) {
        alert("Veuillez renseigner un email et un mot de passe.");
        return;
    }

    try {
        await window.supabaseClient.signIn(email, password);
        if (window.profilesManager) await window.profilesManager.handleAccountChange(true);
        alert("Connexion Supabase réussie !");
        updateSupabaseAccountUI();
        if (window.processSyncQueue) await window.processSyncQueue();
    } catch (err) {
        alert(`Erreur de connexion : ${err.message}`);
    }
};

window.handleSupabaseSignup = async function() {
    if (state.isRecording) {
        alert('Terminez la séance avant de créer un compte Supabase.');
        return;
    }
    const email = document.getElementById('supabaseEmailInput').value;
    const password = document.getElementById('supabasePasswordInput').value;
    if (!email || !password) {
        alert("Veuillez renseigner un email et un mot de passe pour l'installation.");
        return;
    }

    try {
        const result = await window.supabaseClient.signUp(email, password);
        alert(result && result.access_token
            ? "Compte d'installation créé et connecté !"
            : "Compte créé. Consultez votre e-mail pour confirmer l’inscription avant de vous connecter.");
        updateSupabaseAccountUI();
        if (result && result.access_token && window.profilesManager) await window.profilesManager.handleAccountChange(true);
    } catch (err) {
        alert(`Erreur d'inscription : ${err.message}`);
    }
};

window.handleSupabaseLogout = async function() {
    if (state.isRecording) {
        alert('Terminez la séance avant de vous déconnecter.');
        return;
    }
    if (confirm("Voulez-vous déconnecter ce compte d'installation Supabase ? (Vos profils locaux resteront disponibles)")) {
        await window.supabaseClient.signOut();
        if (window.profilesManager) await window.profilesManager.handleAccountChange(false);
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
