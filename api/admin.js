import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { put, list, del, get } from '@vercel/blob';

/** @typedef {{ method?: string; url?: string; headers: Record<string, string | string[] | undefined>; body?: any; [Symbol.asyncIterator](): AsyncIterator<any> }} ApiRequest */
/** @typedef {{ statusCode: number; setHeader(name: string, value: string | string[]): void; end(body?: any): void }} ApiResponse */

const LOCAL_GALLERY_DIR = path.resolve(process.cwd(), '.local-gallery');
const LOCAL_ADMIN_DIR = path.resolve(process.cwd(), '.local-gallery', 'admin');
const ADMIN_AUTH_BLOB = 'admin-config/auth.json';
const OVERRIDES_INDEX_BLOB = 'catalog-overrides/index.json';
const GALLERY_META_PREFIX = 'community-shuttles/meta/';
const GALLERY_LIKES_PREFIX = 'community-shuttles/like-votes/';
const SESSION_COOKIE = 'webmap_admin_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** @type {'public' | 'private'} */
let blobAccessMode = process.env.BLOB_ACCESS === 'private' ? 'private' : 'public';

/** @param {string} value */
function sha256(value) {
	return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/**
 * @param {string} message
 * @param {number} statusCode
 */
function httpError(message, statusCode) {
	/** @type {Error & { statusCode?: number }} */
	const err = new Error(message);
	err.statusCode = statusCode;
	return err;
}

/**
 * @param {ApiResponse} res
 * @param {number} status
 * @param {unknown} data
 * @param {string[]} [extraCookies]
 */
function sendJson(res, status, data, extraCookies = []) {
	res.statusCode = status;
	res.setHeader('Content-Type', 'application/json; charset=utf-8');
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token');
	res.setHeader('Cache-Control', 'no-store');
	if (extraCookies.length > 0) {
		res.setHeader('Set-Cookie', extraCookies);
	}
	res.end(JSON.stringify(data));
}

/** @param {ApiRequest} req */
function parseQuery(req) {
	const url = new URL(req.url || '/', 'http://localhost');
	return url.searchParams;
}

/** @param {ApiRequest} req */
function parseCookies(req) {
	const rawHeader = req.headers?.cookie;
	const raw = Array.isArray(rawHeader) ? rawHeader.join(';') : String(rawHeader || '');
	/** @type {Record<string, string>} */
	const out = {};
	for (const part of raw.split(';')) {
		const eq = part.indexOf('=');
		if (eq <= 0) continue;
		const k = part.slice(0, eq).trim();
		const v = part.slice(eq + 1).trim();
		if (k) out[k] = decodeURIComponent(v);
	}
	return out;
}

/**
 * @param {ApiRequest} req
 * @returns {Promise<Record<string, any>>}
 */
async function readJsonBody(req) {
	if (req.body && typeof req.body === 'object') return req.body;
	if (typeof req.body === 'string') return JSON.parse(req.body);

	/** @type {Buffer[]} */
	const chunks = [];
	let total = 0;
	const MAX_BYTES = 4.4 * 1024 * 1024;
	for await (const chunk of req) {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += buf.length;
		if (total > MAX_BYTES) {
			throw httpError('Размер файла слишком велик (максимум 4.4 МБ).', 413);
		}
		chunks.push(buf);
	}
	const raw = Buffer.concat(chunks).toString('utf8');
	return raw ? JSON.parse(raw) : {};
}

/** @param {string} dataUrl */
function decodeImageDataUrl(dataUrl) {
	const match = /^data:(image\/(?:png|webp|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
	if (!match) return null;
	const contentType = match[1];
	const ext = contentType === 'image/webp' ? 'webp' : contentType === 'image/jpeg' ? 'jpg' : 'png';
	return {
		contentType,
		ext,
		buffer: Buffer.from(match[2], 'base64')
	};
}

function detectStorageBackend() {
	const hasBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
	if (hasBlob) return 'blob';
	if (!process.env.VERCEL) return 'local';
	return 'unconfigured';
}

/**
 * @param {ApiRequest} req
 * @returns {{ oidcToken?: string; storeId?: string }}
 */
function getBlobAuthOpts(req) {
	const headerToken = req.headers?.['x-vercel-oidc-token'];
	const oidcToken = Array.isArray(headerToken) ? headerToken[0] : headerToken;
	if (oidcToken && process.env.BLOB_STORE_ID) {
		return { oidcToken: String(oidcToken), storeId: process.env.BLOB_STORE_ID };
	}
	return {};
}

/**
 * @param {string} pathname
 * @param {string | Buffer} body
 * @param {{ addRandomSuffix?: boolean; allowOverwrite?: boolean; contentType?: string }} opts
 * @param {{ oidcToken?: string; storeId?: string }} authOpts
 */
async function blobPutSmart(pathname, body, opts, authOpts = {}) {
	try {
		return await put(pathname, body, { ...opts, ...authOpts, access: blobAccessMode });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (blobAccessMode === 'public' && msg.toLowerCase().includes('private')) {
			blobAccessMode = 'private';
			return await put(pathname, body, { ...opts, ...authOpts, access: 'private' });
		}
		throw err;
	}
}

/**
 * @param {string} pathname
 * @param {{ oidcToken?: string; storeId?: string }} authOpts
 * @returns {Promise<{ buffer: Buffer; contentType: string } | null>}
 */
async function blobReadSmart(pathname, authOpts = {}) {
	const tryOrder = blobAccessMode === 'private' ? /** @type {const} */ (['private', 'public']) : /** @type {const} */ (['public', 'private']);
	for (const access of tryOrder) {
		try {
			const result = await get(pathname, { ...authOpts, access, useCache: false });
			if (result && result.statusCode === 200 && result.stream) {
				if (access === 'private') blobAccessMode = 'private';
				const buf = Buffer.from(await new Response(result.stream).arrayBuffer());
				return {
					buffer: buf,
					contentType: result.blob.contentType || 'application/octet-stream'
				};
			}
		} catch {}
	}
	return null;
}

/**
 * @param {string} prefix
 * @param {{ oidcToken?: string; storeId?: string }} authOpts
 */
async function blobListAll(prefix, authOpts = {}) {
	/** @type {Awaited<ReturnType<typeof list>>['blobs']} */
	const all = [];
	/** @type {string | undefined} */
	let cursor;
	do {
		/** @type {Awaited<ReturnType<typeof list>>} */
		const page = await list({ prefix, limit: 1000, cursor, ...authOpts });
		all.push(...page.blobs);
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return all;
}

// ---------------- Generic Storage Adapter ----------------

/**
 * @param {string} backend
 * @param {string} relKey
 * @param {{ oidcToken?: string; storeId?: string }} authOpts
 */
async function storageReadJson(backend, relKey, authOpts) {
	if (backend === 'blob') {
		const loaded = await blobReadSmart(relKey, authOpts);
		if (!loaded) return null;
		return JSON.parse(loaded.buffer.toString('utf8'));
	}
	const full = path.join(LOCAL_ADMIN_DIR, relKey);
	try {
		const raw = await fs.readFile(full, 'utf8');
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

/**
 * @param {string} backend
 * @param {string} relKey
 * @param {unknown} data
 * @param {{ oidcToken?: string; storeId?: string }} authOpts
 */
async function storageWriteJson(backend, relKey, data, authOpts) {
	const jsonStr = JSON.stringify(data);
	if (backend === 'blob') {
		await blobPutSmart(
			relKey,
			jsonStr,
			{ addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json; charset=utf-8' },
			authOpts
		);
		return;
	}
	const full = path.join(LOCAL_ADMIN_DIR, relKey);
	await fs.mkdir(path.dirname(full), { recursive: true });
	await fs.writeFile(full, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * @param {string} backend
 * @param {string} relKey
 * @param {Buffer | string} body
 * @param {string} contentType
 * @param {{ oidcToken?: string; storeId?: string }} authOpts
 */
async function storageWriteAsset(backend, relKey, body, contentType, authOpts) {
	if (backend === 'blob') {
		await blobPutSmart(
			relKey,
			body,
			{ addRandomSuffix: false, allowOverwrite: true, contentType },
			authOpts
		);
		return `/api/admin?blob=${encodeURIComponent(relKey)}&v=${Date.now()}`;
	}
	const full = path.join(LOCAL_ADMIN_DIR, relKey);
	await fs.mkdir(path.dirname(full), { recursive: true });
	await fs.writeFile(full, body);
	return `/api/admin?asset=${encodeURIComponent(relKey)}&v=${Date.now()}`;
}

/**
 * @param {string} backend
 * @param {string} prefixOrRel
 * @param {{ oidcToken?: string; storeId?: string }} authOpts
 */
async function storageDeletePrefix(backend, prefixOrRel, authOpts) {
	if (backend === 'blob') {
		const blobs = await blobListAll(prefixOrRel, authOpts);
		if (blobs.length > 0) {
			await del(
				blobs.map((b) => b.url),
				authOpts
			);
		}
		return;
	}
	const full = path.join(LOCAL_ADMIN_DIR, prefixOrRel);
	await fs.rm(full, { recursive: true, force: true });
}

// ---------------- Auth Logic ----------------

/**
 * @param {string} password
 * @param {string} salt
 */
function hashPassword(password, salt) {
	return crypto.scryptSync(String(password), String(salt), 32).toString('hex');
}

/**
 * @param {string} a
 * @param {string} b
 */
function safeEqualHex(a, b) {
	if (!a || !b || a.length !== b.length) return false;
	return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * @param {string} backend
 * @param {{ oidcToken?: string; storeId?: string }} authOpts
 */
async function getAuthConfig(backend, authOpts) {
	const envPassword = process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET || '';
	if (envPassword) {
		return {
			source: /** @type {const} */ ('env'),
			initialized: true,
			envPassword,
			sessionSecret: sha256(`exodus-admin-env:${envPassword}`)
		};
	}

	const stored = await storageReadJson(backend, ADMIN_AUTH_BLOB, authOpts);
	if (stored && stored.passwordHash && stored.salt && stored.sessionSecret) {
		return {
			source: /** @type {const} */ ('storage'),
			initialized: true,
			salt: String(stored.salt),
			passwordHash: String(stored.passwordHash),
			sessionSecret: String(stored.sessionSecret)
		};
	}

	return {
		source: /** @type {const} */ ('storage'),
		initialized: false,
		sessionSecret: ''
	};
}

/**
 * @param {string} sessionSecret
 */
function createSessionToken(sessionSecret) {
	const expiresAt = Date.now() + SESSION_TTL_MS;
	const sig = crypto.createHmac('sha256', sessionSecret).update(String(expiresAt)).digest('hex');
	return `${expiresAt}.${sig}`;
}

/**
 * @param {string | undefined} token
 * @param {string} sessionSecret
 */
function verifySessionToken(token, sessionSecret) {
	if (!token || !sessionSecret) return false;
	const dot = token.indexOf('.');
	if (dot <= 0) return false;
	const expiresAtStr = token.slice(0, dot);
	const sig = token.slice(dot + 1);
	const expiresAt = Number(expiresAtStr);
	if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
	const expected = crypto.createHmac('sha256', sessionSecret).update(expiresAtStr).digest('hex');
	return safeEqualHex(sig, expected);
}

/**
 * @param {ApiRequest} req
 */
function extractAdminToken(req) {
	const cookies = parseCookies(req);
	if (cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE];

	const xToken = req.headers?.['x-admin-token'];
	if (xToken) return Array.isArray(xToken) ? xToken[0] : String(xToken);

	const authHeader = req.headers?.authorization;
	const authStr = Array.isArray(authHeader) ? authHeader[0] : String(authHeader || '');
	if (authStr.toLowerCase().startsWith('bearer ')) {
		return authStr.slice(7).trim();
	}
	return '';
}

/**
 * @param {string} token
 * @param {boolean} isSecure
 */
function buildSessionCookie(token, isSecure) {
	const parts = [
		`${SESSION_COOKIE}=${encodeURIComponent(token)}`,
		'Path=/',
		'HttpOnly',
		'SameSite=Lax',
		`Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
	];
	if (isSecure) parts.push('Secure');
	return parts.join('; ');
}

function buildClearCookie() {
	return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * @param {ApiRequest} req
 */
function isHttpsRequest(req) {
	const proto = req.headers?.['x-forwarded-proto'];
	return proto === 'https' || Boolean(process.env.VERCEL);
}

// ---------------- Catalog State ----------------

function emptyCatalogState() {
	return {
		updatedAt: /** @type {string | null} */ (null),
		siteSettings: {
			bannerText: '',
			bannerType: 'info'
		},
		overrides: /** @type {Record<string, any>} */ ({}),
		customShuttles: /** @type {Array<Record<string, any>>} */ ([])
	};
}

/**
 * @param {string} backend
 * @param {{ oidcToken?: string; storeId?: string }} authOpts
 */
async function readCatalogState(backend, authOpts) {
	const loaded = await storageReadJson(backend, OVERRIDES_INDEX_BLOB, authOpts);
	if (!loaded || typeof loaded !== 'object') return emptyCatalogState();
	return {
		updatedAt: loaded.updatedAt || null,
		siteSettings: {
			bannerText: String(loaded.siteSettings?.bannerText || ''),
			bannerType: String(loaded.siteSettings?.bannerType || 'info')
		},
		overrides: loaded.overrides && typeof loaded.overrides === 'object' ? loaded.overrides : {},
		customShuttles: Array.isArray(loaded.customShuttles) ? loaded.customShuttles : []
	};
}

/**
 * @param {string} backend
 * @param {ReturnType<typeof emptyCatalogState>} state
 * @param {{ oidcToken?: string; storeId?: string }} authOpts
 */
async function writeCatalogState(backend, state, authOpts) {
	state.updatedAt = new Date().toISOString();
	await storageWriteJson(backend, OVERRIDES_INDEX_BLOB, state, authOpts);
	return state;
}

// ---------------- Community Moderation Helpers ----------------

/**
 * @param {string} backend
 * @param {{ oidcToken?: string; storeId?: string }} authOpts
 */
async function adminListGallery(backend, authOpts) {
	if (backend === 'blob') {
		const metaBlobs = await blobListAll(GALLERY_META_PREFIX, authOpts);
		const items = await Promise.all(
			metaBlobs.map(async (mb) => {
				try {
					const loaded = await blobReadSmart(mb.pathname, authOpts);
					if (!loaded) return null;
					const parsed = JSON.parse(loaded.buffer.toString('utf8'));
					const { deleteTokenHash: _h, ...pub } = parsed;
					return pub;
				} catch {
					return null;
				}
			})
		);
		return items.filter(Boolean).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
	}

	const metaDir = path.join(LOCAL_GALLERY_DIR, 'meta');
	try {
		const files = await fs.readdir(metaDir);
		const items = [];
		for (const f of files) {
			if (!f.endsWith('.json')) continue;
			const raw = await fs.readFile(path.join(metaDir, f), 'utf8');
			const parsed = JSON.parse(raw);
			const { deleteTokenHash: _h, ...pub } = parsed;
			items.push(pub);
		}
		return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
	} catch {
		return [];
	}
}

/**
 * @param {string} backend
 * @param {string} id
 * @param {Record<string, any>} patch
 * @param {{ oidcToken?: string; storeId?: string }} authOpts
 */
async function adminUpdateGalleryItem(backend, id, patch, authOpts) {
	const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
	if (!safeId) throw httpError('Некорректный ID шаттла.', 400);

	if (backend === 'blob') {
		const key = `${GALLERY_META_PREFIX}${safeId}.json`;
		const loaded = await blobReadSmart(key, authOpts);
		if (!loaded) throw httpError('Шаттл не найден в облачной галерее.', 404);
		const meta = JSON.parse(loaded.buffer.toString('utf8'));
		const updated = {
			...meta,
			...(typeof patch.name === 'string' && patch.name.trim() ? { name: patch.name.trim().slice(0, 100) } : {}),
			...(typeof patch.description === 'string' ? { description: patch.description.trim().slice(0, 500) } : {}),
			...(typeof patch.author === 'string' && patch.author.trim() ? { author: patch.author.trim().slice(0, 60) } : {}),
			...(typeof patch.featured === 'boolean' ? { featured: patch.featured } : {}),
			...(Array.isArray(patch.tags)
				? {
						tags: patch.tags
							.map((/** @type {unknown} */ t) => String(t).trim().slice(0, 32))
							.filter(Boolean)
							.slice(0, 10)
							.map((/** @type {string} */ t) => (t.startsWith('#') ? t : `#${t}`))
					}
				: {}),
			updatedAt: new Date().toISOString()
		};
		await blobPutSmart(
			key,
			JSON.stringify(updated),
			{ addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json; charset=utf-8' },
			authOpts
		);
		const { deleteTokenHash: _h, ...pub } = updated;
		return pub;
	}

	const filePath = path.join(LOCAL_GALLERY_DIR, 'meta', `${safeId}.json`);
	let meta;
	try {
		meta = JSON.parse(await fs.readFile(filePath, 'utf8'));
	} catch {
		throw httpError('Шаттл не найден в локальной галерее.', 404);
	}
	const updated = {
		...meta,
		...(typeof patch.name === 'string' && patch.name.trim() ? { name: patch.name.trim().slice(0, 100) } : {}),
		...(typeof patch.description === 'string' ? { description: patch.description.trim().slice(0, 500) } : {}),
		...(typeof patch.author === 'string' && patch.author.trim() ? { author: patch.author.trim().slice(0, 60) } : {}),
		...(typeof patch.featured === 'boolean' ? { featured: patch.featured } : {}),
		...(Array.isArray(patch.tags)
			? {
					tags: patch.tags
						.map((/** @type {unknown} */ t) => String(t).trim().slice(0, 32))
						.filter(Boolean)
						.slice(0, 10)
						.map((/** @type {string} */ t) => (t.startsWith('#') ? t : `#${t}`))
				}
			: {}),
		updatedAt: new Date().toISOString()
	};
	await fs.writeFile(filePath, JSON.stringify(updated, null, 2), 'utf8');
	const { deleteTokenHash: _h, ...pub } = updated;
	return pub;
}

/**
 * @param {string} backend
 * @param {string} id
 * @param {{ oidcToken?: string; storeId?: string }} authOpts
 */
async function adminDeleteGalleryItem(backend, id, authOpts) {
	const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
	if (!safeId) throw httpError('Некорректный ID шаттла.', 400);

	if (backend === 'blob') {
		const [metaBlobs, imgBlobs, mapBlobs, voteBlobs] = await Promise.all([
			blobListAll(`${GALLERY_META_PREFIX}${safeId}.json`, authOpts),
			blobListAll(`community-shuttles/images/${safeId}.`, authOpts),
			blobListAll(`community-shuttles/maps/${safeId}.yml`, authOpts),
			blobListAll(`${GALLERY_LIKES_PREFIX}${safeId}/`, authOpts)
		]);
		const urls = [...metaBlobs, ...imgBlobs, ...mapBlobs, ...voteBlobs].map((b) => b.url);
		if (urls.length === 0) throw httpError('Шаттл не найден в галерее.', 404);
		await del(urls, authOpts);
		return;
	}

	await fs.rm(path.join(LOCAL_GALLERY_DIR, 'meta', `${safeId}.json`), { force: true });
	await fs.rm(path.join(LOCAL_GALLERY_DIR, 'maps', `${safeId}.yml`), { force: true });
	await fs.rm(path.join(LOCAL_GALLERY_DIR, 'images', `${safeId}.png`), { force: true });
	await fs.rm(path.join(LOCAL_GALLERY_DIR, 'images', `${safeId}.webp`), { force: true });
}

// ---------------- Main Handler ----------------

/**
 * @param {ApiRequest} req
 * @param {ApiResponse} res
 */
export default async function handler(req, res) {
	if (req.method === 'OPTIONS') {
		return sendJson(res, 200, { ok: true });
	}

	const query = parseQuery(req);
	const action = query.get('action') || '';
	const backend = detectStorageBackend();
	const blobAuthOpts = getBlobAuthOpts(req);

	// Serve catalog override blob images/maps publicly (even with Private Vercel Blob store)
	const blobParam = query.get('blob');
	if (req.method === 'GET' && blobParam && backend === 'blob') {
		if (!blobParam.startsWith('catalog-overrides/images/') && !blobParam.startsWith('catalog-overrides/maps/')) {
			return sendJson(res, 403, { error: 'Forbidden' });
		}
		try {
			const loaded = await blobReadSmart(blobParam, blobAuthOpts);
			if (!loaded) return sendJson(res, 404, { error: 'Not found' });
			res.statusCode = 200;
			res.setHeader('Access-Control-Allow-Origin', '*');
			res.setHeader('Content-Type', loaded.contentType);
			res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
			return res.end(loaded.buffer);
		} catch {
			return sendJson(res, 404, { error: 'Not found' });
		}
	}

	// Serve local override assets in dev mode
	const assetParam = query.get('asset');
	if (req.method === 'GET' && assetParam && backend === 'local') {
		const normalized = path.posix.normalize(assetParam.replace(/\\/g, '/')).replace(/^(\.\.\/)+/, '');
		if (!normalized.startsWith('catalog-overrides/images/') && !normalized.startsWith('catalog-overrides/maps/')) {
			return sendJson(res, 403, { error: 'Forbidden' });
		}
		const fullPath = path.join(LOCAL_ADMIN_DIR, normalized);
		try {
			const data = await fs.readFile(fullPath);
			res.statusCode = 200;
			res.setHeader('Access-Control-Allow-Origin', '*');
			if (fullPath.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
			else if (fullPath.endsWith('.webp')) res.setHeader('Content-Type', 'image/webp');
			else if (fullPath.endsWith('.jpg')) res.setHeader('Content-Type', 'image/jpeg');
			else if (fullPath.endsWith('.yml')) res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
			return res.end(data);
		} catch {
			return sendJson(res, 404, { error: 'Not found' });
		}
	}

	// Public site overrides read (never fails site load cleanly even if unconfigured)
	if (req.method === 'GET' && action === 'public-state') {
		if (backend === 'unconfigured') {
			return sendJson(res, 200, { ...emptyCatalogState(), backend, configured: false });
		}
		try {
			const state = await readCatalogState(backend, blobAuthOpts);
			return sendJson(res, 200, { ...state, backend, configured: true });
		} catch {
			return sendJson(res, 200, { ...emptyCatalogState(), backend, configured: false });
		}
	}

	if (backend === 'unconfigured') {
		return sendJson(res, 503, {
			code: 'STORAGE_NOT_CONFIGURED',
			error: 'Хранилище Vercel Blob не подключено. Проверьте BLOB_READ_WRITE_TOKEN / BLOB_STORE_ID.'
		});
	}

	try {
		const auth = await getAuthConfig(backend, blobAuthOpts);
		const token = extractAdminToken(req);
		const authenticated = auth.initialized && verifySessionToken(token, auth.sessionSecret);

		// Auth status endpoint
		if (req.method === 'GET' && action === 'auth-status') {
			return sendJson(res, 200, {
				initialized: auth.initialized,
				authenticated,
				authSource: auth.source,
				backend,
				configured: true
			});
		}

		// Initial admin password setup (only if no env var and no auth.json yet)
		if (req.method === 'POST' && action === 'setup') {
			if (auth.initialized) {
				throw httpError('Пароль администратора уже настроен. Выполните вход.', 409);
			}
			const body = await readJsonBody(req);
			const password = String(body.password || '').trim();
			if (password.length < 4) {
				throw httpError('Пароль должен содержать минимум 4 символа.', 400);
			}
			const salt = crypto.randomBytes(16).toString('hex');
			const sessionSecret = crypto.randomBytes(32).toString('hex');
			const passwordHash = hashPassword(password, salt);
			await storageWriteJson(
				backend,
				ADMIN_AUTH_BLOB,
				{
					salt,
					passwordHash,
					sessionSecret,
					createdAt: new Date().toISOString()
				},
				blobAuthOpts
			);
			const sessionToken = createSessionToken(sessionSecret);
			return sendJson(
				res,
				201,
				{ ok: true, token: sessionToken, authenticated: true },
				[buildSessionCookie(sessionToken, isHttpsRequest(req))]
			);
		}

		// Admin login
		if (req.method === 'POST' && action === 'login') {
			if (!auth.initialized) {
				throw httpError('Пароль ещё не задан. Настройте его на экране создания пароля.', 400);
			}
			const body = await readJsonBody(req);
			const password = String(body.password || '');
			let valid = false;
			if (auth.source === 'env') {
				valid = safeEqualHex(sha256(password), sha256(auth.envPassword));
			} else {
				const candidate = hashPassword(password, String(auth.salt || ''));
				valid = safeEqualHex(candidate, String(auth.passwordHash || ''));
			}
			if (!valid) {
				throw httpError('Неверный пароль администратора.', 401);
			}
			const sessionToken = createSessionToken(auth.sessionSecret);
			return sendJson(
				res,
				200,
				{ ok: true, token: sessionToken, authenticated: true },
				[buildSessionCookie(sessionToken, isHttpsRequest(req))]
			);
		}

		if (req.method === 'POST' && action === 'logout') {
			return sendJson(res, 200, { ok: true }, [buildClearCookie()]);
		}

		// All routes below require admin authentication
		if (!authenticated) {
			return sendJson(res, 401, { error: 'Требуется авторизация администратора.' });
		}

		// Change password (when stored in DB/Blob)
		if (req.method === 'POST' && action === 'change-password') {
			if (auth.source === 'env') {
				throw httpError('Пароль задан через переменную окружения ADMIN_PASSWORD на Vercel.', 400);
			}
			const body = await readJsonBody(req);
			const currentPassword = String(body.currentPassword || '');
			const newPassword = String(body.newPassword || '').trim();
			if (!safeEqualHex(hashPassword(currentPassword, String(auth.salt || '')), String(auth.passwordHash || ''))) {
				throw httpError('Текущий пароль неверен.', 401);
			}
			if (newPassword.length < 4) {
				throw httpError('Новый пароль должен содержать минимум 4 символа.', 400);
			}
			const salt = crypto.randomBytes(16).toString('hex');
			const sessionSecret = crypto.randomBytes(32).toString('hex');
			const passwordHash = hashPassword(newPassword, salt);
			await storageWriteJson(
				backend,
				ADMIN_AUTH_BLOB,
				{ salt, passwordHash, sessionSecret, updatedAt: new Date().toISOString() },
				blobAuthOpts
			);
			const sessionToken = createSessionToken(sessionSecret);
			return sendJson(
				res,
				200,
				{ ok: true, token: sessionToken },
				[buildSessionCookie(sessionToken, isHttpsRequest(req))]
			);
		}

		// Save single shuttle override or new custom catalog shuttle (with optional rendered image + yaml)
		if (req.method === 'POST' && action === 'save-shuttle') {
			const body = await readJsonBody(req);
			const id = String(body.id || '').trim();
			const isCustom = Boolean(body.isCustom);
			if (!id) throw httpError('Не указан ID шаттла.', 400);
			const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);

			const state = await readCatalogState(backend, blobAuthOpts);
			let imageUrl = typeof body.image === 'string' ? body.image : undefined;
			let yamlUrl = typeof body.yamlUrl === 'string' ? body.yamlUrl : undefined;

			if (typeof body.imageDataUrl === 'string' && body.imageDataUrl.startsWith('data:image/')) {
				const decoded = decodeImageDataUrl(body.imageDataUrl);
				if (!decoded) throw httpError('Некорректный формат изображения.', 400);
				const relImg = `catalog-overrides/images/${safeId}.${decoded.ext}`;
				imageUrl = await storageWriteAsset(backend, relImg, decoded.buffer, decoded.contentType, blobAuthOpts);
			}

			if (typeof body.yamlContent === 'string' && body.yamlContent.trim()) {
				const relYaml = `catalog-overrides/maps/${safeId}.yml`;
				yamlUrl = await storageWriteAsset(
					backend,
					relYaml,
					body.yamlContent,
					'text/yaml; charset=utf-8',
					blobAuthOpts
				);
			}

			const patch = body.patch && typeof body.patch === 'object' ? body.patch : {};
			const now = new Date().toISOString();

			if (isCustom) {
				const existingIdx = state.customShuttles.findIndex((/** @type {any} */ s) => s.id === id);
				const prev = existingIdx >= 0 ? state.customShuttles[existingIdx] : {};
				const nextShuttle = {
					id,
					name: String(patch.name ?? prev.name ?? id).trim().slice(0, 120) || id,
					description: String(patch.description ?? prev.description ?? '').trim().slice(0, 1000),
					price: Math.max(0, Number(patch.price ?? prev.price ?? 0) || 0),
					group: String(patch.group ?? prev.group ?? 'custom'),
					hullClass: String(patch.hullClass ?? prev.hullClass ?? 'shuttle'),
					size: String(patch.size ?? prev.size ?? 'small'),
					classes: Array.isArray(patch.classes) ? patch.classes : prev.classes || ['civilian'],
					engines: Array.isArray(patch.engines) ? patch.engines : prev.engines || ['plasma'],
					voucher: Boolean(patch.voucher ?? prev.voucher ?? false),
					hidden: Boolean(patch.hidden ?? prev.hidden ?? false),
					image: imageUrl || prev.image || '/atom-0.png',
					...(yamlUrl ? { yamlUrl, mapPath: yamlUrl } : prev.yamlUrl ? { yamlUrl: prev.yamlUrl, mapPath: prev.mapPath } : {}),
					...(typeof body.tileWidth === 'number' ? { tileWidth: body.tileWidth } : prev.tileWidth ? { tileWidth: prev.tileWidth } : {}),
					...(typeof body.tileHeight === 'number' ? { tileHeight: body.tileHeight } : prev.tileHeight ? { tileHeight: prev.tileHeight } : {}),
					...(typeof body.entityCount === 'number' ? { entityCount: body.entityCount } : prev.entityCount ? { entityCount: prev.entityCount } : {}),
					createdAt: prev.createdAt || now,
					updatedAt: now
				};
				if (existingIdx >= 0) state.customShuttles[existingIdx] = nextShuttle;
				else state.customShuttles.unshift(nextShuttle);
			} else {
				const prev = state.overrides[id] || {};
				const merged = {
					...prev,
					...patch,
					...(imageUrl ? { image: imageUrl } : {}),
					...(yamlUrl ? { yamlUrl } : {}),
					updatedAt: now
				};
				state.overrides[id] = merged;
			}

			const saved = await writeCatalogState(backend, state, blobAuthOpts);
			return sendJson(res, 200, {
				ok: true,
				id,
				imageUrl,
				yamlUrl,
				updatedAt: saved.updatedAt
			});
		}

		// Delete single shuttle override or custom catalog shuttle
		if ((req.method === 'DELETE' || req.method === 'POST') && action === 'delete-shuttle') {
			const id = String(query.get('id') || (req.method === 'POST' ? (await readJsonBody(req)).id : '') || '').trim();
			if (!id) throw httpError('Не указан ID шаттла.', 400);
			const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);

			const state = await readCatalogState(backend, blobAuthOpts);
			delete state.overrides[id];
			state.customShuttles = state.customShuttles.filter((/** @type {any} */ s) => s.id !== id);
			await Promise.all([
				storageDeletePrefix(backend, `catalog-overrides/images/${safeId}.`, blobAuthOpts),
				storageDeletePrefix(backend, `catalog-overrides/maps/${safeId}.yml`, blobAuthOpts)
			]);
			const saved = await writeCatalogState(backend, state, blobAuthOpts);
			return sendJson(res, 200, { ok: true, id, updatedAt: saved.updatedAt });
		}

		// Reset all overrides (optionally keep customShuttles unless all=1)
		if (req.method === 'POST' && action === 'reset-overrides') {
			const body = await readJsonBody(req);
			const includeCustom = Boolean(body.includeCustom);
			const state = await readCatalogState(backend, blobAuthOpts);
			state.overrides = {};
			if (includeCustom) {
				state.customShuttles = [];
				await storageDeletePrefix(backend, 'catalog-overrides/images/', blobAuthOpts);
				await storageDeletePrefix(backend, 'catalog-overrides/maps/', blobAuthOpts);
			}
			const saved = await writeCatalogState(backend, state, blobAuthOpts);
			return sendJson(res, 200, { ok: true, updatedAt: saved.updatedAt });
		}

		// Update site-wide banner/settings
		if (req.method === 'POST' && action === 'save-settings') {
			const body = await readJsonBody(req);
			const state = await readCatalogState(backend, blobAuthOpts);
			state.siteSettings = {
				bannerText: String(body.bannerText || '').trim().slice(0, 300),
				bannerType: ['info', 'warning', 'success'].includes(body.bannerType) ? String(body.bannerType) : 'info'
			};
			const saved = await writeCatalogState(backend, state, blobAuthOpts);
			return sendJson(res, 200, { ok: true, siteSettings: saved.siteSettings, updatedAt: saved.updatedAt });
		}

		// Community gallery admin moderation
		if (req.method === 'GET' && action === 'gallery-list') {
			const shuttles = await adminListGallery(backend, blobAuthOpts);
			return sendJson(res, 200, { ok: true, shuttles });
		}

		if (req.method === 'POST' && action === 'gallery-update') {
			const body = await readJsonBody(req);
			const id = String(body.id || '').trim();
			if (!id) throw httpError('Не указан ID шаттла.', 400);
			const item = await adminUpdateGalleryItem(backend, id, body, blobAuthOpts);
			return sendJson(res, 200, { ok: true, item });
		}

		if (req.method === 'DELETE' && action === 'gallery-delete') {
			const id = String(query.get('id') || '').trim();
			if (!id) throw httpError('Не указан ID шаттла.', 400);
			await adminDeleteGalleryItem(backend, id, blobAuthOpts);
			return sendJson(res, 200, { ok: true, deletedId: id });
		}

		// Monolith GitHub direct tree/raw proxy (so admin can batch-render fresh Monolith YAML without cloning Git)
		if (req.method === 'GET' && action === 'monolith-tree') {
			/** @type {Record<string, string>} */
			const ghHeaders = {
				Accept: 'application/vnd.github+json',
				'User-Agent': 'Exodus-Webmap-Admin'
			};
			if (process.env.GITHUB_TOKEN) {
				ghHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
			}
			const r = await fetch(
				'https://api.github.com/repos/SerbiaStrong-220/Monolith/git/trees/master?recursive=1',
				{ headers: ghHeaders }
			);
			if (!r.ok) {
				throw httpError(`GitHub API вернул ${r.status}`, r.status === 403 ? 429 : 502);
			}
			const data = await r.json();
			const files = (Array.isArray(data.tree) ? data.tree : [])
				.filter(
					(/** @type {any} */ node) =>
						node.type === 'blob' &&
						typeof node.path === 'string' &&
						node.path.endsWith('.yml') &&
						(node.path.startsWith('Resources/Maps/') || node.path.startsWith('Resources/SharedMaps/'))
				)
				.map((/** @type {any} */ node) => ({
					path: node.path,
					name: node.path.split('/').pop(),
					size: node.size || 0
				}));
			return sendJson(res, 200, { ok: true, files, total: files.length });
		}

		if (req.method === 'GET' && action === 'monolith-file') {
			const relPath = String(query.get('path') || '').replace(/^\/+/, '');
			if (
				!relPath.endsWith('.yml') ||
				relPath.includes('..') ||
				(!relPath.startsWith('Resources/Maps/') && !relPath.startsWith('Resources/SharedMaps/'))
			) {
				throw httpError('Недопустимый путь к карте Monolith.', 400);
			}
			const rawUrl = `https://raw.githubusercontent.com/SerbiaStrong-220/Monolith/master/${relPath}`;
			const r = await fetch(rawUrl);
			if (!r.ok) throw httpError(`Не удалось скачать карту (${r.status}).`, 502);
			const yamlContent = await r.text();
			return sendJson(res, 200, { ok: true, path: relPath, yamlContent });
		}

		return sendJson(res, 404, { error: 'Неизвестное действие API администратора.' });
	} catch (err) {
		const typedErr = /** @type {{ statusCode?: number; message?: string }} */ (err);
		const status = typedErr?.statusCode || 500;
		const message = typedErr?.message || 'Внутренняя ошибка API администратора';
		console.error('Admin API error:', err);
		return sendJson(res, status, { error: message });
	}
}
