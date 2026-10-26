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
    async function request(summary, deterministicCandidates) {
        if (!root.supabaseClient || !root.supabaseClient.isAuthenticated() || navigator.onLine === false) return null;
        try {
            const response = await root.supabaseClient.invokeFunction('training-advice', { summary, candidate_workout_ids: deterministicCandidates.slice(0, 6) });
            return validate(response);
        } catch (error) {
            console.warn('Conseil Gemini indisponible, recommandations locales conservées:', error.message);
            return null;
        }
    }
    root.CycloGemini = Object.freeze({ validate, request });
})(typeof window !== 'undefined' ? window : globalThis);
