// Envoi TCX par e-mail : interface légère et file locale hors-ligne.
(function () {
    'use strict';

    const QUEUE_KEY = 'email_queue';
    let processingPromise = null;
    let selectedSessionId = null;

    const getSessions = () => window.getStoredSessions ? window.getStoredSessions() : localDataStore.getJSON('sessions', []);
    const saveSessions = sessions => window.saveStoredSessions ? window.saveStoredSessions(sessions) : localDataStore.setJSON('sessions', sessions);
    const normalizeEmail = value => String(value || '').trim().toLowerCase();
    const validEmail = value => window.isValidProfileEmail
        ? !!normalizeEmail(value) && window.isValidProfileEmail(value)
        : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(normalizeEmail(value));
    const getQueue = () => localDataStore.getJSON(QUEUE_KEY, []);
    const saveQueue = queue => localDataStore.setJSON(QUEUE_KEY, queue);

    function profileForSession(session) {
        return window.profilesManager && window.profilesManager.profiles
            ? window.profilesManager.profiles.find(profile => profile.id === session.profile_id)
            : null;
    }

    function ownsSession(session) {
        const active = window.profilesManager && window.profilesManager.activeProfile;
        return !!(session && active && session.profile_id === active.id);
    }

    function updateLocalStatus(sessionId, status, error) {
        const sessions = getSessions();
        const session = sessions.find(item => item.id === sessionId);
        if (!session) return;
        session.email_status = status;
        session.email_error = error || null;
        session.email_updated_at = new Date().toISOString();
        saveSessions(sessions);
        if (window.renderHistory) window.renderHistory();
    }

    function enqueue(item) {
        const queue = getQueue();
        const duplicate = queue.some(existing => existing.request_id === item.request_id);
        if (!duplicate) queue.push({ ...item, attempts: 0, next_at: 0, created_at: new Date().toISOString() });
        if (!saveQueue(queue)) throw new Error('Impossible de mémoriser l’envoi en attente');
        updateLocalStatus(item.session_id, 'pending');
        return !duplicate;
    }

    function automaticRequestId(session) {
        return `auto/${session.profile_id}/${session.id}/tcx`;
    }

    function enqueueAutomatic(session) {
        if (!session || !session.email_auto_requested || !validEmail(session.email_recipient_snapshot)) return false;
        return enqueue({
            session_id: session.id,
            profile_id: session.profile_id,
            recipient: normalizeEmail(session.email_recipient_snapshot),
            send_type: 'automatic',
            request_id: automaticRequestId(session)
        });
    }

    function statusText(status) {
        const labels = {
            pending: 'Envoi en attente de connexion',
            sending: 'Envoi en cours…',
            sent: 'E-mail accepté par Gmail',
            accepted: 'E-mail accepté pour expédition',
            delivered: 'E-mail précédemment marqué livré',
            failed: 'Échec de l’envoi — réessayer'
        };
        return labels[status] || '';
    }

    async function processQueue() {
        if (processingPromise) return processingPromise;
        if (navigator.onLine === false || !window.supabaseClient || !window.supabaseClient.isAuthenticated()) return;
        processingPromise = (async () => {
            const queue = getQueue();
            const remaining = [];
            for (const item of queue) {
                if (item.next_at && item.next_at > Date.now()) {
                    remaining.push(item);
                    continue;
                }
                const session = getSessions().find(candidate => candidate.id === item.session_id);
                if (!session || session.profile_id !== item.profile_id) continue;
                if (!session.synced) {
                    remaining.push(item);
                    continue;
                }
                try {
                    updateLocalStatus(item.session_id, 'sending');
                    const result = await window.supabaseClient.invokeFunction('send-session-email', {
                        session_id: item.session_id,
                        recipient: item.recipient,
                        send_type: item.send_type,
                        request_id: item.request_id
                    });
                    if (!result || result.status !== 'sent') {
                        throw new Error((result && result.error) || 'Gmail n’a pas accepté l’e-mail');
                    }
                    updateLocalStatus(item.session_id, 'sent');
                } catch (error) {
                    item.attempts = (item.attempts || 0) + 1;
                    item.last_error = error.message;
                    item.next_at = Date.now() + Math.min(300000, Math.pow(2, item.attempts - 1) * 5000);
                    remaining.push(item);
                    updateLocalStatus(item.session_id, 'failed', error.message);
                }
            }
            if (!saveQueue(remaining)) throw new Error('État de la file e-mail non persisté');
        })();
        try { return await processingPromise; }
        finally { processingPromise = null; }
    }

    function closeModal() {
        const modal = document.getElementById('emailSessionModal');
        if (modal) modal.style.display = 'none';
        selectedSessionId = null;
    }

    async function refreshRemoteStatus(session) {
        if (!session.synced || !window.supabaseClient || !window.supabaseClient.isAuthenticated()) return;
        try {
            const deliveries = await window.supabaseClient.fetchEmailDeliveries(session.id);
            if (!Array.isArray(deliveries) || deliveries.length === 0) return;
            const remote = deliveries[0];
            const localStatus = ['sent', 'accepted', 'delivered'].includes(remote.status)
                ? 'sent'
                : (['failed', 'bounced', 'complained'].includes(remote.status)
                    ? 'failed'
                    : (['sending', 'processing'].includes(remote.status) ? 'sending' : 'pending'));
            updateLocalStatus(session.id, localStatus, remote.last_error);
            const status = document.getElementById('emailSendStatus');
            if (selectedSessionId === session.id && status) status.textContent = statusText(localStatus);
        } catch (error) {
            console.warn('Statut e-mail distant indisponible:', error);
        }
    }

    function openForSession(sessionOrId) {
        const session = typeof sessionOrId === 'string'
            ? getSessions().find(item => item.id === sessionOrId)
            : sessionOrId;
        if (!ownsSession(session)) {
            if (window.showAppToast) window.showAppToast('Cette séance n’appartient pas au profil actif.', 'error');
            return;
        }
        const modal = document.getElementById('emailSessionModal');
        const input = document.getElementById('emailRecipientInput');
        const summary = document.getElementById('emailSessionSummary');
        const error = document.getElementById('emailRecipientError');
        const status = document.getElementById('emailSendStatus');
        const send = document.getElementById('sendEmailSessionBtn');
        const cancel = document.getElementById('cancelEmailSessionBtn');
        if (!modal || !input || !send || !cancel) return;
        const profile = profileForSession(session);
        selectedSessionId = session.id;
        input.value = (profile && profile.email_address) || session.email_recipient_snapshot || '';
        if (summary) summary.textContent = `${session.workout_name || 'Roule Libre'} · ${new Date(session.started_at).toLocaleDateString('fr-FR')} · ${formatTime(session.duration_seconds || 0)}`;
        if (error) error.textContent = input.value ? '' : 'Adresse e-mail manquante.';
        if (status) status.textContent = statusText(session.email_status);
        send.disabled = false;
        send.textContent = 'Envoyer';
        input.oninput = () => { if (error) error.textContent = validEmail(input.value) ? '' : 'Adresse e-mail invalide.'; };
        cancel.onclick = closeModal;
        send.onclick = async () => {
            const recipient = normalizeEmail(input.value);
            if (!validEmail(recipient)) {
                if (error) error.textContent = recipient ? 'Adresse e-mail invalide.' : 'Adresse e-mail manquante.';
                return;
            }
            send.disabled = true;
            send.textContent = 'Envoi…';
            if (status) status.textContent = navigator.onLine === false ? 'Envoi en attente de connexion' : 'Envoi en cours…';
            try {
                enqueue({
                    session_id: session.id,
                    profile_id: session.profile_id,
                    recipient,
                    send_type: 'manual',
                    request_id: `manual/${session.profile_id}/${session.id}/${createCycloDashId()}`
                });
                await processQueue();
                const refreshed = getSessions().find(item => item.id === session.id);
                const message = statusText(refreshed && refreshed.email_status) || 'Envoi en attente de connexion';
                if (status) status.textContent = message;
                if (window.showAppToast) window.showAppToast(message, refreshed && refreshed.email_status === 'sent' ? 'success' : 'warning');
                if (refreshed && refreshed.email_status === 'sent') setTimeout(closeModal, 900);
            } catch (sendError) {
                if (status) status.textContent = `Échec de l’envoi : ${sendError.message}`;
            } finally {
                send.disabled = false;
                send.textContent = 'Envoyer';
            }
        };
        modal.style.display = 'grid';
        input.focus();
        refreshRemoteStatus(session);
    }

    window.addEventListener('online', processQueue);
    window.CycloEmail = { openForSession, enqueueAutomatic, processQueue, statusText, _getQueue: getQueue };
})();
