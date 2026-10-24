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
    const now = Date.now();
    const powerAvailable = state.isDemoMode || (state.gattConnected && state.lastPowerDataTime !== null && now - state.lastPowerDataTime <= config.POWER_FRESHNESS_MS);
    const speedAvailable = state.isDemoMode || (state.gattConnected && state.lastSpeedDataTime !== null && now - state.lastSpeedDataTime <= config.SPEED_FRESHNESS_MS);

    // 1. Dashboard elements (conservation stricte des IDs existants)
    const wattsEl = document.getElementById('wattsVal');
    const speedEl = document.getElementById('speedVal');
    if (wattsEl) wattsEl.innerText = powerAvailable ? Math.round(state.currentWatts) : '—';
    if (speedEl) speedEl.innerText = speedAvailable ? state.currentSpeed.toFixed(1) : '—';

    // 2. Kiosk Counter elements
    const kioskWattsEl = document.getElementById('kioskWattsVal');
    const kioskSpeedEl = document.getElementById('kioskSpeedVal');
    if (kioskWattsEl) kioskWattsEl.innerText = powerAvailable ? Math.round(state.currentWatts) : '—';
    if (kioskSpeedEl) kioskSpeedEl.innerText = speedAvailable ? state.currentSpeed.toFixed(1) : '—';

    // Couleur dynamique de la zone de puissance
    let zoneStr = 'Z1';
    if (powerAvailable && state.ftp > 0) {
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

    if (connectionControls) connectionControls.style.display = !isConn ? 'flex' : 'none';
    if (sessionControls) sessionControls.style.display = (isConn || isRec) ? 'flex' : 'none';
    if (startBtn) startBtn.style.display = (isConn && !isRec) ? 'block' : 'none';
    if (stopBtn) stopBtn.style.display = isRec ? 'block' : 'none';

    // Kiosk Counter controls
    const kioskConnectBtn = document.getElementById('kioskConnectBtn');
    const connectBtn = document.getElementById('connectBtn');
    const kioskDemoBtn = document.getElementById('kioskDemoBtn');
    const kioskStartBtn = document.getElementById('kioskStartBtn');
    const kioskStopBtn = document.getElementById('kioskStopBtn');
    const devMode = localStorage.getItem('devMode') === 'true';

    if (kioskConnectBtn) kioskConnectBtn.style.display = isConn ? 'none' : 'flex';
    if (kioskConnectBtn) kioskConnectBtn.innerText = state.device ? 'Reconnecter' : 'Connecter le home trainer';
    if (connectBtn) connectBtn.innerText = state.device ? 'Reconnecter' : 'Connecter le home trainer';
    if (kioskDemoBtn) kioskDemoBtn.style.display = (!isConn && !isRec && devMode) ? 'flex' : 'none';
    if (kioskStartBtn) kioskStartBtn.style.display = (isConn && !isRec) ? 'flex' : 'none';
    if (kioskStopBtn) kioskStopBtn.style.display = isRec ? 'flex' : 'none';
}

function onDeviceDisconnected(event) {
    if (event && event.target !== state.device) return;
    debugLog("Périphérique Bluetooth déconnecté", "warn");
    state.gattConnected = false;
    state.server = null;
    state.connectionGeneration++;
    updateBleStatusUI('disconnected');
    updateLiveMetrics();
    syncControlsUI();
}

async function cleanupBleSubscriptions() {
    const subscriptions = [
        [state.powerCharacteristic, state.powerNotificationHandler],
        [state.speedCharacteristic, state.speedNotificationHandler]
    ];
    state.powerCharacteristic = null;
    state.speedCharacteristic = null;
    state.powerNotificationHandler = null;
    state.speedNotificationHandler = null;
    for (const [characteristic, handler] of subscriptions) {
        if (!characteristic) continue;
        try {
            if (handler) characteristic.removeEventListener('characteristicvaluechanged', handler);
            await characteristic.stopNotifications();
        } catch (error) {
            debugLog(`Nettoyage BLE incomplet : ${error.message}`, 'warn');
        }
    }
}

function markNotification(kind, generation) {
    if (generation !== state.connectionGeneration || !state.gattConnected) return false;
    const now = Date.now();
    state.lastBleNotificationTime = now;
    state.lastBleDataTime = now; // Compatibilité avec les versions précédentes.
    if (kind === 'power') state.lastPowerDataTime = now;
    if (kind === 'speed') state.lastSpeedDataTime = now;
    if (state.bleStatus === 'stale') updateBleStatusUI('connected', state.bleDeviceName);
    return true;
}

async function connectTrainer() {
    if (state.isConnecting) return;
    if (state.gattConnected && state.device && state.device.gatt && state.device.gatt.connected) {
        updateBleStatusUI('connected', state.bleDeviceName);
        syncControlsUI();
        return;
    }
    state.isConnecting = true;
    try {
        updateBleStatusUI('connecting');

        // FILTRES BLUETOOTH STRICTEMENT CONSERVÉS SANS MODIFICATION
        if (!state.device) {
            state.device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'TURNO' }, { namePrefix: 'MISURO' }, { namePrefix: 'ELITE' }],
                optionalServices: [0x1818, 0x1816]
            });
        }

        // Détection de déconnexion inattendue
        state.device.removeEventListener('gattserverdisconnected', onDeviceDisconnected);
        state.device.addEventListener('gattserverdisconnected', onDeviceDisconnected);

        await cleanupBleSubscriptions();
        const generation = ++state.connectionGeneration;
        updateBleStatusUI('connecting', state.device.name);
        state.server = await state.device.gatt.connect();
        if (generation !== state.connectionGeneration) return;
        state.gattConnected = true;
        state.lastWheelRevs = null;
        state.lastWheelTime = null;
        state.lastPowerDataTime = null;
        state.lastSpeedDataTime = null;
        state.lastBleNotificationTime = null;
        state.currentWatts = 0;
        state.currentSpeed = 0;

        // 1. Service Puissance (0x1818 / 0x2a63)
        try {
            const powerService = await state.server.getPrimaryService(0x1818);
            const powerChar = await powerService.getCharacteristic(0x2a63);
            await powerChar.startNotifications();
            const powerHandler = (e) => {
                if (!markNotification('power', generation)) return;
                state.currentWatts = e.target.value.getUint16(2, true);
                updateLiveMetrics();
            };
            powerChar.addEventListener('characteristicvaluechanged', powerHandler);
            state.powerCharacteristic = powerChar;
            state.powerNotificationHandler = powerHandler;
        } catch(e) { debugLog("Puissance non dispo", "warn"); }

        // 2. Service Vitesse (0x1816 / 0x2a5b)
        try {
            const speedService = await state.server.getPrimaryService(0x1816);
            const speedChar = await speedService.getCharacteristic(0x2a5b);
            await speedChar.startNotifications();
            const speedHandler = (e) => {
                if (!markNotification('speed', generation)) return;
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
                updateLiveMetrics();
            };
            speedChar.addEventListener('characteristicvaluechanged', speedHandler);
            state.speedCharacteristic = speedChar;
            state.speedNotificationHandler = speedHandler;
        } catch(e) { debugLog("Vitesse non dispo", "warn"); }

        state.bleDeviceName = state.device.name || 'Elite Turno';
        updateBleStatusUI('connected', state.bleDeviceName);
        syncControlsUI();
        
    } catch (error) {
        state.gattConnected = false;
        updateBleStatusUI('disconnected');
        syncControlsUI();
        debugLog(`Erreur de connexion : ${error.message}`, "error");
        // Si l'utilisateur n'a pas simplement annulé le sélecteur, on avertit
        if (error.name !== 'NotFoundError') {
            alert(`Erreur Bluetooth : ${error.message}`);
        }
    } finally {
        state.isConnecting = false;
    }
}

function startDemo() {
    if (state.isDemoMode) return;
    state.isDemoMode = true;
    state.bleDeviceName = 'Démo';
    state.lastBleDataTime = Date.now();
    state.lastPowerDataTime = state.lastBleDataTime;
    state.lastSpeedDataTime = state.lastBleDataTime;
    state.lastBleNotificationTime = state.lastBleDataTime;
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
        state.lastPowerDataTime = state.lastBleDataTime;
        state.lastSpeedDataTime = state.lastBleDataTime;
        state.lastBleNotificationTime = state.lastBleDataTime;

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
window.cleanupBleSubscriptions = cleanupBleSubscriptions;
