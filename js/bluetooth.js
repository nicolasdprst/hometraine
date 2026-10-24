// --- GESTION DU BLUETOOTH LOW ENERGY (BLE) & INTERFACE ---

function debugLog(msg, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${msg}`);
}

function updateBleStatusUI(status, deviceName = '') {
    state.bleStatus = status;
    const statusTxt = document.getElementById('status');
    const kioskBleDot = document.getElementById('kioskBleDot');
    const kioskBleText = document.getElementById('kioskBleText');

    let label = 'Prêt à scanner';
    let dotClass = '';

    switch(status) {
        case 'connecting':
            label = deviceName ? `Connexion à ${deviceName}...` : "Recherche d'appareils...";
            dotClass = 'connecting';
            break;
        case 'connected':
            label = deviceName ? `Connecté (${deviceName})` : 'Connecté';
            dotClass = 'connected';
            break;
        case 'stale':
            label = 'Signal perdu / En attente';
            dotClass = 'stale';
            break;
        case 'disconnected':
        default:
            label = 'Déconnecté';
            dotClass = '';
            break;
    }

    if (statusTxt) statusTxt.innerText = label;
    if (kioskBleText) kioskBleText.innerText = label;
    if (kioskBleDot) {
        kioskBleDot.className = 'kiosk-ble-dot' + (dotClass ? ` ${dotClass}` : '');
    }
}

function updateLiveMetrics() {
    // 1. Dashboard elements (conservation stricte des IDs existants)
    const wattsEl = document.getElementById('wattsVal');
    const speedEl = document.getElementById('speedVal');
    if (wattsEl) wattsEl.innerText = Math.round(state.currentWatts);
    if (speedEl) speedEl.innerText = state.currentSpeed.toFixed(1);

    // 2. Kiosk Counter elements
    const kioskWattsEl = document.getElementById('kioskWattsVal');
    const kioskSpeedEl = document.getElementById('kioskSpeedVal');
    if (kioskWattsEl) kioskWattsEl.innerText = Math.round(state.currentWatts);
    if (kioskSpeedEl) kioskSpeedEl.innerText = state.currentSpeed.toFixed(1);

    // Couleur dynamique de la zone de puissance
    let zoneStr = 'Z1';
    if (state.ftp > 0) {
        if (state.currentWatts > state.ftp * 1.2) zoneStr = 'Z6';
        else if (state.currentWatts > state.ftp * 1.05) zoneStr = 'Z5';
        else if (state.currentWatts > state.ftp * 0.9) zoneStr = 'Z4';
        else if (state.currentWatts > state.ftp * 0.75) zoneStr = 'Z3';
        else if (state.currentWatts > state.ftp * 0.55) zoneStr = 'Z2';
    }
    const zoneColor = (window.getZoneColor) ? window.getZoneColor(zoneStr) : '#64748b';
    
    const wattsCard = document.getElementById('wattsCard');
    if (wattsCard) wattsCard.style.borderBottom = `4px solid ${zoneColor}`;

    const kioskWattsCard = document.getElementById('kioskWattsCard');
    if (kioskWattsCard) kioskWattsCard.style.borderBottomColor = zoneColor;
}

function syncControlsUI() {
    const isConn = (state.bleStatus === 'connected' || state.isDemoMode);
    const isRec = state.isRecording;

    // Dashboard controls
    const connectionControls = document.getElementById('connectionControls');
    const sessionControls = document.getElementById('sessionControls');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');

    if (connectionControls) connectionControls.style.display = isConn ? 'none' : 'flex';
    if (sessionControls) sessionControls.style.display = isConn ? 'flex' : 'none';
    if (startBtn) startBtn.style.display = (isConn && !isRec) ? 'block' : 'none';
    if (stopBtn) stopBtn.style.display = (isConn && isRec) ? 'block' : 'none';

    // Kiosk Counter controls
    const kioskConnectBtn = document.getElementById('kioskConnectBtn');
    const kioskDemoBtn = document.getElementById('kioskDemoBtn');
    const kioskStartBtn = document.getElementById('kioskStartBtn');
    const kioskStopBtn = document.getElementById('kioskStopBtn');
    const devMode = localStorage.getItem('devMode') === 'true';

    if (kioskConnectBtn) kioskConnectBtn.style.display = isConn ? 'none' : 'flex';
    if (kioskDemoBtn) kioskDemoBtn.style.display = (!isConn && devMode) ? 'flex' : 'none';
    if (kioskStartBtn) kioskStartBtn.style.display = (isConn && !isRec) ? 'flex' : 'none';
    if (kioskStopBtn) kioskStopBtn.style.display = (isConn && isRec) ? 'flex' : 'none';
}

function onDeviceDisconnected() {
    debugLog("Périphérique Bluetooth déconnecté", "warn");
    updateBleStatusUI('disconnected');
    syncControlsUI();
}

async function connectTrainer() {
    try {
        updateBleStatusUI('connecting');
        
        // FILTRES BLUETOOTH STRICTEMENT CONSERVÉS SANS MODIFICATION
        state.device = await navigator.bluetooth.requestDevice({
            filters: [{ namePrefix: 'TURNO' }, { namePrefix: 'MISURO' }, { namePrefix: 'ELITE' }],
            optionalServices: [0x1818, 0x1816]
        });

        // Détection de déconnexion inattendue
        state.device.addEventListener('gattserverdisconnected', onDeviceDisconnected);
        
        updateBleStatusUI('connecting', state.device.name);
        state.server = await state.device.gatt.connect();

        // 1. Service Puissance (0x1818 / 0x2a63)
        try {
            const powerService = await state.server.getPrimaryService(0x1818);
            const powerChar = await powerService.getCharacteristic(0x2a63);
            await powerChar.startNotifications();
            powerChar.addEventListener('characteristicvaluechanged', (e) => {
                state.currentWatts = e.target.value.getUint16(2, true);
                state.lastBleDataTime = Date.now();
                if (state.bleStatus === 'stale') updateBleStatusUI('connected', state.bleDeviceName);
                updateLiveMetrics();
            });
        } catch(e) { debugLog("Puissance non dispo", "warn"); }

        // 2. Service Vitesse (0x1816 / 0x2a5b)
        try {
            const speedService = await state.server.getPrimaryService(0x1816);
            const speedChar = await speedService.getCharacteristic(0x2a5b);
            await speedChar.startNotifications();
            speedChar.addEventListener('characteristicvaluechanged', (e) => {
                const data = e.target.value;
                const cumulativeWheelRevs = data.getUint32(1, true);
                const lastWheelEventTime = data.getUint16(5, true);

                if (state.lastWheelRevs !== null) {
                    let dRevs = cumulativeWheelRevs - state.lastWheelRevs;
                    let dTime = lastWheelEventTime - state.lastWheelTime;
                    if (dTime < 0) dTime += 65536;
                    if (dRevs < 0) dRevs += 4294967296;

                    if (dTime > 0) {
                        const timeS = dTime / 1024.0;
                        const dist = dRevs * config.WHEEL_CIRCUMFERENCE_M;
                        state.currentSpeed = (dist / timeS) * 3.6;
                    }
                }
                state.lastWheelRevs = cumulativeWheelRevs;
                state.lastWheelTime = lastWheelEventTime;
                state.lastBleDataTime = Date.now();
                if (state.bleStatus === 'stale') updateBleStatusUI('connected', state.bleDeviceName);
                updateLiveMetrics();
            });
        } catch(e) { debugLog("Vitesse non dispo", "warn"); }

        state.bleDeviceName = state.device.name || 'Elite Turno';
        state.lastBleDataTime = Date.now();
        updateBleStatusUI('connected', state.bleDeviceName);
        syncControlsUI();
        
    } catch (error) {
        updateBleStatusUI('disconnected');
        syncControlsUI();
        debugLog(`Erreur de connexion : ${error.message}`, "error");
        // Si l'utilisateur n'a pas simplement annulé le sélecteur, on avertit
        if (error.name !== 'NotFoundError') {
            alert(`Erreur Bluetooth : ${error.message}`);
        }
    }
}

function startDemo() {
    state.isDemoMode = true;
    state.bleDeviceName = 'Démo';
    state.lastBleDataTime = Date.now();
    updateBleStatusUI('connected', 'Mode Démo');
    syncControlsUI();
    
    state.currentWatts = 180;
    
    if (state.demoInterval) clearInterval(state.demoInterval);
    state.demoInterval = setInterval(() => {
        let targetWatts = 180;
        
        // Si un entraînement structuré est actif, on simule l'effort ciblé
        if (state.activeWorkout && state.isRecording) {
            const step = state.activeWorkout.steps[state.currentWorkoutStepIndex];
            if (step) {
                switch(step.type) {
                    case 'Z1': targetWatts = state.ftp * 0.50; break;
                    case 'Z2': targetWatts = state.ftp * 0.65; break;
                    case 'Z3': targetWatts = state.ftp * 0.83; break;
                    case 'Z4': targetWatts = state.ftp * 0.98; break;
                    case 'Z5': targetWatts = state.ftp * 1.13; break;
                    case 'Z6': targetWatts = state.ftp * 1.30; break;
                    default: targetWatts = state.ftp * 0.70;
                }
            }
        }
        
        // Variations aléatoires douces
        const noise = (Math.random() * 16 - 8);
        state.currentWatts = Math.max(20, Math.round(targetWatts + noise));
        
        // Corrélation Vitesse
        if (state.currentWatts > 0) {
            state.currentSpeed = Math.pow(state.currentWatts / 0.007, 1/3);
        } else {
            state.currentSpeed = 0;
        }
        
        state.currentSpeed += (Math.random() * 0.4 - 0.2);
        state.lastBleDataTime = Date.now();

        updateLiveMetrics();
    }, 1000);
}

// Exposer globalement
window.debugLog = debugLog;
window.connectTrainer = connectTrainer;
window.startDemo = startDemo;
window.updateBleStatusUI = updateBleStatusUI;
window.updateLiveMetrics = updateLiveMetrics;
window.syncControlsUI = syncControlsUI;
