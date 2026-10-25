'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

function testProfileAndDatabaseContract() {
    const profiles = source('js/profiles.js');
    const supabase = source('js/supabase.js');
    const migration = source('supabase/migrations/20261025_004_profile_email_delivery.sql');
    assert(profiles.includes("email_address: null"), 'un profil sans e-mail reste valide');
    assert(profiles.includes('email_auto_send: false'), 'l’automatisme est désactivé par défaut');
    assert(profiles.includes("email_auto_send: emailAutoSend"), 'création et modification conservent l’option');
    assert(supabase.includes('email_recipient_snapshot'), 'la synchronisation capture le destinataire historique');
    assert(migration.includes('ENABLE ROW LEVEL SECURITY'));
    assert(migration.includes('auth.uid() = owner_id'));
    assert(migration.includes('ON CONFLICT (idempotency_key) DO NOTHING'));
    assert(migration.includes('AFTER INSERT ON public.session_data'), 'l’auto attend les séries détaillées');
}

async function testOfflineQueueDedupAndRetry() {
    const data = {
        sessions: [{ id: 's1', profile_id: 'p1', synced: true, email_auto_requested: true, email_recipient_snapshot: 'a@example.fr' }],
        email_queue: []
    };
    const store = {
        getJSON: (key, fallback) => data[key] === undefined ? fallback : data[key],
        setJSON: (key, value) => { data[key] = value; return true; }
    };
    let onlineHandler;
    let calls = 0;
    let fail = true;
    const context = vm.createContext({
        console, window: null, navigator: { onLine: false }, Date, Math, Promise,
        setTimeout: callback => callback(), formatTime: String,
        createCycloDashId: () => '11111111-1111-4111-8111-111111111111',
        localDataStore: store,
        document: { getElementById: () => null },
        addEventListener: (name, handler) => { if (name === 'online') onlineHandler = handler; }
    });
    context.window = context;
    context.profilesManager = { activeProfile: { id: 'p1' }, profiles: [{ id: 'p1', email_address: 'a@example.fr' }] };
    context.supabaseClient = {
        isAuthenticated: () => true,
        invokeFunction: async () => { calls++; if (fail) throw new Error('Resend temporairement indisponible'); return { status: 'accepted' }; }
    };
    vm.runInContext(source('js/email.js'), context, { filename: 'js/email.js' });
    const session = data.sessions[0];
    assert.strictEqual(context.CycloEmail.enqueueAutomatic(session), true);
    assert.strictEqual(context.CycloEmail.enqueueAutomatic(session), false, 'une demande auto est idempotente');
    assert.strictEqual(data.email_queue.length, 1);
    await context.CycloEmail.processQueue();
    assert.strictEqual(calls, 0, 'aucun appel réseau hors ligne');

    context.navigator.onLine = true;
    await onlineHandler();
    assert.strictEqual(calls, 1);
    assert.strictEqual(data.sessions[0].email_status, 'failed');
    data.email_queue[0].next_at = 0;
    fail = false;
    await context.CycloEmail.processQueue();
    assert.strictEqual(calls, 2, 'la panne temporaire est retentée');
    assert.strictEqual(data.email_queue.length, 0);
    assert.strictEqual(data.sessions[0].email_status, 'accepted');

    assert.strictEqual(context.CycloEmail.enqueueAutomatic({ ...session, email_auto_requested: false }), false);
}

function testTcxAndBackendSecurityContract() {
    const context = vm.createContext({
        console, window: null, navigator: {}, state: {}, Date, Math,
        document: { getElementById: () => null, createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } },
        localDataStore: { getJSON: () => [], setJSON: () => true, remove() {} }, cycloDb: {},
        addEventListener() {}, alert() {}, confirm: () => false, formatTime: String,
        createCycloDashId: () => 'id', Blob, URL: { createObjectURL: () => '', revokeObjectURL() {} }
    });
    context.window = context;
    vm.runInContext(source('js/history.js'), context, { filename: 'js/history.js' });
    const xml = context.buildTCX({ started_at: '2026-10-25T08:00:00.000Z', duration_seconds: 2, distance_meters: 12, energy_kcal: 1 }, {
        time: [1, 2], timestamps: ['2026-10-25T08:00:01.000Z', '2026-10-25T08:00:02.000Z'], watts: [180, 220], speed: [21, 23], distance: [6, 12]
    });
    assert(xml.startsWith('<?xml version="1.0"'));
    assert(xml.includes('<TrainingCenterDatabase'));
    assert.strictEqual((xml.match(/<Trackpoint>/g) || []).length, 2);
    assert(xml.includes('<Watts>220</Watts>'));

    const sendFunction = source('supabase/functions/send-session-email/index.ts');
    const core = source('supabase/functions/_shared/email-core.ts');
    assert(sendFunction.includes(".eq('owner_id', user.id)"), 'contrôle propriétaire obligatoire');
    assert(sendFunction.includes('10 envois manuels par heure'));
    assert(sendFunction.includes('Quota quotidien'));
    assert(core.includes("'Idempotency-Key': claimed.idempotency_key"));
    assert(core.includes('attachments: [{ filename'));
    assert(!source('js/email.js').includes('RESEND_API_KEY'), 'aucun secret Resend dans le navigateur');
}

(async () => {
    testProfileAndDatabaseContract();
    await testOfflineQueueDedupAndRetry();
    testTcxAndBackendSecurityContract();
    console.log('E-mail TCX : profils, file hors-ligne, reprise, TCX et sécurité validés.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
