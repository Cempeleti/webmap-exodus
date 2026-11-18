import type { Shuttle, ShuttleGroup, ShuttleHullClass, ShuttleSize } from './index';

export interface ShuttleOverridePatch {
	name?: string;
	description?: string;
	price?: number;
	group?: ShuttleGroup | string;
	hullClass?: ShuttleHullClass | string;
	size?: ShuttleSize | string;
	classes?: string[];
	engines?: string[];
	voucher?: boolean;
	hidden?: boolean;
	image?: string;
	yamlUrl?: string;
	updatedAt?: string;
}

export interface SiteSettings {
	bannerText: string;
	bannerType: 'info' | 'warning' | 'success';
}

export interface CatalogPublicState {
	updatedAt: string | null;
	siteSettings: SiteSettings;
	overrides: Record<string, ShuttleOverridePatch>;
	customShuttles: Array<Shuttle & { hidden?: boolean; updatedAt?: string }>;
	backend?: string;
	configured?: boolean;
}

const ADMIN_TOKEN_STORAGE_KEY = 'webmap_admin_token';

const emptyState: CatalogPublicState = {
	updatedAt: null,
	siteSettings: { bannerText: '', bannerType: 'info' },
	overrides: {},
	customShuttles: [],
	configured: false
};

let cachedState: CatalogPublicState | null = null;
let inflightPromise: Promise<CatalogPublicState> | null = null;

export function getAdminToken(): string {
	if (typeof window === 'undefined' || !window.localStorage) return '';
	try {
		return localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || '';
	} catch {
		return '';
	}
}

export function setAdminToken(token: string): void {
	if (typeof window === 'undefined' || !window.localStorage) return;
	try {
		if (token) localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
		else localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
	} catch {}
}

export function invalidateCatalogStateCache(): void {
	cachedState = null;
}

export async function fetchCatalogPublicState(force = false): Promise<CatalogPublicState> {
	if (typeof window === 'undefined') return emptyState;
	if (!force && cachedState) return cachedState;
	if (!force && inflightPromise) return inflightPromise;

	inflightPromise = fetch('/api/admin?action=public-state', { cache: 'no-store' })
		.then(async (res) => {
			if (!res.ok) return emptyState;
			const data = await res.json();
			const state: CatalogPublicState = {
				updatedAt: data.updatedAt || null,
				siteSettings: {
					bannerText: String(data.siteSettings?.bannerText || ''),
					bannerType: ['info', 'warning', 'success'].includes(data.siteSettings?.bannerType)
						? data.siteSettings.bannerType
						: 'info'
				},
				overrides: data.overrides && typeof data.overrides === 'object' ? data.overrides : {},
				customShuttles: Array.isArray(data.customShuttles) ? data.customShuttles : [],
				backend: data.backend,
				configured: Boolean(data.configured)
			};
			cachedState = state;
			return state;
		})
		.catch(() => emptyState)
		.finally(() => {
			inflightPromise = null;
		});

	return inflightPromise;
}

export function mergeCatalogWithOverrides(
	baseShuttles: Shuttle[],
	state: CatalogPublicState | null,
	options?: { includeHidden?: boolean }
): Array<Shuttle & { _hasOverride?: boolean; _isCustom?: boolean; _hidden?: boolean; _updatedAt?: string }> {
	if (!state) return baseShuttles;
	const includeHidden = Boolean(options?.includeHidden);

	const mergedBase = baseShuttles
		.map((s) => {
			const ov = state.overrides?.[s.id];
			if (!ov) return { ...s };
			const combined: Shuttle & { _hasOverride?: boolean; _hidden?: boolean; _updatedAt?: string } = {
				...s,
				...(typeof ov.name === 'string' && ov.name.trim() ? { name: ov.name } : {}),
				...(typeof ov.description === 'string' ? { description: ov.description } : {}),
				...(typeof ov.price === 'number' ? { price: ov.price } : {}),
				...(typeof ov.group === 'string' && ov.group ? { group: ov.group as ShuttleGroup } : {}),
				...(typeof ov.hullClass === 'string' && ov.hullClass
					? { hullClass: ov.hullClass as ShuttleHullClass }
					: {}),
				...(typeof ov.size === 'string' && ov.size ? { size: ov.size as ShuttleSize } : {}),
				...(Array.isArray(ov.classes) ? { classes: ov.classes as any } : {}),
				...(Array.isArray(ov.engines) ? { engines: ov.engines as any } : {}),
				...(typeof ov.voucher === 'boolean' ? { voucher: ov.voucher } : {}),
				...(typeof ov.image === 'string' && ov.image ? { image: ov.image } : {}),
				...(typeof ov.yamlUrl === 'string' && ov.yamlUrl ? { yamlUrl: ov.yamlUrl } : {}),
				_hasOverride: true,
				_hidden: Boolean(ov.hidden),
				_updatedAt: ov.updatedAt
			};
			return combined;
		})
		.filter((s) => includeHidden || !(s as any)._hidden);

	const customList = (state.customShuttles || [])
		.filter((s) => includeHidden || !s.hidden)
		.map((s) => ({
			...s,
			_isCustom: true,
			_hidden: Boolean(s.hidden),
			_updatedAt: s.updatedAt
		}));

	return [...customList, ...mergedBase];
}

export async function adminApiFetch<T = any>(
	pathWithQuery: string,
	init?: RequestInit
): Promise<T> {
	const token = getAdminToken();
	const headers = new Headers(init?.headers || {});
	if (token && !headers.has('X-Admin-Token')) {
		headers.set('X-Admin-Token', token);
	}
	if (init?.body && !headers.has('Content-Type')) {
		headers.set('Content-Type', 'application/json');
	}
	const res = await fetch(pathWithQuery, {
		...init,
		headers,
		credentials: 'include',
		cache: 'no-store'
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(data.error || `HTTP ${res.status}`);
	}
	return data as T;
}
