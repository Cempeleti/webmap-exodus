import communityDataJson from '$lib/data/communityShuttles.json' with { type: 'json' };

export interface CommunityShuttle {
	id: string;
	name: string;
	author: string;
	description: string;
	createdAt: string;
	updatedAt?: string;
	tileWidth: number;
	tileHeight: number;
	entityCount: number;
	size: 'micro' | 'small' | 'medium' | 'large';
	hullClass: string;
	group?: string;
	image: string;
	tags: string[];
	mapPath?: string;
	yamlUrl?: string;
	yamlContent?: string;
	shareUrl?: string;
	shareExpiresAt?: string;
	likes?: number;
	featured?: boolean;
	isUserSubmission?: boolean;
}

export interface CommunityGalleryResponse {
	shuttles: CommunityShuttle[];
	configured: boolean;
	storageMode: string;
}

const SUBMISSIONS_STORAGE_KEY = 'webmap_community_submissions';
const LIKES_STORAGE_KEY = 'webmap_community_likes';
const DELETE_TOKENS_STORAGE_KEY = 'webmap_community_delete_tokens';
const VOTER_ID_STORAGE_KEY = 'webmap_voter_id';

function getDeleteTokens(): Record<string, string> {
	if (typeof window === 'undefined' || !window.localStorage) return {};
	try {
		const raw = localStorage.getItem(DELETE_TOKENS_STORAGE_KEY);
		const parsed = raw ? JSON.parse(raw) : {};
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

export function saveDeleteToken(id: string, token: string): void {
	if (typeof window === 'undefined' || !window.localStorage || !token) return;
	try {
		const tokens = getDeleteTokens();
		tokens[id] = token;
		localStorage.setItem(DELETE_TOKENS_STORAGE_KEY, JSON.stringify(tokens));
	} catch {}
}

export function getDeleteToken(id: string): string | undefined {
	return getDeleteTokens()[id];
}

export function getVoterId(): string {
	if (typeof window === 'undefined' || !window.localStorage) return 'anon';
	try {
		let id = localStorage.getItem(VOTER_ID_STORAGE_KEY);
		if (!id) {
			id = `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
			localStorage.setItem(VOTER_ID_STORAGE_KEY, id);
		}
		return id;
	} catch {
		return 'anon';
	}
}

export function canDeleteCommunityShuttle(item: CommunityShuttle): boolean {
	if (item.isUserSubmission) return true;
	return Boolean(getDeleteToken(item.id));
}

/**
 * Optimizes oversized PNG data URLs to high-quality WebP so uploads stay well under Vercel's 4.5MB limit.
 */
export async function optimizeImageForUpload(dataUrl: string): Promise<string> {
	if (!dataUrl || !dataUrl.startsWith('data:image/') || dataUrl.length <= 1_200_000) {
		return dataUrl;
	}
	if (typeof document === 'undefined') return dataUrl;
	try {
		const img = await new Promise<HTMLImageElement>((resolve, reject) => {
			const el = new Image();
			el.onload = () => resolve(el);
			el.onerror = reject;
			el.src = dataUrl;
		});
		const canvas = document.createElement('canvas');
		canvas.width = img.naturalWidth || img.width;
		canvas.height = img.naturalHeight || img.height;
		const ctx = canvas.getContext('2d');
		if (!ctx) return dataUrl;
		ctx.imageSmoothingEnabled = false;
		ctx.drawImage(img, 0, 0);
		const webp = canvas.toDataURL('image/webp', 0.92);
		return webp.startsWith('data:image/webp') && webp.length < dataUrl.length ? webp : dataUrl;
	} catch {
		return dataUrl;
	}
}

function getBundledShuttles(): CommunityShuttle[] {
	return (communityDataJson as any[]).map((item) => ({
		...item,
		tags: Array.isArray(item.tags) ? item.tags : [],
		likes: typeof item.likes === 'number' ? item.likes : 0,
		featured: Boolean(item.featured),
		isUserSubmission: false
	}));
}

/**
 * Retrieves local/bundled community shuttles synchronously.
 */
export function getCommunityShuttles(): CommunityShuttle[] {
	const bundled = getBundledShuttles();
	const userSubmissions = getUserSubmissions();
	const likedSet = getLikedIds();
	const tokens = getDeleteTokens();

	const all = [...userSubmissions, ...bundled];

	return all.map((item) => {
		const isLiked = likedSet.has(item.id);
		const baseLikes = item.likes ?? 0;
		return {
			...item,
			isUserSubmission: Boolean(item.isUserSubmission || tokens[item.id]),
			likes: isLiked && !item.isUserSubmission ? baseLikes + 1 : baseLikes
		};
	});
}

/**
 * Fetches community shuttles from the shared server backend (/api/gallery) and merges with bundled shuttles.
 */
export async function fetchCommunityShuttles(): Promise<CommunityGalleryResponse> {
	const bundled = getBundledShuttles();
	const tokens = getDeleteTokens();

	try {
		const res = await fetch('/api/gallery', { cache: 'no-store' });
		if (!res.ok) {
			return {
				shuttles: getCommunityShuttles(),
				configured: false,
				storageMode: res.status === 404 ? 'static-only' : 'error'
			};
		}

		const data = await res.json();
		const remoteList: CommunityShuttle[] = Array.isArray(data.shuttles) ? data.shuttles : [];
		const remoteIds = new Set(remoteList.map((s) => s.id));

		const merged: CommunityShuttle[] = [
			...remoteList.map((item) => ({
				...item,
				tags: Array.isArray(item.tags) ? item.tags : [],
				likes: typeof item.likes === 'number' ? item.likes : 1,
				isUserSubmission: Boolean(tokens[item.id])
			})),
			...bundled.filter((b) => !remoteIds.has(b.id))
		];

		return {
			shuttles: merged,
			configured: Boolean(data.configured),
			storageMode: String(data.storageMode || 'unknown')
		};
	} catch {
		return {
			shuttles: getCommunityShuttles(),
			configured: false,
			storageMode: 'offline'
		};
	}
}

/**
 * Fetches a single community shuttle by ID (supports direct remote lookup for shared /shuttle?communityId=... links).
 */
export async function fetchCommunityShuttleById(id: string): Promise<CommunityShuttle | undefined> {
	const local = getCommunityShuttleById(id);
	if (local && (local.yamlContent || local.yamlUrl)) return local;

	try {
		const res = await fetch(`/api/gallery?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
		if (!res.ok) return local;
		const data = await res.json();
		if (data?.item) {
			const tokens = getDeleteTokens();
			return {
				...data.item,
				tags: Array.isArray(data.item.tags) ? data.item.tags : [],
				isUserSubmission: Boolean(tokens[data.item.id])
			};
		}
	} catch {}
	return local;
}

/**
 * Retrieves a single community shuttle by its ID from local/bundled lists.
 */
export function getCommunityShuttleById(id: string): CommunityShuttle | undefined {
	const shuttles = getCommunityShuttles();
	return shuttles.find((s) => s.id === id);
}

/**
 * Checks whether the current user has liked a given community shuttle.
 */
export function isCommunityShuttleLiked(id: string): boolean {
	return getLikedIds().has(id);
}

/**
 * Toggles like locally (sync).
 */
export function toggleCommunityLike(id: string): boolean {
	if (typeof window === 'undefined' || !window.localStorage) return false;
	const likedSet = getLikedIds();
	let nowLiked = false;

	if (likedSet.has(id)) {
		likedSet.delete(id);
		nowLiked = false;
	} else {
		likedSet.add(id);
		nowLiked = true;
	}

	try {
		localStorage.setItem(LIKES_STORAGE_KEY, JSON.stringify(Array.from(likedSet)));
		window.dispatchEvent(
			new CustomEvent('webmap:community_updated', { detail: { id, liked: nowLiked } })
		);
	} catch (e) {
		console.error('Failed to save likes:', e);
	}

	return nowLiked;
}

/**
 * Toggles like on the shared server backend and persists locally.
 */
export async function toggleCommunityLikeRemote(
	id: string
): Promise<{ liked: boolean; likes?: number }> {
	const nowLiked = toggleCommunityLike(id);
	try {
		const res = await fetch('/api/gallery?action=like', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id, liked: nowLiked, voterId: getVoterId() })
		});
		if (res.ok) {
			const data = await res.json();
			return { liked: nowLiked, likes: typeof data.likes === 'number' ? data.likes : undefined };
		}
	} catch {}
	return { liked: nowLiked };
}

/**
 * Publishes a shuttle to the shared server community gallery (/api/gallery).
 */
export async function publishToCommunityRemote(
	item: Omit<CommunityShuttle, 'id' | 'createdAt' | 'isUserSubmission'> & {
		id?: string;
		createdAt?: string;
	}
): Promise<CommunityShuttle> {
	const cleanTags = (item.tags || []).map((t) => (t.startsWith('#') ? t : `#${t}`));
	const optimizedImage = await optimizeImageForUpload(item.image);

	const res = await fetch('/api/gallery', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			name: item.name,
			author: (item.author || 'Инженер Станции').trim(),
			description: item.description,
			tileWidth: item.tileWidth,
			tileHeight: item.tileHeight,
			entityCount: item.entityCount,
			size: item.size,
			hullClass: item.hullClass || 'shuttle',
			image: optimizedImage,
			yamlContent: item.yamlContent,
			yamlUrl: item.yamlUrl,
			tags: cleanTags.length > 0 ? cleanTags : ['#пользовательский']
		})
	});

	if (!res.ok) {
		let errMsg = `Ошибка сервера: HTTP ${res.status}`;
		try {
			const errData = await res.json();
			if (errData?.error) errMsg = errData.error;
		} catch {}
		throw new Error(errMsg);
	}

	const data = await res.json();
	const created: CommunityShuttle = {
		...data.item,
		tags: Array.isArray(data.item?.tags) ? data.item.tags : cleanTags,
		isUserSubmission: true
	};

	if (data.deleteToken) {
		saveDeleteToken(created.id, data.deleteToken);
	}

	const likedSet = getLikedIds();
	likedSet.add(created.id);
	try {
		localStorage.setItem(LIKES_STORAGE_KEY, JSON.stringify(Array.from(likedSet)));
	} catch {}

	window.dispatchEvent(
		new CustomEvent('webmap:community_updated', { detail: { newSubmission: created } })
	);

	return created;
}

/**
 * Publishes a shuttle to local community storage (fallback / offline).
 */
export function publishToCommunity(
	item: Omit<CommunityShuttle, 'id' | 'createdAt' | 'isUserSubmission'> & {
		id?: string;
		createdAt?: string;
	}
): CommunityShuttle {
	const submissions = getUserSubmissions();
	const now = new Date().toISOString();
	const cleanTags = (item.tags || []).map((t) => (t.startsWith('#') ? t : `#${t}`));

	const newSubmission: CommunityShuttle = {
		...item,
		id: item.id || `comm_user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
		author: (item.author || 'Инженер Станции').trim(),
		tags: cleanTags.length > 0 ? cleanTags : ['#пользовательский'],
		createdAt: item.createdAt || now,
		updatedAt: now,
		likes: 1,
		featured: false,
		isUserSubmission: true
	};

	submissions.unshift(newSubmission);
	persistUserSubmissions(submissions);

	const likedSet = getLikedIds();
	likedSet.add(newSubmission.id);
	try {
		localStorage.setItem(LIKES_STORAGE_KEY, JSON.stringify(Array.from(likedSet)));
	} catch {}

	window.dispatchEvent(
		new CustomEvent('webmap:community_updated', { detail: { newSubmission } })
	);
	return newSubmission;
}

/**
 * Deletes a user-published submission locally and remotely (when delete token exists).
 */
export async function deleteCommunitySubmissionRemote(id: string): Promise<void> {
	const token = getDeleteToken(id);
	if (token || !id.startsWith('comm_user_')) {
		const res = await fetch(`/api/gallery?id=${encodeURIComponent(id)}`, {
			method: 'DELETE',
			headers: token ? { 'X-Delete-Token': token } : {}
		});
		if (!res.ok && res.status !== 404) {
			let msg = `Не удалось удалить: HTTP ${res.status}`;
			try {
				const err = await res.json();
				if (err?.error) msg = err.error;
			} catch {}
			throw new Error(msg);
		}
	}
	deleteCommunitySubmission(id);
}

/**
 * Deletes a user-published submission from local storage.
 */
export function deleteCommunitySubmission(id: string): void {
	const submissions = getUserSubmissions().filter((s) => s.id !== id);
	persistUserSubmissions(submissions);
	window.dispatchEvent(new CustomEvent('webmap:community_updated', { detail: { deletedId: id } }));
}

/**
 * Imports a community shuttle from a remote manifest or share link and publishes it remotely.
 */
export async function importCommunityShuttleRemote(manifest: {
	name: string;
	author?: string;
	description?: string;
	size?: 'micro' | 'small' | 'medium' | 'large';
	tileWidth?: number;
	tileHeight?: number;
	entityCount?: number;
	hullClass?: string;
	imageUrl: string;
	yamlUrl?: string;
	yamlContent?: string;
	shareUrl?: string;
	tags?: string[];
}): Promise<CommunityShuttle> {
	let yamlContent = manifest.yamlContent;
	if (!yamlContent && manifest.yamlUrl) {
		try {
			const yr = await fetch(manifest.yamlUrl);
			if (yr.ok) yamlContent = await yr.text();
		} catch {}
	}

	let image = manifest.imageUrl;
	if (image && !image.startsWith('data:image/')) {
		try {
			const ir = await fetch(image);
			if (ir.ok) {
				const blob = await ir.blob();
				image = await new Promise<string>((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => resolve(String(reader.result));
					reader.onerror = reject;
					reader.readAsDataURL(blob);
				});
			}
		} catch {}
	}

	return publishToCommunityRemote({
		name: manifest.name || 'Общий шаттл',
		author: manifest.author || 'Участник сообщества',
		description: manifest.description || 'Шаттл импортирован по ссылке сообщества.',
		size: manifest.size || 'small',
		tileWidth: manifest.tileWidth || 20,
		tileHeight: manifest.tileHeight || 20,
		entityCount: manifest.entityCount || 100,
		hullClass: manifest.hullClass || 'shuttle',
		image,
		yamlContent,
		yamlUrl: manifest.yamlUrl,
		shareUrl: manifest.shareUrl,
		tags: manifest.tags && manifest.tags.length > 0 ? manifest.tags : ['#сообщество', '#импорт']
	});
}

/**
 * Imports a community shuttle locally.
 */
export function importCommunityShuttle(manifest: {
	name: string;
	author?: string;
	description?: string;
	size?: 'micro' | 'small' | 'medium' | 'large';
	tileWidth?: number;
	tileHeight?: number;
	entityCount?: number;
	hullClass?: string;
	imageUrl: string;
	yamlUrl?: string;
	shareUrl?: string;
	tags?: string[];
}): CommunityShuttle {
	return publishToCommunity({
		name: manifest.name || 'Общий шаттл',
		author: manifest.author || 'Участник сообщества',
		description: manifest.description || 'Шаттл импортирован по ссылке сообщества.',
		size: manifest.size || 'small',
		tileWidth: manifest.tileWidth || 20,
		tileHeight: manifest.tileHeight || 20,
		entityCount: manifest.entityCount || 100,
		hullClass: manifest.hullClass || 'shuttle',
		image: manifest.imageUrl,
		yamlUrl: manifest.yamlUrl,
		shareUrl: manifest.shareUrl,
		tags: manifest.tags && manifest.tags.length > 0 ? manifest.tags : ['#сообщество', '#импорт']
	});
}

function getUserSubmissions(): CommunityShuttle[] {
	if (typeof window === 'undefined' || !window.localStorage) return [];
	try {
		const raw = localStorage.getItem(SUBMISSIONS_STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch (e) {
		console.error('Failed to read community submissions:', e);
		return [];
	}
}

function persistUserSubmissions(submissions: CommunityShuttle[]): void {
	if (typeof window === 'undefined' || !window.localStorage) return;
	try {
		localStorage.setItem(SUBMISSIONS_STORAGE_KEY, JSON.stringify(submissions));
	} catch (e) {
		console.warn('localStorage quota exceeded for community submissions:', e);
	}
}

function getLikedIds(): Set<string> {
	if (typeof window === 'undefined' || !window.localStorage) return new Set();
	try {
		const raw = localStorage.getItem(LIKES_STORAGE_KEY);
		if (!raw) return new Set();
		const arr = JSON.parse(raw);
		return new Set(Array.isArray(arr) ? arr : []);
	} catch {
		return new Set();
	}
}
