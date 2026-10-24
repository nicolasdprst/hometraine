// --- CLIENT SUPABASE REST & AUTHENTIFICATION NATIF (ZÉRO DÉPENDANCE) ---
// Conçu pour Chrome 119 et Android 7 : léger, robuste et 100% standard

const SUPABASE_CONFIG = {
    url: 'https://vwdptlmmycpxobucctnj.supabase.co',
    anonKey: 'sb_publishable_dr8rEtZLflaLNXzlpUg4ww_xcfpzSoF'
};

const supabaseClient = {
    session: null,

    init() {
        try {
            const saved = localStorage.getItem('cyclodash_supabase_session');
            if (saved) {
                this.session = JSON.parse(saved);
                // Si le token expire bientôt (dans les 10 min), tenter un refresh
                if (this.session && this.session.expires_at) {
                    const nowSec = Math.floor(Date.now() / 1000);
                    if (this.session.expires_at - nowSec < 600) {
                        this.refreshToken().catch(e => console.warn('Refresh token silencieux ignoré:', e));
                    }
                }
            }
        } catch (e) {
            console.error("Erreur lecture session Supabase locale:", e);
        }
    },

    saveSession(sess) {
        this.session = sess;
        if (sess) {
            localStorage.setItem('cyclodash_supabase_session', JSON.stringify(sess));
        } else {
            localStorage.removeItem('cyclodash_supabase_session');
        }
    },

    isAuthenticated() {
        return !!(this.session && this.session.access_token && this.session.user);
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
        } else {
            headers['Authorization'] = `Bearer ${SUPABASE_CONFIG.anonKey}`;
        }
        return headers;
    },

    // --- AUTHENTIFICATION ---
    async signUp(email, password) {
        const res = await fetch(`${SUPABASE_CONFIG.url}/auth/v1/signup`, {
            method: 'POST',
            headers: this.getHeaders(false),
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error_description || data.message || "Erreur d'inscription");
        
        // Si session retournée immédiatement (email auto-confirmé)
        if (data.access_token) {
            this.saveSession(data);
        }
        return data;
    },

    async signIn(email, password) {
        const res = await fetch(`${SUPABASE_CONFIG.url}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: this.getHeaders(false),
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error_description || data.message || "Identifiants invalides");
        this.saveSession(data);
        return data;
    },

    async refreshToken() {
        if (!this.session || !this.session.refresh_token) return null;
        try {
            const res = await fetch(`${SUPABASE_CONFIG.url}/auth/v1/token?grant_type=refresh_token`, {
                method: 'POST',
                headers: this.getHeaders(false),
                body: JSON.stringify({ refresh_token: this.session.refresh_token })
            });
            const data = await res.json();
            if (res.ok && data.access_token) {
                this.saveSession(data);
                return data;
            }
        } catch (err) {
            console.warn("Échec refresh token Supabase:", err);
        }
        return null;
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
        this.saveSession(null);
    },

    // --- REQUÊTE REST GÉNÉRIQUE AVEC AUTO-REFRESH 401 ---
    async restRequest(endpoint, options = {}) {
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
            const refreshed = await this.refreshToken();
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

        if (!res.ok) {
            let errorText = await res.text();
            let parsed = null;
            try { parsed = JSON.parse(errorText); } catch(e) {}
            const msg = (parsed && (parsed.message || parsed.hint || parsed.details)) || errorText || `HTTP ${res.status}`;
            const err = new Error(msg);
            err.status = res.status;
            err.code = parsed ? parsed.code : null;
            throw err;
        }

        // Si la réponse n'a pas de contenu (204 No Content)
        if (res.status === 204) return null;
        return await res.json();
    },

    // --- PROFILS CRUD ---
    async fetchProfiles() {
        if (!this.isAuthenticated()) return [];
        return await this.restRequest('profiles?select=*&is_archived=eq.false&order=created_at.asc');
    },

    async createProfile(profile) {
        if (!this.isAuthenticated()) throw new Error("Non authentifié");
        const user = this.getUser();
        const payload = {
            id: profile.id || crypto.randomUUID(),
            owner_id: user.id,
            display_name: profile.display_name.trim(),
            ftp_watts: parseInt(profile.ftp_watts) || 200,
            avatar_color: profile.avatar_color || '#3b82f6',
            is_archived: false
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
        const res = await this.restRequest(`profiles?id=eq.${id}`, {
            method: 'PATCH',
            headers: { 'Prefer': 'return=representation' },
            body: JSON.stringify(updates)
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
            workout_name: sessionSummary.workout_name || 'Roule Libre'
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
        return await this.restRequest(`sessions?id=eq.${sessionId}`, {
            method: 'DELETE'
        });
    }
};

// Initialisation dès le chargement du script
supabaseClient.init();
window.supabaseClient = supabaseClient;
