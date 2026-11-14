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

const SUBMISSIONS_STORAGE_KEY = 'webmap_community_submissions';
const LIKES_STORAGE_KEY = 'webmap_community_likes';

/**
 * Retrieves all community shuttles: bundled curated collection + local community submissions.
 */
export function getCommunityShuttles(): CommunityShuttle[] {
	const bundled: CommunityShuttle[] = (communityDataJson as any[]).map((item) => ({
		...item,
		tags: Array.isArray(item.tags) ? item.tags : [],
		likes: typeof item.likes === 'number' ? item.likes : 0,
		featured: Boolean(item.featured),
		isUserSubmission: false
	}));

	const userSubmissions = getUserSubmissions();
	const likedSet = getLikedIds();

	const all = [...userSubmissions, ...bundled];

	return all.map((item) => {
		const isLiked = likedSet.has(item.id);
		const baseLikes = item.likes ?? 0;
		return {
			...item,
			likes: isLiked ? baseLikes + 1 : baseLikes
		};
	});
}

/**
 * Retrieves a single community shuttle by its ID.
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
 * Toggles like for a community shuttle.
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
 * Publishes a shuttle to the community gallery.
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
		likes: 1, // Author's initial like
		featured: false,
		isUserSubmission: true
	};

	submissions.unshift(newSubmission);
	persistUserSubmissions(submissions);

	// Automatically mark as liked by the author
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
 * Deletes a user-published submission from the community list.
 */
export function deleteCommunitySubmission(id: string): void {
	const submissions = getUserSubmissions().filter((s) => s.id !== id);
	persistUserSubmissions(submissions);
	window.dispatchEvent(new CustomEvent('webmap:community_updated', { detail: { deletedId: id } }));
}

/**
 * Imports a community shuttle from a remote manifest or share link.
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
		console.error('Failed to persist community submissions:', e);
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
