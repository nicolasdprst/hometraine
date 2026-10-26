(function (root) {
    'use strict';
    const ALLOWED_IDS = () => new Set((root.CycloTrainingLibrary && root.CycloTrainingLibrary.list || []).map(w => w.id));
    function validate(value) {
        if (!value || typeof value !== 'object') throw new Error('Réponse Gemini invalide');
        if (typeof value.explanation !== 'string' || value.explanation.length > 600) throw new Error('Explication Gemini invalide');
        if (!Array.isArray(value.workout_ids) || value.workout_ids.length > 3 || value.workout_ids.some(id => !ALLOWED_IDS().has(id))) throw new Error('Sélection Gemini invalide');
        if (value.tip != null && (typeof value.tip !== 'string' || value.tip.length > 240)) throw new Error('Conseil Gemini invalide');
        return { explanation: value.explanation, workout_ids: value.workout_ids, tip: value.tip || '' };
    }
    function availabilityError() {
        if (!root.supabaseClient) return 'Client Supabase indisponible.';
        if (!root.supabaseClient.isAuthenticated()) return 'Connectez-vous au compte Supabase dans Paramètres pour utiliser Gemini.';
        if (root.navigator && root.navigator.onLine === false) return 'Connexion Internet indisponible. Les recommandations locales restent actives.';
        return null;
    }
    async function request(summary, deterministicCandidates) {
        const unavailable = availabilityError();
        if (unavailable) throw new Error(unavailable);
        try {
            const response = await root.supabaseClient.invokeFunction('training-advice', { summary, candidate_workout_ids: deterministicCandidates.slice(0, 6) });
            return validate(response);
        } catch (error) {
            console.warn('Conseil Gemini indisponible, recommandations locales conservées:', error.message);
            if (error.status === 404) throw new Error('La fonction Supabase « training-advice » n’est pas déployée.');
            if (error.status === 401 || error.status === 403) throw new Error('Accès Gemini refusé : reconnectez le compte Supabase puis réessayez.');
            if (error.status === 429) throw new Error('Quota de conseils Gemini atteint. Réessayez plus tard.');
            throw new Error(`Gemini indisponible : ${error.message || 'erreur inconnue'}`);
        }
    }
    root.CycloGemini = Object.freeze({ validate, availabilityError, request });
})(typeof window !== 'undefined' ? window : globalThis);
