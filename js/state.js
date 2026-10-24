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
    ftp: 200,
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
    wakeLockActive: false
};

window.config = config;
window.state = state;
