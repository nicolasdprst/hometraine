// --- GESTION MULTI-PROFILS POUR CYCLODASH ---

const profilesManager = {
    profiles: [],
    activeProfile: null,

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
                created_at: new Date().toISOString()
            };
            this.profiles.push(defaultProfile);
            this.saveLocalProfiles();
            if (window.supabaseClient && window.supabaseClient.isAuthenticated()) {
                window.supabaseClient.createProfile(defaultProfile).catch(e => console.warn(e));
            }
        }

        // Restaurer le profil précédemment actif
        const savedActiveId = localStorage.getItem('cyclodash_active_profile_id');
        let selected = this.profiles.find(p => p.id === savedActiveId && !p.is_archived);
        if (!selected && this.profiles.length > 0) {
            selected = this.profiles.find(p => !p.is_archived) || this.profiles[0];
        }

        if (selected) {
            this.applyProfile(selected, false);
        } else {
            this.showPicker();
        }

        this.renderProfilesListInSettings();
    },

    loadLocalProfiles() {
        try {
            const raw = localStorage.getItem('cyclodash_profiles');
            if (raw) {
                this.profiles = JSON.parse(raw);
            }
        } catch (e) {
            console.error("Erreur lecture cyclodash_profiles:", e);
            this.profiles = [];
        }
    },

    saveLocalProfiles() {
        try {
            localStorage.setItem('cyclodash_profiles', JSON.stringify(this.profiles));
        } catch (e) {
            console.error("Erreur écriture cyclodash_profiles:", e);
        }
    },

    async syncFromSupabase() {
        if (!window.supabaseClient || !window.supabaseClient.isAuthenticated()) return;
        const remoteProfiles = await window.supabaseClient.fetchProfiles();
        if (Array.isArray(remoteProfiles) && remoteProfiles.length > 0) {
            // Fusionner avec les profils locaux (les distants priment s'ils existent)
            const map = new Map();
            remoteProfiles.forEach(p => map.set(p.id, p));
            this.profiles.forEach(p => {
                if (!map.has(p.id)) map.set(p.id, p);
            });
            this.profiles = Array.from(map.values());
            this.saveLocalProfiles();
            this.renderProfilesListInSettings();
        }
    },

    // Appliquer un profil actif
    applyProfile(profile, shouldRenderHistory = true) {
        if (state.isRecording) {
            alert("Impossible de changer de profil pendant une séance en cours. Terminez la séance d'abord.");
            return false;
        }

        this.activeProfile = profile;
        state.activeProfile = profile;
        localStorage.setItem('cyclodash_active_profile_id', profile.id);

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

        // Rafraîchir l'historique filtré par ce profil
        if (shouldRenderHistory && window.renderHistory) {
            window.renderHistory();
        }

        return true;
    },

    // Mise à jour des badges dans l'interface (Compteur topbar & Header)
    updateProfileBadgeUI() {
        const p = this.activeProfile;
        if (!p) return;

        // Badge dans le mode Compteur
        const kioskProfileBadge = document.getElementById('kioskProfileBadge');
        const kioskProfileName = document.getElementById('kioskProfileName');
        const kioskProfileAvatar = document.getElementById('kioskProfileAvatar');

        if (kioskProfileBadge) {
            kioskProfileBadge.style.display = 'flex';
        }
        if (kioskProfileName) {
            kioskProfileName.innerText = p.display_name;
        }
        if (kioskProfileAvatar) {
            kioskProfileAvatar.style.backgroundColor = p.avatar_color || '#3b82f6';
            kioskProfileAvatar.innerText = this.getInitials(p.display_name);
        }

        // Badge dans Paramètres
        const settingsCurrentProfile = document.getElementById('settingsCurrentProfile');
        if (settingsCurrentProfile) {
            settingsCurrentProfile.innerText = `${p.display_name} (FTP: ${p.ftp_watts || 200} W)`;
        }
    },

    getInitials(name) {
        if (!name) return 'CD';
        const parts = name.trim().split(/\s+/);
        if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
        return (parts[0][0] + parts[1][0]).toUpperCase();
    },

    // Affichage / Masquage du sélecteur "Qui pédale aujourd'hui ?"
    showPicker() {
        if (state.isRecording) {
            alert("Impossible de changer de profil pendant une séance en cours. Terminez la séance d'abord.");
            return;
        }

        const overlay = document.getElementById('profilePickerOverlay');
        if (!overlay) return;

        this.renderPickerCards();
        overlay.style.display = 'flex';
    },

    hidePicker() {
        const overlay = document.getElementById('profilePickerOverlay');
        if (overlay) overlay.style.display = 'none';
    },

    renderPickerCards() {
        const container = document.getElementById('pickerProfilesGrid');
        if (!container) return;
        container.innerHTML = '';

        const activeProfiles = this.profiles.filter(p => !p.is_archived);

        activeProfiles.forEach(p => {
            const card = document.createElement('div');
            card.className = 'profile-card' + (this.activeProfile && this.activeProfile.id === p.id ? ' active' : '');
            card.onclick = () => {
                this.applyProfile(p, true);
            };

            card.innerHTML = `
                <div class="profile-avatar" style="background-color: ${p.avatar_color || '#3b82f6'};">
                    ${this.getInitials(p.display_name)}
                </div>
                <div class="profile-info">
                    <div class="profile-name">${p.display_name}</div>
                    <div class="profile-ftp">⚡ FTP : <strong>${p.ftp_watts || 200} W</strong></div>
                </div>
                ${this.activeProfile && this.activeProfile.id === p.id ? '<span class="profile-active-tag">Actif</span>' : ''}
            `;
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
            avatar_color: color || '#3b82f6',
            is_archived: false,
            created_at: new Date().toISOString()
        };

        this.profiles.push(newProfile);
        this.saveLocalProfiles();

        if (window.supabaseClient && window.supabaseClient.isAuthenticated()) {
            try {
                const remote = await window.supabaseClient.createProfile(newProfile);
                if (remote && remote.id) {
                    newProfile.id = remote.id;
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
        if (updates.avatar_color) p.avatar_color = updates.avatar_color;
        if (typeof updates.is_archived === 'boolean') p.is_archived = updates.is_archived;

        this.saveLocalProfiles();

        if (window.supabaseClient && window.supabaseClient.isAuthenticated()) {
            try {
                await window.supabaseClient.updateProfile(id, updates);
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

        // Si le profil actif vient d'être archivé, basculer sur un autre
        if (this.activeProfile && this.activeProfile.id === id) {
            const next = this.profiles.find(p => !p.is_archived);
            if (next) this.applyProfile(next, true);
        }
    },

    async deleteProfile(id) {
        const p = this.profiles.find(item => item.id === id);
        if (!p) return;

        // Compter les séances associées dans l'historique
        let sessionCount = 0;
        try {
            const rawHist = localStorage.getItem('cyclodash_sessions_v2') || '[]';
            const allSessions = JSON.parse(rawHist);
            sessionCount = allSessions.filter(s => s.profile_id === id).length;
        } catch(e) {}

        const confirmMsg = sessionCount > 0
            ? `Attention : le profil "${p.display_name}" possède ${sessionCount} séance(s) enregistrée(s).\n\nVoulez-vous vraiment supprimer définitivement ce profil et son historique ?`
            : `Voulez-vous supprimer définitivement le profil "${p.display_name}" ?`;

        if (!confirm(confirmMsg)) return;

        this.profiles = this.profiles.filter(item => item.id !== id);
        this.saveLocalProfiles();

        if (window.supabaseClient && window.supabaseClient.isAuthenticated()) {
            try {
                await window.supabaseClient.deleteProfile(id);
            } catch (err) {
                console.warn("Suppression profil Supabase différée:", err);
            }
        }

        if (this.activeProfile && this.activeProfile.id === id) {
            const next = this.profiles.find(item => !item.is_archived);
            if (next) this.applyProfile(next, true);
            else this.showPicker();
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
            row.className = 'list-item' + (p.is_archived ? ' profile-archived' : '');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.justifyContent = 'space-between';
            row.style.gap = '0.75rem';

            row.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.6rem;">
                    <div style="width: 34px; height: 34px; border-radius: 50%; background-color: ${p.avatar_color || '#3b82f6'}; color: #fff; font-weight: 700; display: flex; align-items: center; justify-content: center; font-size: 0.8rem;">
                        ${this.getInitials(p.display_name)}
                    </div>
                    <div>
                        <div style="font-weight: 600; color: var(--text-primary); font-size: 0.95rem;">
                            ${p.display_name} ${p.is_archived ? '<em style="font-size:0.75rem; color:var(--text-secondary);">(archivé)</em>' : ''}
                        </div>
                        <div style="font-size: 0.8rem; color: var(--text-secondary);">
                            ⚡ FTP : ${p.ftp_watts || 200} W
                        </div>
                    </div>
                </div>
                <div style="display: flex; gap: 0.35rem;">
                    <button class="btn btn-sm btn-primary" onclick="profilesManager.showProfileForm('${p.id}')">✏️ Modifier</button>
                    ${!p.is_archived ? `<button class="btn btn-sm btn-secondary" onclick="profilesManager.archiveProfile('${p.id}')">📦 Archiver</button>` : ''}
                    <button class="btn btn-sm btn-danger" onclick="profilesManager.deleteProfile('${p.id}')">🗑️</button>
                </div>
            `;
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
