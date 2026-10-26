// --- CONFIGURATION ET ÉTAT DE L'APPLICATION ---

const config = {
    WHEEL_CIRCUMFERENCE_M: 0.165, // Calibration Turno (ajusté pour réalisme plat à 0.165)
    // Les capteurs Elite notifient normalement au moins une fois par seconde.
    // Ces marges évitent les faux « signal perdu » tout en bornant strictement
    // l'intégration d'une dernière valeur en cas de silence radio.
    POWER_FRESHNESS_MS: 5000,
    SPEED_FRESHNESS_MS: 5000,
    BLE_NOTIFICATION_STALE_MS: 6000,
    MAX_INTEGRATION_STEP_MS: 2000,
    workoutsDB: {
        'endurance45': {
            name: 'Échauffement & Endurance',
            steps: [
                { type: 'Z1', duration: 10 * 60, desc: 'Échauffement' },
                { type: 'Z2', duration: 30 * 60, desc: 'Endurance' },
                { type: 'Z1', duration: 5 * 60, desc: 'Retour au calme' }
            ]
        },
        'intervals3030': {
            name: 'Intervalles 30/30',
            steps: [
                { type: 'Z2', duration: 10 * 60, desc: 'Échauffement' },
                ...Array(10).fill().flatMap(() => [
                    { type: 'Z5', duration: 30, desc: 'Effort Maximal !' },
                    { type: 'Z1', duration: 30, desc: 'Récupération' }
                ]),
                { type: 'Z1', duration: 10 * 60, desc: 'Retour au calme' }
            ]
        },
        'sweetspot': {
            name: 'Sweet Spot',
            steps: [
                { type: 'Z2', duration: 10 * 60, desc: 'Échauffement' },
                { type: 'Z3', duration: 10 * 60, desc: 'Sweet Spot 1' },
                { type: 'Z1', duration: 5 * 60, desc: 'Récup active' },
                { type: 'Z3', duration: 10 * 60, desc: 'Sweet Spot 2' },
                { type: 'Z1', duration: 5 * 60, desc: 'Retour au calme' }
            ]
        }
    }
};

const state = {
    device: null,
    server: null,
    powerCharacteristic: null,
    speedCharacteristic: null,
    powerNotificationHandler: null,
    speedNotificationHandler: null,
    connectionGeneration: 0,
    isConnecting: false,
    gattConnected: false,
    isRecording: false,
    isPaused: false,
    pauseStartedMonotonic: null,
    sessionStatus: 'idle',
    isDemoMode: false,
    demoInterval: null,
    startTime: null,
    stopTime: null,
    pedalingTime: 0,
    elapsedTime: 0,
    reliableDataTime: 0,
    powerMeasureTime: 0,
    speedMeasureTime: 0,
    totalWorkJ: 0,
    totalDistanceM: 0,
    sumWatts: 0,
    sumSpeed: 0,
    lastWheelRevs: null,
    lastWheelTime: null,
    currentWatts: 0,
    currentSpeed: 0,
    maxWatts: 0,
    maxSpeed: 0,
    // null est une valeur valide : une FTP inconnue ne doit jamais devenir 200 W implicitement.
    ftp: null,
    activeWorkout: null,
    currentWorkoutStepIndex: 0,
    workoutStepTimeElapsed: 0,
    sessionData: { time: [], timestamps: [], watts: [], speed: [], distance: [] },
    currentTab: 'compteur',
    bleStatus: 'disconnected',
    bleDeviceName: '',
    lastBleDataTime: null,
    lastPowerDataTime: null,
    lastSpeedDataTime: null,
    lastBleNotificationTime: null,
    sessionStartMonotonic: null,
    lastTickMonotonic: null,
    lastTickWallTime: null,
    wakeLockSupported: ('wakeLock' in navigator),
    wakeLockActive: false,
    displaySettings: {
        zoneFeedbackEnabled: typeof localStorage === 'undefined' || localStorage.getItem('zoneFeedbackEnabled') !== 'false'
    }
};

window.config = config;
window.state = state;

// UUID v4 compatible avec les navigateurs antérieurs à crypto.randomUUID().
function createCycloDashId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

window.createCycloDashId = createCycloDashId;
