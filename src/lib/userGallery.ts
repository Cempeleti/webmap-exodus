export interface UserGalleryItem {
	id: string;
	name: string;
	description: string;
	createdAt: string;
	updatedAt: string;
	baseShuttleId?: string;
	tileWidth: number;
	tileHeight: number;
	entityCount: number;
	size: 'micro' | 'small' | 'medium' | 'large';
	hullClass: string;
	image: string; // dataUrl or remote url
	yamlContent?: string;
	shareUrl?: string;
	shareExpiresAt?: string;
}

const STORAGE_KEY = 'webmap_user_gallery';
const IDB_NAME = 'webmap_exodus_gallery';
const IDB_VERSION = 1;
const IDB_STORE = 'user_shuttles';

function openGalleryDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (typeof indexedDB === 'undefined') {
			reject(new Error('IndexedDB unavailable'));
			return;
		}
		const req = indexedDB.open(IDB_NAME, IDB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(IDB_STORE)) {
				db.createObjectStore(IDB_STORE, { keyPath: 'id' });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
	});
}

async function idbGetAll(): Promise<UserGalleryItem[]> {
	const db = await openGalleryDb();
	try {
		return await new Promise((resolve, reject) => {
			const tx = db.transaction(IDB_STORE, 'readonly');
			const store = tx.objectStore(IDB_STORE);
			const req = store.getAll();
			req.onsuccess = () => {
				const rows = Array.isArray(req.result) ? (req.result as UserGalleryItem[]) : [];
				rows.sort(
					(a, b) =>
						new Date(b.updatedAt || b.createdAt).getTime() -
						new Date(a.updatedAt || a.createdAt).getTime()
				);
				resolve(rows);
			};
			req.onerror = () => reject(req.error);
		});
	} finally {
		db.close();
	}
}

async function idbPut(item: UserGalleryItem): Promise<void> {
	const db = await openGalleryDb();
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(IDB_STORE, 'readwrite');
			tx.objectStore(IDB_STORE).put(item);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	} finally {
		db.close();
	}
}

async function idbDelete(id: string): Promise<void> {
	const db = await openGalleryDb();
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(IDB_STORE, 'readwrite');
			tx.objectStore(IDB_STORE).delete(id);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	} finally {
		db.close();
	}
}

/**
 * Retrieves all custom shuttles from localStorage (sync fallback).
 */
export function getUserGallery(): UserGalleryItem[] {
	if (typeof window === 'undefined' || !window.localStorage) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch (e) {
		console.error('Failed to read user gallery from localStorage:', e);
		return [];
	}
}

/**
 * Retrieves all custom shuttles from IndexedDB (migrating any legacy localStorage items).
 */
export async function getUserGalleryAsync(): Promise<UserGalleryItem[]> {
	const legacy = getUserGallery();
	try {
		const existing = await idbGetAll();
		const existingIds = new Set(existing.map((i) => i.id));
		let migrated = false;
		for (const item of legacy) {
			if (item?.id && !existingIds.has(item.id)) {
				await idbPut(item);
				existing.push(item);
				migrated = true;
			}
		}
		if (migrated) {
			existing.sort(
				(a, b) =>
					new Date(b.updatedAt || b.createdAt).getTime() -
					new Date(a.updatedAt || a.createdAt).getTime()
			);
		}
		return existing;
	} catch {
		return legacy;
	}
}

/**
 * Saves or updates a shuttle in the user gallery (IndexedDB primary + localStorage best-effort).
 */
export async function saveToUserGalleryAsync(
	item: Omit<UserGalleryItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<UserGalleryItem> {
	const gallery = await getUserGalleryAsync();
	const now = new Date().toISOString();

	let saved: UserGalleryItem;
	if (item.id) {
		const existing = gallery.find((g) => g.id === item.id);
		if (existing) {
			saved = {
				...existing,
				...item,
				id: item.id,
				updatedAt: now
			};
		} else {
			saved = {
				...item,
				id: item.id,
				createdAt: now,
				updatedAt: now
			};
		}
	} else {
		saved = {
			...item,
			id: `ug_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
			createdAt: now,
			updatedAt: now
		};
	}

	try {
		await idbPut(saved);
	} catch (e) {
		console.warn('IndexedDB save failed, falling back to localStorage:', e);
	}

	// Best-effort localStorage sync for small items
	saveToUserGallery(saved);

	if (typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent('webmap:gallery_updated', { detail: { item: saved } }));
	}
	return saved;
}

/**
 * Saves or updates a shuttle in localStorage (sync helper).
 */
export function saveToUserGallery(
	item: Omit<UserGalleryItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string; createdAt?: string; updatedAt?: string }
): UserGalleryItem {
	const gallery = getUserGallery();
	const now = new Date().toISOString();

	if (item.id) {
		const existingIndex = gallery.findIndex((g) => g.id === item.id);
		if (existingIndex >= 0) {
			const updated: UserGalleryItem = {
				...gallery[existingIndex],
				...item,
				id: item.id,
				updatedAt: item.updatedAt || now
			};
			gallery[existingIndex] = updated;
			persistGallery(gallery);
			return updated;
		}
	}

	const newItem: UserGalleryItem = {
		...item,
		id: item.id || `ug_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
		createdAt: item.createdAt || now,
		updatedAt: item.updatedAt || now
	};

	gallery.unshift(newItem);
	persistGallery(gallery);
	return newItem;
}

/**
 * Retrieves a single shuttle item by ID from the gallery (sync).
 */
export function getUserGalleryItem(id: string): UserGalleryItem | undefined {
	const gallery = getUserGallery();
	return gallery.find((item) => item.id === id);
}

/**
 * Retrieves a single shuttle item by ID from IndexedDB + localStorage fallback.
 */
export async function getUserGalleryItemAsync(id: string): Promise<UserGalleryItem | undefined> {
	const gallery = await getUserGalleryAsync();
	return gallery.find((item) => item.id === id);
}

/**
 * Removes an item from the user gallery (IndexedDB + localStorage).
 */
export async function deleteFromUserGalleryAsync(id: string): Promise<void> {
	try {
		await idbDelete(id);
	} catch {}
	deleteFromUserGallery(id);
}

/**
 * Removes an item from the user gallery (sync).
 */
export function deleteFromUserGallery(id: string): void {
	const gallery = getUserGallery();
	const filtered = gallery.filter((item) => item.id !== id);
	persistGallery(filtered);
}

/**
 * Persists the gallery array into localStorage and dispatches a notification event.
 */
function persistGallery(gallery: UserGalleryItem[]): void {
	if (typeof window === 'undefined' || !window.localStorage) return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(gallery));
		window.dispatchEvent(new CustomEvent('webmap:gallery_updated', { detail: { count: gallery.length } }));
	} catch (e) {
		console.warn('localStorage quota exceeded for user gallery (stored in IndexedDB):', e);
	}
}
