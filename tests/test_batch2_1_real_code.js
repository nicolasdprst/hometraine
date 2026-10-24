'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

function response(status, body = '', contentType = 'application/json') {
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: { get: name => name.toLowerCase() === 'content-type' ? contentType : null },
        async text() { return body; }
    };
}

function memoryStorage() {
    const values = new Map();
    return {
        getItem: key => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key),
        key: index => Array.from(values.keys())[index] || null,
        get length() { return values.size; }
    };
}

async function testSupabaseResponsesAndRefresh() {
    const queue = [];
    let fetchCount = 0;
    const context = vm.createContext({
        console,
        window: null,
        localStorage: memoryStorage(),
        fetch: async () => { fetchCount++; return queue.shift(); },
        Date,
        Promise,
        setTimeout
    });
    context.window = context;
    vm.runInContext(source('js/supabase.js'), context, { filename: 'js/supabase.js' });
    const client = context.supabaseClient;
    client.persistAuthSession({ access_token: 'jwt', refresh_token: 'refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'account-a' } });

    for (const status of [200, 201, 204]) {
        queue.push(response(status, ''));
        assert.strictEqual(await client.restRequest('profiles'), null, `${status} vide doit réussir`);
    }
    for (const status of [400, 401, 403, 500]) {
        client.persistAuthSession({ access_token: 'jwt', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'account-a' } });
        queue.push(response(status, JSON.stringify({ message: `error-${status}` })));
        await assert.rejects(() => client.restRequest('profiles'), error => error.status === status && error.message === `error-${status}`);
    }

    client.persistAuthSession({ access_token: 'expired', refresh_token: 'refresh', expires_at: 1, user: { id: 'account-a' } });
    queue.push(response(200, JSON.stringify({ access_token: 'new-jwt', refresh_token: 'new-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'account-a' } })));
    const beforeRefresh = fetchCount;
    const [tokenA, tokenB] = await Promise.all([client.ensureAccessToken(), client.ensureAccessToken()]);
    assert.strictEqual(tokenA, 'new-jwt');
    assert.strictEqual(tokenB, 'new-jwt');
    assert.strictEqual(fetchCount - beforeRefresh, 1, 'un seul refresh concurrent');
    assert.strictEqual(client.getHeaders(false).Authorization, undefined, 'la publishable key ne remplace pas un JWT');

    client.persistAuthSession({ access_token: 'expired', refresh_token: 'bad', expires_at: 1, user: { id: 'account-a' } });
    queue.push(response(400, JSON.stringify({ message: 'refresh invalid' })));
    await assert.rejects(() => client.ensureAccessToken());
    assert.strictEqual(client.session, null, 'un refresh définitivement refusé invalide la session');
}

async function testIsolationProfileSyncAndXss() {
    class Element {
        constructor() { this.children = []; this.style = {}; this.classList = { add() {}, remove() {} }; this._innerHTML = ''; this.textContent = ''; }
        set innerHTML(value) { if (value !== '') throw new Error('HTML dynamique interdit'); this._innerHTML = value; this.children = []; }
        get innerHTML() { return this._innerHTML; }
        append(...children) { this.children.push(...children); }
        appendChild(child) { this.children.push(child); return child; }
        getAttribute() { return null; }
    }
    const elements = { pickerProfilesGrid: new Element(), settingsProfilesList: new Element() };
    const storage = memoryStorage();
    let owner = 'account-a';
    let createCount = 0;
    const context = vm.createContext({
        console,
        window: null,
        localStorage: storage,
        navigator: {},
        Uint8Array,
        Math,
        Date,
        state: { ftp: 200, isRecording: false },
        alert() {}, confirm: () => false,
        document: {
            getElementById: id => elements[id] || null,
            createElement: () => new Element(),
            querySelectorAll: () => [],
            querySelector: () => null
        },
        indexedDB: undefined
    });
    context.window = context;
    context.supabaseClient = { getUser: () => ({ id: owner }) };
    vm.runInContext(source('js/storage.js'), context, { filename: 'js/storage.js' });
    context.localDataStore.setJSON('profiles', [{ id: 'a' }]);
    owner = 'account-b';
    assert.deepStrictEqual(Array.from(context.localDataStore.getJSON('profiles', [])), [], 'comptes locaux isolés');

    context.supabaseClient = {
        isAuthenticated: () => true,
        getUser: () => ({ id: 'account-b' }),
        fetchProfiles: async () => [],
        createProfile: async profile => { createCount++; return { ...profile, owner_id: 'account-b' }; },
        updateProfile: async () => null,
        countSessionsForProfile: async () => 0,
        deleteProfile: async () => null
    };
    vm.runInContext(source('js/profiles.js'), context, { filename: 'js/profiles.js' });
    context.profilesManager.profiles = [{
        id: context.createCycloDashId(), display_name: '<img src=x onerror=alert(1)>', ftp_watts: 200,
        avatar_color: 'javascript:alert(1)', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), sync_status: 'pending'
    }];
    await context.profilesManager.syncFromSupabase();
    assert.strictEqual(createCount, 1, 'profil hors ligne envoyé au cloud');
    assert.strictEqual(context.profilesManager.profiles[0].sync_status, 'synced');
    context.profilesManager.profiles.push({ id: context.createCycloDashId(), display_name: 'Second', ftp_watts: 180, avatar_color: '#10b981', is_archived: false });
    await context.profilesManager.archiveProfile(context.profilesManager.profiles[0].id);
    assert.strictEqual(context.profilesManager.profiles[0].is_archived, true);
    await context.profilesManager.restoreProfile(context.profilesManager.profiles[0].id);
    assert.strictEqual(context.profilesManager.profiles[0].is_archived, false);
    context.profilesManager.renderPickerCards();
    context.profilesManager.renderProfilesListInSettings();
    assert.strictEqual(context.validProfileColor('javascript:alert(1)'), '#3b82f6');
}

async function testSyncQueueLockAndOrdering() {
    const data = {
        sessions: [{ id: 's1', profile_id: 'p1', synced: false, sync_status: 'pending' }],
        sync_queue: ['s1'], sync_retry: {}
    };
    const order = [];
    const store = {
        getJSON: (name, fallback) => data[name] === undefined ? fallback : data[name],
        setJSON: (name, value) => { data[name] = value; return true; },
        remove() {}
    };
    let profileSyncs = 0;
    let sessionSyncs = 0;
    const context = vm.createContext({
        console,
        window: null,
        document: { getElementById: () => null, createElement: () => ({ style: {}, append() {}, appendChild() {} }), body: { appendChild() {}, removeChild() {} } },
        localStorage: memoryStorage(),
        localDataStore: store,
        cycloDb: { get: async () => ({ time: [1], watts: [100], speed: [20] }) },
        state: {}, alert() {}, confirm: () => false, formatTime: value => String(value),
        createCycloDashId: () => '00000000-0000-4000-8000-000000000000',
        addEventListener() {}
    });
    context.window = context;
    context.profilesManager = { syncFromSupabase: async () => { profileSyncs++; order.push('profile'); } };
    context.supabaseClient = {
        isAuthenticated: () => true,
        saveSession: async () => { sessionSyncs++; order.push('session'); }
    };
    vm.runInContext(source('js/history.js'), context, { filename: 'js/history.js' });
    await Promise.all([context.processSyncQueue(), context.processSyncQueue()]);
    assert.strictEqual(profileSyncs, 1);
    assert.strictEqual(sessionSyncs, 1);
    assert.deepStrictEqual(order, ['profile', 'session']);
    assert.deepStrictEqual(Array.from(data.sync_queue), []);
}

function testTcxRealTimestampsAndMissingValues() {
    let xml = '';
    class BlobCapture { constructor(parts) { xml = parts.join(''); } }
    const context = vm.createContext({
        console,
        window: null,
        document: { getElementById: () => null, createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } },
        localStorage: memoryStorage(),
        Blob: BlobCapture,
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
        state: {},
        alert() {}, confirm: () => false,
        formatTime: value => String(value),
        localDataStore: { getJSON: () => [], remove() {}, setJSON: () => true },
        cycloDb: {},
        createCycloDashId: () => '00000000-0000-4000-8000-000000000000',
        addEventListener() {}
    });
    context.window = context;
    vm.runInContext(source('js/history.js'), context, { filename: 'js/history.js' });
    context.downloadTCX('s1', { started_at: '2026-10-24T10:00:00.000Z', duration_seconds: 4, distance_meters: 20 }, {
        time: [1.25, 4], timestamps: ['2026-10-24T10:00:01.250Z', '2026-10-24T10:00:04.000Z'],
        watts: [null, 210], speed: [36, null], distance: [10, 10]
    });
    assert(xml.includes('2026-10-24T10:00:01.250Z'));
    assert(xml.includes('<Watts>210</Watts>'));
    assert(!xml.includes('<Watts>0</Watts>'));
    assert(!xml.includes('<Speed>0.00</Speed>'));
}

function testServiceWorkerDoesNotCacheExternalRequests() {
    const listeners = {};
    const context = vm.createContext({
        URL,
        fetch: () => Promise.resolve({}),
        caches: { open: async () => ({ addAll: async () => {} }), keys: async () => [], match: async () => null },
        self: {
            location: { origin: 'https://cyclodash.test' },
            clients: { claim() {} }, skipWaiting() {},
            addEventListener: (name, handler) => { listeners[name] = handler; }
        }
    });
    vm.runInContext(source('service-worker.js'), context, { filename: 'service-worker.js' });
    let intercepted = false;
    listeners.fetch({ request: { method: 'GET', url: 'https://example.supabase.co/rest/v1/profiles', mode: 'cors' }, respondWith() { intercepted = true; } });
    assert.strictEqual(intercepted, false);
    listeners.fetch({ request: { method: 'GET', url: 'https://cyclodash.test/js/main.js', mode: 'cors' }, respondWith() { intercepted = true; } });
    assert.strictEqual(intercepted, true);
}

(async () => {
    await testSupabaseResponsesAndRefresh();
    await testIsolationProfileSyncAndXss();
    await testSyncQueueLockAndOrdering();
    testTcxRealTimestampsAndMissingValues();
    testServiceWorkerDoesNotCacheExternalRequests();
    console.log('Batch 2.1 : 5 groupes de tests sur le vrai code réussis.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
