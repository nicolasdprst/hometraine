'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.resolve(__dirname, '..');

function loadScript(relativePath, context) {
    vm.runInContext(fs.readFileSync(path.join(root, relativePath), 'utf8'), context, { filename: relativePath });
}

function testPostgresCompatibleIdFallback() {
    const context = vm.createContext({ console, window: null, navigator: {}, Uint8Array, Math });
    context.window = context;
    loadScript('js/state.js', context);
    const id = context.createCycloDashId();
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id));
}

async function testControlsAndBleLifecycle() {
    const elements = {};
    ['connectionControls', 'sessionControls', 'startBtn', 'stopBtn', 'connectBtn',
        'kioskConnectBtn', 'kioskDemoBtn', 'kioskStartBtn', 'kioskStopBtn']
        .forEach(id => { elements[id] = { style: {}, innerText: '' }; });

    let demoLoopCount = 0;
    const context = vm.createContext({
        console,
        window: null,
        document: { getElementById: id => elements[id] || null },
        localStorage: { getItem: () => 'false' },
        navigator: {},
        state: {
            bleStatus: 'disconnected', isDemoMode: false, isRecording: true,
            device: {}, currentWatts: 180, currentSpeed: 30, ftp: 200,
            lastPowerDataTime: null, lastSpeedDataTime: null,
            powerCharacteristic: null, speedCharacteristic: null,
            powerNotificationHandler: null, speedNotificationHandler: null
        },
        config: { POWER_FRESHNESS_MS: 5000, SPEED_FRESHNESS_MS: 5000 },
        setInterval: () => { demoLoopCount++; return demoLoopCount; },
        clearInterval() {}
    });
    context.window = context;
    loadScript('js/bluetooth.js', context);
    context.syncControlsUI();

    assert.strictEqual(elements.stopBtn.style.display, 'block');
    assert.strictEqual(elements.kioskStopBtn.style.display, 'flex');
    assert.strictEqual(elements.startBtn.style.display, 'none');
    assert.strictEqual(elements.kioskStartBtn.style.display, 'none');
    assert.strictEqual(elements.connectionControls.style.display, 'flex');
    assert.strictEqual(elements.kioskConnectBtn.innerText, 'Reconnecter');

    context.state.isRecording = false;
    context.startDemo();
    context.startDemo();
    assert.strictEqual(demoLoopCount, 1, 'un seul intervalle de démonstration doit être actif');

    let removedListeners = 0;
    let stoppedNotifications = 0;
    const characteristic = {
        removeEventListener() { removedListeners++; },
        async stopNotifications() { stoppedNotifications++; }
    };
    context.state.powerCharacteristic = characteristic;
    context.state.powerNotificationHandler = () => {};
    await context.cleanupBleSubscriptions();
    assert.strictEqual(removedListeners, 1);
    assert.strictEqual(stoppedNotifications, 1);
    assert.strictEqual(context.state.powerCharacteristic, null);
}

function makeSessionContext() {
    let wallTime = 10000;
    let monotonicTime = 10000;
    class FakeDate extends Date {
        constructor(value) { super(value === undefined ? wallTime : value); }
        static now() { return wallTime; }
    }

    const state = {
        isRecording: true, sessionStatus: 'recording', isDemoMode: false,
        gattConnected: true, bleStatus: 'connected', bleDeviceName: 'TURNO',
        lastPowerDataTime: 9500, lastSpeedDataTime: 0, lastBleNotificationTime: 9500,
        currentWatts: 200, currentSpeed: 36, ftp: 200,
        sessionStartMonotonic: 0, lastTickMonotonic: 9000, lastTickWallTime: 9000,
        elapsedTime: 0, pedalingTime: 0, reliableDataTime: 0,
        powerMeasureTime: 0, speedMeasureTime: 0, totalWorkJ: 0,
        sumWatts: 0, sumSpeed: 0, totalDistanceM: 0, maxWatts: 0, maxSpeed: 0,
        currentTab: 'none', activeWorkout: null, currentWorkoutStepIndex: 0,
        workoutStepTimeElapsed: 0,
        sessionData: { time: [], timestamps: [], watts: [], speed: [], distance: [] }
    };
    const context = vm.createContext({
        console,
        window: null,
        navigator: {},
        document: { addEventListener() {}, getElementById() { return null; }, visibilityState: 'visible' },
        Date: FakeDate,
        setInterval: () => 1,
        clearInterval() {},
        state,
        config: {
            POWER_FRESHNESS_MS: 5000, SPEED_FRESHNESS_MS: 5000,
            BLE_NOTIFICATION_STALE_MS: 6000, MAX_INTEGRATION_STEP_MS: 2000
        },
        performance: { now: () => monotonicTime },
        formatTime: value => String(value),
        advanceWorkout() {}, updateWorkoutBanner() {}, updateKioskWorkoutBanner() {},
        updateLiveMetrics() {}, renderChartData() {}, syncControlsUI() {},
        updateBleStatusUI(status) { state.bleStatus = status; },
        saveSessionToHistory() {}, debugLog() {}
    });
    context.window = context;
    loadScript('js/session.js', context);
    return {
        context,
        state,
        setTime(wall, monotonic) { wallTime = wall; monotonicTime = monotonic; }
    };
}

function testFreshnessAndMonotonicIntegration() {
    const fixture = makeSessionContext();
    const { context, state } = fixture;

    context.tick();
    assert.strictEqual(state.totalDistanceM, 0, 'une vitesse périmée ne doit pas produire de distance');
    assert.strictEqual(state.totalWorkJ, 200, 'une puissance fraîche reste indépendante de la vitesse');
    assert.strictEqual(state.sessionData.speed[0], null);
    assert.strictEqual(state.sessionData.watts[0], 200);

    fixture.setTime(11000, 11000);
    state.lastPowerDataTime = 0;
    state.lastSpeedDataTime = 10500;
    context.tick();
    assert.strictEqual(state.totalDistanceM, 10, 'la vitesse fraîche reprend sans rattrapage artificiel');
    assert.strictEqual(state.totalWorkJ, 200, 'la puissance périmée ne doit plus être intégrée');
    assert.strictEqual(state.sessionData.watts[1], null);
    assert.strictEqual(state.sessionData.speed[1], 36);

    fixture.setTime(41000, 41000);
    state.lastPowerDataTime = 40500;
    state.lastSpeedDataTime = 40500;
    context.tick();
    assert.strictEqual(state.totalDistanceM, 30, 'une reprise après suspension est bornée à deux secondes');
    assert.strictEqual(Math.floor(state.elapsedTime), 41, 'la durée totale suit l’horloge monotone réelle');
}

function testStoppingKeepsGattConnection() {
    const { context, state } = makeSessionContext();
    state.startTime = new Date(0);
    context.stopSession();
    assert.strictEqual(state.isRecording, false);
    assert.strictEqual(state.sessionStatus, 'stopped');
    assert.strictEqual(state.gattConnected, true);
    assert.strictEqual(state.bleStatus, 'connected');
}

function testTcxKeepsTimestampsAndMissingValues() {
    let generatedXml = '';
    class FakeBlob {
        constructor(parts) { generatedXml = parts.join(''); }
    }
    const link = { click() {} };
    const context = vm.createContext({
        console,
        window: null,
        document: {
            getElementById: () => null,
            createElement: () => link,
            body: { appendChild() {}, removeChild() {} }
        },
        localStorage: { getItem: () => '[]', setItem() {} },
        Blob: FakeBlob,
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
        state: {},
        alert() {}, confirm: () => false,
        formatTime: value => String(value),
        addEventListener() {}
    });
    context.window = context;
    loadScript('js/history.js', context);
    const summary = {
        date: '2026-10-24T10:00:00.000Z',
        started_at: '2026-10-24T10:00:00.000Z',
        duration: 2,
        duration_seconds: 2,
        distance: 10,
        distance_meters: 10
    };
    const detailed = {
            time: [1, 2],
            timestamps: ['2026-10-24T10:00:01.250Z', '2026-10-24T10:00:02.500Z'],
            watts: [null, 210], speed: [36, null], distance: [10, 10]
    };
    if (typeof context.exportTCX === 'function') {
        context.exportTCX({ ...summary, data: detailed });
    } else {
        context.downloadTCX('test-session', summary, detailed);
    }
    assert(generatedXml.includes('<Time>2026-10-24T10:00:01.250Z</Time>'));
    assert(generatedXml.includes('<Speed>10.00</Speed>'));
    assert(generatedXml.includes('<Watts>210</Watts>'));
    assert(!generatedXml.includes('<Watts>0</Watts>'));
    assert(!generatedXml.includes('<Speed>0.00</Speed>'));
}

(async () => {
    testPostgresCompatibleIdFallback();
    await testControlsAndBleLifecycle();
    testFreshnessAndMonotonicIntegration();
    testStoppingKeepsGattConnection();
    testTcxKeepsTimestampsAndMissingValues();
    console.log('Batch 1.1: 5 groupes de tests réussis.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
