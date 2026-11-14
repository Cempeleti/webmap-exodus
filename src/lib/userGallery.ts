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

/**
 * Retrieves all custom shuttles from local storage.
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
 * Saves or updates a shuttle in the user gallery.
 */
export function saveToUserGallery(
	item: Omit<UserGalleryItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
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
				updatedAt: now
			};
			gallery[existingIndex] = updated;
			persistGallery(gallery);
			return updated;
		}
	}

	const newItem: UserGalleryItem = {
		...item,
		id: item.id || `ug_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
		createdAt: now,
		updatedAt: now
	};

	gallery.unshift(newItem);
	persistGallery(gallery);
	return newItem;
}

/**
 * Retrieves a single shuttle item by ID from the gallery.
 */
export function getUserGalleryItem(id: string): UserGalleryItem | undefined {
	const gallery = getUserGallery();
	return gallery.find((item) => item.id === id);
}

/**
 * Removes an item from the user gallery.
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
		console.error('Failed to save user gallery to localStorage:', e);
	}
}
