const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let now = 500;
const context = {
    console,
    performance: { now: () => now },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
        addEventListener: () => {},
        getElementById: () => null,
        body: { classList: { add: () => {}, remove: () => {} } }
    },
    state: {
        isRecording: true,
        isPaused: false,
        sessionStatus: 'recording',
        sessionStartMonotonic: 100,
        lastTickMonotonic: 500,
        sessionData: { time: [], watts: [] },
        displaySettings: { zoneFeedbackEnabled: true },
        currentWatts: 0,
        maxWatts: 0,
        elapsedTime: 0,
        ftp: 200,
        activeWorkout: null
    },
    formatTime: seconds => String(seconds)
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/ui-redesign.js'), 'utf8'), context);

assert.strictEqual(context.CycloUI.classifyTarget(100, 100), 'ok');
assert.strictEqual(context.CycloUI.classifyTarget(108, 100), 'high');
assert.strictEqual(context.CycloUI.classifyTarget(106, 100, 'high'), 'high', 'hystérésis haute');
assert.strictEqual(context.CycloUI.classifyTarget(104, 100, 'high'), 'ok');
assert.strictEqual(context.CycloUI.classifyTarget(92, 100), 'low');
assert.strictEqual(context.CycloUI.classifyTarget(94, 100, 'low'), 'low', 'hystérésis basse');

const workout = { steps: [{ duration: 60, target_pct: .5 }] };
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(context.CycloUI.targetBreakdown(workout, [0, 1, 2], [100, 110, 90], 200))),
    { ok: 1, high: 1, low: 1 }
);

context.CycloUI.togglePause();
assert.strictEqual(context.state.isPaused, true);
now = 1500;
context.CycloUI.togglePause();
assert.strictEqual(context.state.isPaused, false);
assert.strictEqual(context.state.sessionStartMonotonic, 1100, 'la pause est retirée du chrono');

console.log('UI redesign : seuils, hystérésis, bilan de cible et pause validés.');
