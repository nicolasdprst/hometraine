// --- GESTION MULTI-PROFILS POUR CYCLODASH ---

const PROFILE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];

function createCycloDashId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validProfileColor(color) {
    return PROFILE_COLORS.includes(color) ? color : PROFILE_COLORS[0];
}

window.createCycloDashId = createCycloDashId;

const profilesManager = {
    profiles: [],
    activeProfile: null,
    lastProfileId: null,
    selectionRequired: true,

    // Initialisation au chargement
    async init() {
        this.loadLocalProfiles();
        
        // Si Supabase est authentifié, synchroniser les profils depuis le cloud
        if (window.supabaseClient && window.supabaseClient.isAuthenticated()) {
            try {
                await this.syncFromSupabase();
            } catch (err) {
                console.warn("Synchronisation profils Supabase différée:", err);
            }
        }

        // Si aucun profil n'existe (ni local ni distant), créer un profil par défaut invité
        if (this.profiles.length === 0) {
            const defaultProfile = {
                id: createCycloDashId(),
                display_name: 'Cycliste 1',
                ftp_watts: state.ftp || 200,
                avatar_color: '#3b82f6',
                is_archived: false,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                owner_id: localDataStore.getOwnerId() === 'anonymous' ? null : localDataStore.getOwnerId(),
                sync_status: 'pending'
            };
            this.profiles.push(defaultProfile);
            this.saveLocalProfiles();
            if (window.supabaseClient && window.supabaseClient.isAuthenticated()) {
                window.supabaseClient.createProfile(defaultProfile).catch(e => console.warn(e));
            }
        }

        // Le dernier profil sert uniquement de repère visuel : aucun cycliste
        // n'est restauré automatiquement après un lancement/rechargement.
        this.lastProfileId = localDataStore.getJSON('active_profile_id', null);
        this.activeProfile = null;
        state.activeProfile = null;
        this.selectionRequired = true;
        this.renderProfilesListInSettings();
        this.updateProfileBadgeUI();
        this.showPicker(true);
    },

    loadLocalProfiles() {
        const ownerId = localDataStore.getOwnerId();
        this.profiles = localDataStore.getJSON('profiles', []).map(profile => ({
            ...profile,
            avatar_color: validProfileColor(profile.avatar_color),
            owner_id: ownerId === 'anonymous' ? null : ownerId,
            sync_status: profile.sync_status || 'pending',
            updated_at: profile.updated_at || profile.created_at || new Date(0).toISOString()
        }));
    },

    saveLocalProfiles() {
        if (!localDataStore.setJSON('profiles', this.profiles)) throw new Error('Stockage local des profils saturé');
    },

    async syncFromSupabase() {
        if (!window.supabaseClient || !window.supabaseClient.isAuthenticated()) return;
        const ownerId = window.supabaseClient.getUser().id;
        const remoteProfiles = await window.supabaseClient.fetchProfiles();
        const remoteMap = new Map((remoteProfiles || []).map(profile => [profile.id, profile]));
        const reconciled = [];

        for (const local of this.profiles) {
            if (local.owner_id && local.owner_id !== ownerId) continue;
            const remote = remoteMap.get(local.id);
            try {
                if (!remote) {
                    const created = await window.supabaseClient.createProfile(local);
                    reconciled.push({ ...(created || local), owner_id: ownerId, sync_status: 'synced' });
                } else {
                    const localTime = Date.parse(local.updated_at || 0) || 0;
                    const remoteTime = Date.parse(remote.updated_at || 0) || 0;
                    if (local.sync_status !== 'synced' && localTime > remoteTime) {
                        const updated = await window.supabaseClient.updateProfile(local.id, local);
                        reconciled.push({ ...(updated || local), owner_id: ownerId, sync_status: 'synced' });
                    } else {
                        reconciled.push({ ...remote, owner_id: ownerId, sync_status: 'synced' });
                    }
                }
            } catch (error) {
                local.sync_status = 'pending';
                local.sync_error = error.message;
                reconciled.push(local);
            }
            remoteMap.delete(local.id);
        }
        remoteMap.forEach(remote => reconciled.push({ ...remote, owner_id: ownerId, sync_status: 'synced' }));
        this.profiles = reconciled;
        this.saveLocalProfiles();
        this.renderProfilesListInSettings();
    },

    async handleAccountChange(offerLegacyMigration = false) {
        this.profiles = [];
        this.activeProfile = null;
        state.activeProfile = null;
        const hasImportable = localDataStore.hasLegacyData() || localDataStore.hasAnonymousData();
        if (offerLegacyMigration && hasImportable && confirm('Importer volontairement les données locales anonymes ou anciennes dans ce compte ?')) {
            const migrated = (!localDataStore.hasLegacyData() || localDataStore.migrateLegacyToCurrentAccount())
                && (!localDataStore.hasAnonymousData() || localDataStore.migrateAnonymousToCurrentAccount());
            if (!migrated) {
                alert('Certaines données locales n’ont pas pu être importées. Les originaux sont conservés.');
            } else {
                const sessions = localDataStore.getJSON('sessions', []);
                for (const session of sessions) {
                    const raw = localStorage.getItem(`cyclodash_raw_${session.id}`);
                    try {
                        const anonymousData = await cycloDb.get('session-data', session.id, 'anonymous').catch(() => null);
                        if (anonymousData) await cycloDb.put('session-data', session.id, anonymousData);
                        else if (raw) await cycloDb.put('session-data', session.id, JSON.parse(raw));
                    } catch (error) { console.warn(`Mesures historiques non migrées (${session.id})`, error); }
                }
            }
        }
        await this.init();
    },

    // Appliquer un profil actif
    applyProfile(profile, shouldRenderHistory = true) {
        if (state.isRecording) {
            alert("Impossible de changer de profil pendant une séance en cours. Terminez la séance d'abord.");
            return false;
        }

        this.activeProfile = profile;
        state.activeProfile = profile;
        this.lastProfileId = profile.id;
        this.selectionRequired = false;
        localDataStore.setJSON('active_profile_id', profile.id);

        // Appliquer la FTP du profil
        state.ftp = profile.ftp_watts || 200;
        localStorage.setItem('userFTP', state.ftp);
        const ftpInput = document.getElementById('ftpInput');
        if (ftpInput) ftpInput.value = state.ftp;
        if (window.updateZonesDisplay) window.updateZonesDisplay();

        // Mettre à jour les indicateurs visuels du profil dans l'interface
        this.updateProfileBadgeUI();

        // Masquer l'overlay de sélection
        this.hidePicker();

        // Fermer la fiche d'analyse si elle était ouverte
        if (window.SessionDetail && typeof window.SessionDetail.close === 'function') {
            window.SessionDetail.close();
        }

        // Rafraîchir l'historique filtré par ce profil
        if (shouldRenderHistory && window.renderHistory) {
            window.renderHistory();
        }

        return true;
    },

    // Mise à jour des badges dans l'interface (Compteur topbar & Header)
    updateProfileBadgeUI() {
        const p = this.activeProfile;

        // Badge dans le mode Compteur
        const kioskProfileBadge = document.getElementById('kioskProfileBadge');
        const kioskProfileName = document.getElementById('kioskProfileName');
        const kioskProfileAvatar = document.getElementById('kioskProfileAvatar');

        if (kioskProfileBadge) kioskProfileBadge.style.display = p ? 'flex' : 'none';
        if (kioskProfileName) {
            kioskProfileName.innerText = p ? p.display_name : 'Profil requis';
        }
        if (kioskProfileAvatar) {
            kioskProfileAvatar.style.backgroundColor = p ? validProfileColor(p.avatar_color) : '#475569';
            kioskProfileAvatar.innerText = p ? this.getInitials(p.display_name) : 'CD';
        }
        const kioskProfileFtp = document.getElementById('kioskProfileFtp');
        if (kioskProfileFtp) kioskProfileFtp.textContent = p ? `FTP ${p.ftp_watts || 200} W` : 'Sélection requise';

        const globalProfileAvatar = document.getElementById('globalProfileAvatar');
        const globalProfileName = document.getElementById('globalProfileName');
        const globalProfileFtp = document.getElementById('globalProfileFtp');
        if (globalProfileAvatar) {
            globalProfileAvatar.style.backgroundColor = p ? validProfileColor(p.avatar_color) : '#475569';
            globalProfileAvatar.textContent = p ? this.getInitials(p.display_name) : 'CD';
        }
        if (globalProfileName) globalProfileName.textContent = p ? p.display_name : 'Aucun profil';
        if (globalProfileFtp) globalProfileFtp.textContent = p ? `FTP ${p.ftp_watts || 200} W` : 'Sélection requise';

        const historyTitle = document.getElementById('historyTitle');
        const settingsTitle = document.getElementById('settingsTitle');
        if (historyTitle) historyTitle.textContent = p ? `Historique de ${p.display_name}` : 'Historique';
        if (settingsTitle) settingsTitle.textContent = p ? `Paramètres de ${p.display_name}` : 'Paramètres';

        const startLabel = p ? `▶ Démarrer — ${p.display_name}` : '▶ Sélectionner un profil';
        const startBtn = document.getElementById('startBtn');
        const kioskStartBtn = document.getElementById('kioskStartBtn');
        if (startBtn) startBtn.textContent = startLabel;
        if (kioskStartBtn) kioskStartBtn.textContent = startLabel;

        // Badge dans Paramètres
        const settingsCurrentProfile = document.getElementById('settingsCurrentProfile');
        if (settingsCurrentProfile) {
            settingsCurrentProfile.innerText = p ? `${p.display_name} · FTP ${p.ftp_watts || 200} W` : 'Aucun profil sélectionné';
        }
    },

    getInitials(name) {
        if (!name) return 'CD';
        const parts = name.trim().split(/\s+/);
        if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
        return (parts[0][0] + parts[1][0]).toUpperCase();
    },

    // Affichage / Masquage du sélecteur "Qui pédale aujourd'hui ?"
    showPicker(required = false) {
        if (state.isRecording) {
            alert("Impossible de changer de profil pendant une séance en cours. Terminez la séance d'abord.");
            return;
        }

        const overlay = document.getElementById('profilePickerOverlay');
        if (!overlay) return;

        if (required) this.selectionRequired = true;
        this.renderPickerCards();
        overlay.classList.toggle('selection-required', this.selectionRequired || !this.activeProfile);
        overlay.style.display = 'flex';
    },

    hidePicker() {
        if (this.selectionRequired || !this.activeProfile) return false;
        const overlay = document.getElementById('profilePickerOverlay');
        if (overlay) overlay.style.display = 'none';
        return true;
    },

    renderPickerCards() {
        const container = document.getElementById('pickerProfilesGrid');
        if (!container) return;
        container.innerHTML = '';

        const activeProfiles = this.profiles.filter(p => !p.is_archived);

        activeProfiles.forEach(p => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'profile-card' + (this.activeProfile && this.activeProfile.id === p.id ? ' active' : '');
            if (card.setAttribute) card.setAttribute('aria-label', `Choisir ${p.display_name}, FTP ${p.ftp_watts || 200} watts`);
            card.onclick = () => {
                this.applyProfile(p, true);
            };

            const avatar = document.createElement('div');
            avatar.className = 'profile-avatar';
            avatar.style.backgroundColor = validProfileColor(p.avatar_color);
            avatar.textContent = this.getInitials(p.display_name);
            const info = document.createElement('div');
            info.className = 'profile-info';
            const name = document.createElement('div');
            name.className = 'profile-name';
            name.textContent = p.display_name;
            const ftp = document.createElement('div');
            ftp.className = 'profile-ftp';
            ftp.textContent = `⚡ FTP : ${p.ftp_watts || 200} W`;
            info.append(name, ftp);
            card.append(avatar, info);
            if (!this.activeProfile && this.lastProfileId === p.id) {
                const active = document.createElement('span');
                active.className = 'profile-active-tag';
                active.textContent = 'Dernier utilisé';
                card.appendChild(active);
            }
            container.appendChild(card);
        });
    },

    // Gestion CRUD
    async createProfile(name, ftp, color) {
        if (!name || !name.trim()) throw new Error("Le nom du profil est requis");

        const newProfile = {
            id: createCycloDashId(),
            display_name: name.trim(),
            ftp_watts: parseInt(ftp) || 200,
            avatar_color: validProfileColor(color),
            is_archived: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            owner_id: localDataStore.getOwnerId() === 'anonymous' ? null : localDataStore.getOwnerId(),
            sync_status: 'pending'
        };

        this.profiles.push(newProfile);
        this.saveLocalProfiles();

        if (window.supabaseClient && window.supabaseClient.isAuthenticated()) {
            try {
                const remote = await window.supabaseClient.createProfile(newProfile);
                if (remote && remote.id) {
                    newProfile.owner_id = window.supabaseClient.getUser().id;
                    newProfile.sync_status = 'synced';
                    this.saveLocalProfiles();
                }
            } catch (err) {
                console.warn("Profil créé localement, synchronisation différée:", err);
            }
        }

        this.renderProfilesListInSettings();
        this.applyProfile(newProfile, true);
        return newProfile;
    },

    async updateProfile(id, updates) {
        const p = this.profiles.find(item => item.id === id);
        if (!p) throw new Error("Profil introuvable");

        if (updates.display_name) p.display_name = updates.display_name.trim();
        if (updates.ftp_watts) p.ftp_watts = parseInt(updates.ftp_watts) || 200;
        if (updates.avatar_color) p.avatar_color = validProfileColor(updates.avatar_color);
        if (typeof updates.is_archived === 'boolean') p.is_archived = updates.is_archived;
        p.updated_at = new Date().toISOString();
        p.sync_status = 'pending';

        this.saveLocalProfiles();

        if (window.supabaseClient && window.supabaseClient.isAuthenticated()) {
            try {
                await window.supabaseClient.updateProfile(id, updates);
                p.sync_status = 'synced';
                this.saveLocalProfiles();
            } catch (err) {
                console.warn("Mise à jour profil Supabase différée:", err);
            }
        }

        if (this.activeProfile && this.activeProfile.id === id) {
            this.applyProfile(p, true);
        }

        this.renderProfilesListInSettings();
        return p;
    },

    async archiveProfile(id) {
        if (this.profiles.filter(p => !p.is_archived).length <= 1) {
            throw new Error("Impossible d'archiver le seul profil actif");
        }
        await this.updateProfile(id, { is_archived: true });

        // Si le profil actif vient d'être archivé, exiger un nouveau choix.
        if (this.activeProfile && this.activeProfile.id === id) {
            this.activeProfile = null;
            state.activeProfile = null;
            this.updateProfileBadgeUI();
            this.showPicker(true);
        }
    },

    async restoreProfile(id) {
        await this.updateProfile(id, { is_archived: false });
    },

    async deleteProfile(id) {
        const p = this.profiles.find(item => item.id === id);
        if (!p) return;

        const localSessions = localDataStore.getJSON('sessions', []).filter(session => session.profile_id === id).length;
        if (!window.supabaseClient || !window.supabaseClient.isAuthenticated()) {
            throw new Error('Suppression définitive impossible hors ligne. Utilisez l’archivage.');
        }
        const remoteSessions = await window.supabaseClient.countSessionsForProfile(id);
        const sessionCount = Math.max(localSessions, remoteSessions);
        if (sessionCount > 0) throw new Error(`Ce profil possède ${sessionCount} séance(s). Archivez-le pour préserver son historique.`);
        if (!confirm(`Supprimer définitivement le profil "${p.display_name}" sans séance ? Cette action est irréversible.`)) return;

        // La suppression locale n'arrive qu'après confirmation serveur.
        await window.supabaseClient.deleteProfile(id);
        this.profiles = this.profiles.filter(item => item.id !== id);
        this.saveLocalProfiles();

        if (this.activeProfile && this.activeProfile.id === id) {
            this.activeProfile = null;
            state.activeProfile = null;
            this.updateProfileBadgeUI();
            this.showPicker(true);
        }

        this.renderProfilesListInSettings();
    },

    // Rendu de la liste des profils dans l'onglet Paramètres
    renderProfilesListInSettings() {
        const listEl = document.getElementById('settingsProfilesList');
        if (!listEl) return;
        listEl.innerHTML = '';

        this.profiles.forEach(p => {
            const row = document.createElement('div');
            row.className = 'list-item profile-settings-row' + (p.is_archived ? ' profile-archived' : '');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.justifyContent = 'space-between';
            row.style.gap = '0.75rem';

            const identity = document.createElement('div');
            identity.style.cssText = 'display:flex;align-items:center;gap:0.6rem';
            const avatar = document.createElement('div');
            avatar.style.cssText = `width:34px;height:34px;border-radius:50%;background-color:${validProfileColor(p.avatar_color)};color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:0.8rem`;
            avatar.textContent = this.getInitials(p.display_name);
            const labels = document.createElement('div');
            const name = document.createElement('div');
            name.style.cssText = 'font-weight:600;color:var(--text-primary);font-size:0.95rem';
            name.textContent = p.display_name + (p.is_archived ? ' (archivé)' : '');
            const ftp = document.createElement('div');
            ftp.style.cssText = 'font-size:0.8rem;color:var(--text-secondary)';
            ftp.textContent = `⚡ FTP : ${p.ftp_watts || 200} W · ${p.sync_status === 'synced' ? '☁️' : '⏳'}`;
            labels.append(name, ftp);
            identity.append(avatar, labels);

            const actions = document.createElement('div');
            actions.style.cssText = 'display:flex;gap:0.35rem';
            const addButton = (label, classes, handler) => {
                const button = document.createElement('button');
                button.className = classes;
                button.textContent = label;
                button.onclick = () => Promise.resolve(handler()).catch(error => alert(error.message));
                actions.appendChild(button);
            };
            addButton('✏️ Modifier', 'btn btn-sm btn-primary', () => this.showProfileForm(p.id));
            if (p.is_archived) addButton('♻️ Restaurer', 'btn btn-sm btn-secondary', () => this.restoreProfile(p.id));
            else addButton('📦 Archiver', 'btn btn-sm btn-secondary', () => this.archiveProfile(p.id));
            addButton('🗑️', 'btn btn-sm btn-danger', () => this.deleteProfile(p.id));
            row.append(identity, actions);
            listEl.appendChild(row);
        });
    },

    // Affichage du formulaire intégré tactile
    showProfileForm(editId = null) {
        if (state.isRecording) {
            alert("Action impossible pendant une séance.");
            return;
        }

        const box = document.getElementById('profileFormBox');
        const defaultBtns = document.getElementById('pickerDefaultButtons');
        const titleEl = document.getElementById('profileFormTitle');
        const editIdInput = document.getElementById('profileFormEditId');
        const nameInput = document.getElementById('profileFormNameInput');
        const ftpInput = document.getElementById('profileFormFtpInput');

        if (!box) return;

        // S'assurer que le sélecteur overlay est ouvert
        const overlay = document.getElementById('profilePickerOverlay');
        if (overlay) overlay.style.display = 'flex';

        if (editId) {
            const p = this.profiles.find(item => item.id === editId);
            if (!p) return;
            if (titleEl) titleEl.innerText = `Modifier le profil "${p.display_name}"`;
            if (editIdInput) editIdInput.value = editId;
            if (nameInput) nameInput.value = p.display_name;
            if (ftpInput) ftpInput.value = p.ftp_watts || 200;
            this.selectFormColor(p.avatar_color || '#3b82f6');
        } else {
            if (titleEl) titleEl.innerText = "Nouveau Profil Cycliste";
            if (editIdInput) editIdInput.value = "";
            if (nameInput) nameInput.value = "";
            if (ftpInput) ftpInput.value = 200;
            const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
            this.selectFormColor(colors[Math.floor(Math.random() * colors.length)]);
        }

        this.initColorPickers();
        box.style.display = 'block';
        if (defaultBtns) defaultBtns.style.display = 'none';
        if (nameInput) nameInput.focus();
    },

    hideProfileForm() {
        const box = document.getElementById('profileFormBox');
        const defaultBtns = document.getElementById('pickerDefaultButtons');
        if (box) box.style.display = 'none';
        if (defaultBtns) defaultBtns.style.display = 'flex';
    },

    initColorPickers() {
        const dots = document.querySelectorAll('#profileFormColorOptions .color-dot');
        dots.forEach(dot => {
            dot.onclick = () => {
                const color = dot.getAttribute('data-color');
                this.selectFormColor(color);
            };
        });
    },

    selectFormColor(selectedColor) {
        const dots = document.querySelectorAll('#profileFormColorOptions .color-dot');
        dots.forEach(d => {
            if (d.getAttribute('data-color') === selectedColor) {
                d.style.border = '2px solid #ffffff';
                d.classList.add('active');
            } else {
                d.style.border = 'none';
                d.classList.remove('active');
            }
        });
    },

    getSelectedFormColor() {
        const activeDot = document.querySelector('#profileFormColorOptions .color-dot.active');
        return activeDot ? activeDot.getAttribute('data-color') : '#3b82f6';
    },

    async submitProfileForm() {
        const editIdInput = document.getElementById('profileFormEditId');
        const nameInput = document.getElementById('profileFormNameInput');
        const ftpInput = document.getElementById('profileFormFtpInput');

        const editId = editIdInput ? editIdInput.value : '';
        const name = nameInput ? nameInput.value.trim() : '';
        const ftp = ftpInput ? parseInt(ftpInput.value) || 200 : 200;
        const color = this.getSelectedFormColor();

        if (!name) {
            alert("Veuillez renseigner un prénom ou nom pour le profil.");
            return;
        }

        try {
            if (editId) {
                await this.updateProfile(editId, { display_name: name, ftp_watts: ftp, avatar_color: color });
            } else {
                await this.createProfile(name, ftp, color);
            }
            this.hideProfileForm();
            this.renderPickerCards();
        } catch (err) {
            alert(`Erreur : ${err.message}`);
        }
    }
};

window.profilesManager = profilesManager;
