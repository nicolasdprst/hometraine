// --- CLIENT SUPABASE REST & AUTHENTIFICATION NATIF (ZÉRO DÉPENDANCE) ---
// Conçu pour Chrome 119 et Android 7 : léger, robuste et 100% standard

const SUPABASE_CONFIG = {
    url: 'https://vwdptlmmycpxobucctnj.supabase.co',
    anonKey: 'sb_publishable_dr8rEtZLflaLNXzlpUg4ww_xcfpzSoF'
};

const supabaseClient = {
    session: null,
    refreshPromise: null,
    readyPromise: Promise.resolve(),

    init() {
        try {
            const saved = localStorage.getItem('cyclodash_supabase_session');
            if (saved) {
                this.session = JSON.parse(saved);
                // Si le token expire bientôt (dans les 10 min), tenter un refresh
                if (this.session && this.session.expires_at) {
                    const nowSec = Math.floor(Date.now() / 1000);
                    if (this.session.expires_at - nowSec < 600) {
                        this.readyPromise = this.refreshToken().catch(e => {
                            console.warn('Refresh token silencieux différé:', e.message);
                            return null;
                        });
                    }
                }
            }
        } catch (e) {
            console.error("Erreur lecture session Supabase locale:", e);
        }
    },

    ready() {
        return this.readyPromise;
    },

    persistAuthSession(sess) {
        this.session = sess;
        if (sess) {
            localStorage.setItem('cyclodash_supabase_session', JSON.stringify(sess));
        } else {
            localStorage.removeItem('cyclodash_supabase_session');
        }
    },

    isAuthenticated() {
        if (!(this.session && this.session.access_token && this.session.user)) return false;
        if (!this.session.expires_at) return true;
        return this.session.expires_at > Math.floor(Date.now() / 1000) || !!this.session.refresh_token;
    },

    getUser() {
        return this.session ? this.session.user : null;
    },

    getHeaders(withAuth = true) {
        const headers = {
            'apikey': SUPABASE_CONFIG.anonKey,
            'Content-Type': 'application/json'
        };
        if (withAuth && this.session && this.session.access_token) {
            headers['Authorization'] = `Bearer ${this.session.access_token}`;
        }
        return headers;
    },

    async parseResponse(res) {
        const text = await res.text();
        if (!text) return null;
        const contentType = res.headers && res.headers.get ? (res.headers.get('content-type') || '') : '';
        if (contentType.includes('json')) {
            try { return JSON.parse(text); } catch (error) { throw new Error('Réponse JSON Supabase invalide'); }
        }
        try { return JSON.parse(text); } catch (error) { return text; }
    },

    // --- AUTHENTIFICATION ---
    async signUp(email, password) {
        const res = await fetch(`${SUPABASE_CONFIG.url}/auth/v1/signup`, {
            method: 'POST',
            headers: this.getHeaders(false),
            body: JSON.stringify({ email, password })
        });
        const data = await this.parseResponse(res) || {};
        if (!res.ok) throw new Error(data.error_description || data.message || "Erreur d'inscription");
        
        // Si session retournée immédiatement (email auto-confirmé)
        if (data.access_token) {
            this.persistAuthSession(data);
        }
        return data;
    },

    async signIn(email, password) {
        const res = await fetch(`${SUPABASE_CONFIG.url}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: this.getHeaders(false),
            body: JSON.stringify({ email, password })
        });
        const data = await this.parseResponse(res) || {};
        if (!res.ok) throw new Error(data.error_description || data.message || "Identifiants invalides");
        this.persistAuthSession(data);
        return data;
    },

    async refreshToken() {
        if (!this.session || !this.session.refresh_token) return null;
        if (this.refreshPromise) return this.refreshPromise;
        this.refreshPromise = (async () => {
            const res = await fetch(`${SUPABASE_CONFIG.url}/auth/v1/token?grant_type=refresh_token`, {
                method: 'POST',
                headers: this.getHeaders(false),
                body: JSON.stringify({ refresh_token: this.session.refresh_token })
            });
            const data = await this.parseResponse(res) || {};
            if (res.ok && data.access_token) {
                if (!data.refresh_token) data.refresh_token = this.session.refresh_token;
                this.persistAuthSession(data);
                return data;
            }
            const error = new Error(data.message || data.error_description || `Refresh refusé (${res.status})`);
            error.status = res.status;
            throw error;
        })();
        try {
            return await this.refreshPromise;
        } finally {
            this.refreshPromise = null;
        }
    },

    async ensureAccessToken() {
        if (!this.session || !this.session.user) throw new Error('Non authentifié');
        const now = Math.floor(Date.now() / 1000);
        if (!this.session.expires_at || this.session.expires_at - now > 60) return this.session.access_token;
        try {
            const refreshed = await this.refreshToken();
            if (!refreshed) throw new Error('Session expirée');
            return refreshed.access_token;
        } catch (error) {
            // Une panne réseau conserve la session pour une nouvelle tentative hors ligne.
            if (error.status === 400 || error.status === 401 || error.status === 403) this.persistAuthSession(null);
            throw error;
        }
    },

    async signOut() {
        if (this.session && this.session.access_token) {
            try {
                await fetch(`${SUPABASE_CONFIG.url}/auth/v1/logout`, {
                    method: 'POST',
                    headers: this.getHeaders(true)
                });
            } catch (e) {
                console.warn("Logout error:", e);
            }
        }
        this.persistAuthSession(null);
    },

    // --- REQUÊTE REST GÉNÉRIQUE AVEC AUTO-REFRESH 401 ---
    async restRequest(endpoint, options = {}) {
        await this.ensureAccessToken();
        let headers = {
            ...this.getHeaders(true),
            ...(options.headers || {})
        };

        let res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/${endpoint}`, {
            ...options,
            headers
        });

        // Si 401 Unauthorized, tenter un refresh token une fois
        if (res.status === 401 && this.session && this.session.refresh_token) {
            let refreshed = null;
            try { refreshed = await this.refreshToken(); } catch (error) {
                if (error.status === 400 || error.status === 401 || error.status === 403) this.persistAuthSession(null);
                throw error;
            }
            if (refreshed) {
                headers = {
                    ...this.getHeaders(true),
                    ...(options.headers || {})
                };
                res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/${endpoint}`, {
                    ...options,
                    headers
                });
            }
        }

        if (res.status === 401) this.persistAuthSession(null);

        if (!res.ok) {
            const parsed = await this.parseResponse(res);
            const msg = (parsed && typeof parsed === 'object' && (parsed.message || parsed.hint || parsed.details || parsed.error_description)) || (typeof parsed === 'string' ? parsed : '') || `HTTP ${res.status}`;
            const err = new Error(msg);
            err.status = res.status;
            err.code = parsed ? parsed.code : null;
            throw err;
        }

        return await this.parseResponse(res);
    },

    // --- PROFILS CRUD ---
    async fetchProfiles() {
        if (!this.isAuthenticated()) return [];
        return await this.restRequest('profiles?select=*&order=created_at.asc');
    },

    async createProfile(profile) {
        if (!this.isAuthenticated()) throw new Error("Non authentifié");
        const user = this.getUser();
        const payload = {
            id: profile.id || createCycloDashId(),
            owner_id: user.id,
            display_name: profile.display_name.trim(),
            ftp_watts: parseInt(profile.ftp_watts) || 200,
            avatar_color: profile.avatar_color || '#3b82f6',
            is_archived: !!profile.is_archived,
            email_address: profile.email_address || null,
            email_auto_send: !!profile.email_auto_send,
            email_format: 'tcx',
            updated_at: profile.updated_at || new Date().toISOString()
        };
        const res = await this.restRequest('profiles', {
            method: 'POST',
            headers: { 'Prefer': 'return=representation' },
            body: JSON.stringify(payload)
        });
        return Array.isArray(res) ? res[0] : res;
    },

    async updateProfile(id, updates) {
        if (!this.isAuthenticated()) throw new Error("Non authentifié");
        const allowed = ['display_name', 'ftp_watts', 'avatar_color', 'is_archived', 'email_address', 'email_auto_send', 'email_format', 'updated_at'];
        const payload = {};
        allowed.forEach(key => { if (updates[key] !== undefined) payload[key] = updates[key]; });
        const res = await this.restRequest(`profiles?id=eq.${id}`, {
            method: 'PATCH',
            headers: { 'Prefer': 'return=representation' },
            body: JSON.stringify(payload)
        });
        return Array.isArray(res) ? res[0] : res;
    },

    async archiveProfile(id) {
        return await this.updateProfile(id, { is_archived: true });
    },

    async deleteProfile(id) {
        if (!this.isAuthenticated()) throw new Error("Non authentifié");
        return await this.restRequest(`profiles?id=eq.${id}`, {
            method: 'DELETE'
        });
    },

    async countSessionsForProfile(id) {
        const result = await this.restRequest(`sessions?profile_id=eq.${encodeURIComponent(id)}&select=id`);
        return Array.isArray(result) ? result.length : 0;
    },

    // --- SÉANCES & SÉRIES TEMPORELLES ---
    async saveSession(sessionSummary, detailedData = null) {
        if (!this.isAuthenticated()) throw new Error("Non authentifié");
        const user = this.getUser();

        const sessionPayload = {
            id: sessionSummary.id,
            owner_id: user.id,
            profile_id: sessionSummary.profile_id,
            started_at: sessionSummary.started_at,
            ended_at: sessionSummary.ended_at,
            duration_seconds: sessionSummary.duration_seconds,
            distance_meters: sessionSummary.distance_meters,
            avg_power_watts: sessionSummary.avg_power_watts,
            max_power_watts: sessionSummary.max_power_watts,
            avg_speed_kmh: sessionSummary.avg_speed_kmh,
            max_speed_kmh: sessionSummary.max_speed_kmh,
            total_work_kj: sessionSummary.total_work_kj,
            energy_kcal: sessionSummary.energy_kcal,
            workout_name: sessionSummary.workout_name || 'Roule Libre',
            ftp_at_session_watts: sessionSummary.ftp_at_session_watts || null,
            email_auto_requested: !!sessionSummary.email_auto_requested,
            email_recipient_snapshot: sessionSummary.email_recipient_snapshot || null
        };

        // 1. Sauvegarde idempotente du résumé de session (Upsert)
        await this.restRequest('sessions', {
            method: 'POST',
            headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
            body: JSON.stringify(sessionPayload)
        });

        // 2. Sauvegarde des séries temporelles complètes (si disponibles)
        if (detailedData && detailedData.time && detailedData.time.length > 0) {
            const dataPayload = {
                session_id: sessionSummary.id,
                owner_id: user.id,
                profile_id: sessionSummary.profile_id,
                data: detailedData
            };
            await this.restRequest('session_data', {
                method: 'POST',
                headers: { 'Prefer': 'resolution=merge-duplicates' },
                body: JSON.stringify(dataPayload)
            });
        }

        return sessionSummary;
    },

    async fetchSessions(profileId, limit = 50) {
        if (!this.isAuthenticated()) return [];
        return await this.restRequest(`sessions?profile_id=eq.${profileId}&order=started_at.desc&limit=${limit}`);
    },

    async fetchSessionData(sessionId) {
        if (!this.isAuthenticated()) return null;
        const res = await this.restRequest(`session_data?session_id=eq.${sessionId}&select=data`);
        if (Array.isArray(res) && res.length > 0) {
            return res[0].data;
        }
        return null;
    },

    async deleteSession(sessionId) {
        if (!this.isAuthenticated()) throw new Error("Non authentifié");
        const ownerId = this.getUser().id;
        return await this.restRequest(`sessions?id=eq.${encodeURIComponent(sessionId)}&owner_id=eq.${encodeURIComponent(ownerId)}`, {
            method: 'DELETE',
            headers: { 'Prefer': 'return=representation' }
        });
    },

    async invokeFunction(name, payload) {
        const accessToken = await this.ensureAccessToken();
        const response = await fetch(`${SUPABASE_CONFIG.url}/functions/v1/${encodeURIComponent(name)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_CONFIG.anonKey,
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify(payload)
        });
        const parsed = await this.parseResponse(response);
        if (!response.ok) {
            const error = new Error((parsed && (parsed.error || parsed.message)) || `Fonction ${name} indisponible (${response.status})`);
            error.status = response.status;
            throw error;
        }
        return parsed;
    },

    async fetchEmailDeliveries(sessionId) {
        if (!this.isAuthenticated()) return [];
        return await this.restRequest(`email_deliveries?session_id=eq.${encodeURIComponent(sessionId)}&select=*&order=created_at.desc`);
    }
};

// Initialisation dès le chargement du script
supabaseClient.init();
window.supabaseClient = supabaseClient;
