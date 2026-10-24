// --- STOCKAGE LOCAL ISOLÉ PAR COMPTE ---

const localDataStore = {
    getOwnerId() {
        const user = window.supabaseClient && window.supabaseClient.getUser();
        return user && user.id ? user.id : 'anonymous';
    },

    key(name, ownerId = this.getOwnerId()) {
        return `cyclodash:${ownerId}:${name}`;
    },

    getJSON(name, fallback = null, ownerId) {
        try {
            const raw = localStorage.getItem(this.key(name, ownerId));
            return raw === null ? fallback : JSON.parse(raw);
        } catch (error) {
            console.warn(`Lecture locale impossible (${name})`, error);
            return fallback;
        }
    },

    setJSON(name, value, ownerId) {
        try {
            localStorage.setItem(this.key(name, ownerId), JSON.stringify(value));
            return true;
        } catch (error) {
            console.error(`Stockage local impossible (${name})`, error);
            return false;
        }
    },

    remove(name, ownerId) {
        localStorage.removeItem(this.key(name, ownerId));
    },

    hasLegacyData() {
        return ['cyclodash_profiles', 'cyclodash_sessions_v2', 'cyclodash_sync_queue']
            .some(key => localStorage.getItem(key) !== null);
    },

    hasAnonymousData() {
        return (this.getJSON('profiles', [], 'anonymous').length > 0 || this.getJSON('sessions', [], 'anonymous').length > 0);
    },

    migrateAnonymousToCurrentAccount() {
        const ownerId = this.getOwnerId();
        if (ownerId === 'anonymous') return false;
        const mergeById = (target, source) => {
            const map = new Map(target.map(item => [item.id, item]));
            source.forEach(item => map.set(item.id, { ...item, owner_id: ownerId, sync_status: 'pending' }));
            return Array.from(map.values());
        };
        const profiles = mergeById(this.getJSON('profiles', []), this.getJSON('profiles', [], 'anonymous'));
        const anonymousDeletions = this.getJSON('deletion_queue', [], 'anonymous');
        const deletionQueue = mergeById(this.getJSON('deletion_queue', []), anonymousDeletions)
            .map(item => ({ ...item, owner_id: ownerId }));
        const deletedIds = new Set(deletionQueue.map(item => item.id));
        const sessions = mergeById(this.getJSON('sessions', []), this.getJSON('sessions', [], 'anonymous'))
            .filter(item => !deletedIds.has(item.id));
        const queue = Array.from(new Set([...this.getJSON('sync_queue', []), ...sessions.map(item => item.id)]));
        return this.setJSON('profiles', profiles)
            && this.setJSON('sessions', sessions)
            && this.setJSON('sync_queue', queue)
            && this.setJSON('deletion_queue', deletionQueue);
    },

    migrateLegacyToCurrentAccount() {
        if (this.getOwnerId() === 'anonymous') return false;
        const mappings = [
            ['cyclodash_profiles', 'profiles'],
            ['cyclodash_sessions_v2', 'sessions'],
            ['cyclodash_sync_queue', 'sync_queue'],
            ['cyclodash_active_profile_id', 'active_profile_id'],
            ['cyclodash_legacy_migrated', 'legacy_migrated']
        ];
        for (const [legacyKey, newName] of mappings) {
            const raw = localStorage.getItem(legacyKey);
            if (raw === null || localStorage.getItem(this.key(newName)) !== null) continue;
            try {
                const value = newName === 'legacy_migrated' ? raw === 'true' : (newName.endsWith('_id') ? raw : JSON.parse(raw));
                if (!this.setJSON(newName, value)) return false;
            } catch (error) {
                console.warn(`Migration locale ignorée (${legacyKey})`, error);
            }
        }
        return true;
    }
};

const cycloDb = {
    dbPromise: null,

    open() {
        if (this.dbPromise) return this.dbPromise;
        if (!window.indexedDB) return Promise.reject(new Error('IndexedDB indisponible'));
        this.dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open('cyclodash-data-v2', 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'key' });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('Ouverture IndexedDB impossible'));
        });
        return this.dbPromise;
    },

    async put(kind, id, value, ownerId = localDataStore.getOwnerId()) {
        if (!window.indexedDB) {
            if (!localDataStore.setJSON(`${kind}:${id}`, value, ownerId)) throw new Error('Stockage de secours saturé');
            return true;
        }
        const db = await this.open();
        const key = `${ownerId}:${kind}:${id}`;
        return new Promise((resolve, reject) => {
            const tx = db.transaction('records', 'readwrite');
            tx.objectStore('records').put({ key, value, updated_at: new Date().toISOString() });
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error || new Error('Écriture IndexedDB impossible'));
            tx.onabort = () => reject(tx.error || new Error('Écriture IndexedDB annulée'));
        });
    },

    async get(kind, id, ownerId = localDataStore.getOwnerId()) {
        if (!window.indexedDB) return localDataStore.getJSON(`${kind}:${id}`, null, ownerId);
        const db = await this.open();
        const key = `${ownerId}:${kind}:${id}`;
        return new Promise((resolve, reject) => {
            const request = db.transaction('records', 'readonly').objectStore('records').get(key);
            request.onsuccess = () => resolve(request.result ? request.result.value : null);
            request.onerror = () => reject(request.error || new Error('Lecture IndexedDB impossible'));
        });
    },

    async remove(kind, id) {
        if (!window.indexedDB) {
            localDataStore.remove(`${kind}:${id}`);
            return true;
        }
        const db = await this.open();
        const key = `${localDataStore.getOwnerId()}:${kind}:${id}`;
        return new Promise((resolve, reject) => {
            const tx = db.transaction('records', 'readwrite');
            tx.objectStore('records').delete(key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error || new Error('Suppression IndexedDB impossible'));
        });
    }
};

window.localDataStore = localDataStore;
window.cycloDb = cycloDb;
