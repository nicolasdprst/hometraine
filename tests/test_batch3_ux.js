'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

function memoryStorage() {
    const values = new Map();
    return {
        getItem: key => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key)
    };
}

class Element {
    constructor() {
        this.children = [];
        this.style = {};
        this.textContent = '';
        this.value = '';
        this.className = '';
        this.classList = { add() {}, remove() {}, toggle() {} };
    }
    set innerHTML(value) { this.children = []; this._innerHTML = value; }
    get innerHTML() { return this._innerHTML || ''; }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); return child; }
    setAttribute() {}
    focus() {}
}

function dom(ids = []) {
    const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
    return {
        elements,
        document: {
            getElementById: id => elements[id] || null,
            createElement: () => new Element(),
            querySelectorAll: () => [],
            querySelector: () => null,
            addEventListener() {},
            body: { appendChild() {}, removeChild() {} }
        }
    };
}

async function testMandatoryProfileSelection() {
    const ui = dom(['profilePickerOverlay', 'pickerProfilesGrid', 'settingsProfilesList', 'kioskProfileBadge']);
    const context = vm.createContext({
        console, window: null, document: ui.document, localStorage: memoryStorage(), navigator: {},
        state: { ftp: 200, isRecording: false, activeProfile: null }, Date, Math, Uint8Array,
        alert() {}, confirm: () => false, indexedDB: undefined
    });
    context.window = context;
    context.supabaseClient = { isAuthenticated: () => false, getUser: () => null };
    vm.runInContext(source('js/storage.js'), context, { filename: 'js/storage.js' });
    context.localDataStore.setJSON('profiles', [{
        id: 'p1', display_name: 'Nicolas', ftp_watts: 220, avatar_color: '#3b82f6', is_archived: false
    }]);
    context.localDataStore.setJSON('active_profile_id', 'p1');
    vm.runInContext(source('js/profiles.js'), context, { filename: 'js/profiles.js' });
    await context.profilesManager.init();
    assert.strictEqual(context.profilesManager.activeProfile, null, 'le dernier profil ne doit pas être restauré');
    assert.strictEqual(context.profilesManager.lastProfileId, 'p1');
    assert.strictEqual(ui.elements.profilePickerOverlay.style.display, 'flex');
    context.profilesManager.applyProfile(context.profilesManager.profiles[0], false);
    assert.strictEqual(context.profilesManager.activeProfile.id, 'p1');
    assert.strictEqual(ui.elements.profilePickerOverlay.style.display, 'none');
}

function testSessionCannotStartWithoutProfile() {
    const ui = dom([]);
    let pickerCalls = 0;
    const context = vm.createContext({
        console, window: null, document: ui.document, navigator: {}, localStorage: memoryStorage(),
        state: { isRecording: false, isDemoMode: true, gattConnected: false },
        Chart: function() {}, Date, setInterval, clearInterval, alert() {}, confirm: () => false,
        formatTime: String, debugLog() {}
    });
    context.window = context;
    context.profilesManager = { activeProfile: null, showPicker: () => { pickerCalls++; } };
    vm.runInContext(source('js/session.js'), context, { filename: 'js/session.js' });
    context.startSession();
    assert.strictEqual(context.state.isRecording, false);
    assert.strictEqual(pickerCalls, 1);
}

async function testOfflineDeletionAndReplay() {
    const data = {
        sessions: [{ id: 's1', profile_id: 'p1', duration_seconds: 24, started_at: '2026-10-24T10:00:00Z', synced: true }],
        sync_queue: ['s1'], sync_retry: { s1: { attempts: 1 } }, deletion_queue: []
    };
    const store = {
        getOwnerId: () => 'account-a',
        getJSON: (name, fallback) => data[name] === undefined ? fallback : data[name],
        setJSON: (name, value) => { data[name] = value; return true; },
        remove() {}
    };
    const context = vm.createContext({
        console, window: null, document: dom([]).document, navigator: { onLine: false },
        localStorage: memoryStorage(), localDataStore: store,
        cycloDb: { remove: async () => true, get: async () => null },
        state: {}, Date, alert() {}, confirm: () => true, formatTime: value => `${value}s`,
        createCycloDashId: () => 'id', addEventListener() {}
    });
    context.window = context;
    context.profilesManager = { activeProfile: { id: 'p1', display_name: 'Nicolas' }, syncFromSupabase: async () => {} };
    let deleteCalls = 0;
    context.supabaseClient = {
        isAuthenticated: () => true,
        getUser: () => ({ id: 'account-a' }),
        deleteSession: async () => { deleteCalls++; },
        fetchSessions: async () => []
    };
    vm.runInContext(source('js/history.js'), context, { filename: 'js/history.js' });
    await context.deleteSessionById('s1');
    assert.strictEqual(data.sessions.length, 0, 'la séance disparaît localement hors ligne');
    assert.strictEqual(data.sync_queue.length, 0, 'la suppression annule tout upload');
    assert.strictEqual(data.deletion_queue.length, 1, 'une tombstone persistante est conservée');
    // Simule un arrêt entre l'écriture de la tombstone et le nettoyage local.
    data.sessions.push({ id: 's1', profile_id: 'p1', synced: true });
    data.sync_queue.push('s1');
    context.navigator.onLine = true;
    await context.processDeletionQueue();
    assert.strictEqual(deleteCalls, 1);
    assert.strictEqual(data.deletion_queue.length, 0, 'la tombstone disparaît après confirmation distante');
    assert.strictEqual(data.sessions.length, 0, 'une reprise après crash ne ressuscite pas la séance');
    assert.strictEqual(data.sync_queue.length, 0, 'une séance supprimée ne repart pas en upload');
}

function testVisualContract() {
    const html = source('index.html');
    const css = source('css/app.css');
    assert(html.includes('Qui pédale aujourd’hui'));
    assert(html.includes('deleteSessionModal'));
    assert(css.includes('min-height: 44px'));
    assert(css.includes('.bottom-nav'));
    assert(source('service-worker.js').includes('cyclodash-v25-ui-redesign'));
}

(async () => {
    await testMandatoryProfileSelection();
    testSessionCannotStartWithoutProfile();
    await testOfflineDeletionAndReplay();
    testVisualContract();
    console.log('Batch 3 : 4 groupes de tests UX et suppression réussis.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
