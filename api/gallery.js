import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { put, list, del, get } from '@vercel/blob';

/** @typedef {{ url: string; token: string }} KvConfig */
/** @typedef {{ token?: string; repo: string; branch: string }} GhConfig */
/** @typedef {{ method?: string; url?: string; headers: Record<string, string | string[] | undefined>; body?: any; [Symbol.asyncIterator](): AsyncIterator<any> }} ApiRequest */
/** @typedef {{ statusCode: number; setHeader(name: string, value: string): void; end(body?: any): void }} ApiResponse */

const LOCAL_DIR = path.resolve(process.cwd(), '.local-gallery');
const BLOB_META_PREFIX = 'community-shuttles/meta/';
const BLOB_LIKES_PREFIX = 'community-shuttles/like-votes/';

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
 */
function sendJson(res, status, data) {
	res.statusCode = status;
	res.setHeader('Content-Type', 'application/json; charset=utf-8');
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Delete-Token');
	res.setHeader('Cache-Control', 'no-store');
	res.end(JSON.stringify(data));
}

/** @param {ApiRequest} req */
function parseQuery(req) {
	const url = new URL(req.url || '/', 'http://localhost');
	return url.searchParams;
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

/** @param {Record<string, any> | null} item */
function sanitizeShuttlePublic(item) {
	if (!item) return null;
	const { deleteTokenHash: _hidden, ...publicItem } = item;
	return publicItem;
}

/** @param {Record<string, any>} body */
function validateAndNormalizeSubmission(body) {
	const name = String(body.name || '').trim().slice(0, 100);
	const author = String(body.author || 'Инженер Станции').trim().slice(0, 60) || 'Инженер Станции';
	const description = String(body.description || '').trim().slice(0, 500);
	const tileWidth = Math.max(1, Math.min(500, Math.round(Number(body.tileWidth) || 20)));
	const tileHeight = Math.max(1, Math.min(500, Math.round(Number(body.tileHeight) || 20)));
	const entityCount = Math.max(0, Math.min(100000, Math.round(Number(body.entityCount) || 0)));
	const validSizes = new Set(['micro', 'small', 'medium', 'large']);
	const size = validSizes.has(body.size) ? String(body.size) : 'small';
	const hullClass = String(body.hullClass || 'shuttle').trim().slice(0, 32) || 'shuttle';
	const tags = Array.isArray(body.tags)
		? body.tags
				.map((/** @type {unknown} */ t) => String(t).trim().slice(0, 32))
				.filter(Boolean)
				.slice(0, 10)
				.map((/** @type {string} */ t) => (t.startsWith('#') ? t : `#${t}`))
		: ['#пользовательский'];
	const image = String(body.image || '');
	const yamlContent = typeof body.yamlContent === 'string' ? body.yamlContent : undefined;
	const yamlUrl = typeof body.yamlUrl === 'string' && body.yamlUrl.startsWith('https://') ? body.yamlUrl : undefined;

	if (!name) {
		throw httpError('Укажите название шаттла.', 400);
	}
	if (!image || (!image.startsWith('data:image/') && !image.startsWith('https://') && !image.startsWith('/'))) {
		throw httpError('Отсутствует изображение предпросмотра шаттла.', 400);
	}

	const id = `comm_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
	const deleteToken = crypto.randomBytes(16).toString('hex');
	const now = new Date().toISOString();

	return {
		id,
		deleteToken,
		deleteTokenHash: sha256(deleteToken),
		name,
		author,
		description:
			description || `Пользовательский шаттл (${tileWidth}×${tileHeight} тайлов, сущностей: ${entityCount}).`,
		createdAt: now,
		updatedAt: now,
		tileWidth,
		tileHeight,
		entityCount,
		size,
		hullClass,
		tags: tags.length > 0 ? tags : ['#пользовательский'],
		image,
		yamlContent,
		yamlUrl,
		likes: 1
	};
}

/** @returns {KvConfig | null} */
function getKvConfig() {
	const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
	const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
	return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

function detectStorageBackend() {
	const hasBlob = Boolean(
		process.env.BLOB_READ_WRITE_TOKEN || (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID)
	);
	const kv = getKvConfig();
	const githubToken = process.env.GITHUB_TOKEN;

	if (hasBlob) return 'blob';
	if (kv) return 'kv';
	if (githubToken) return 'github';
	if (!process.env.VERCEL) return 'local';
	return 'unconfigured';
}

// ---------------- Vercel Blob Backend ----------------

/** @type {'public' | 'private'} */
let blobAccessMode = process.env.BLOB_ACCESS === 'private' ? 'private' : 'public';

/**
 * @param {string} pathname
 * @param {string | Buffer} body
 * @param {{ addRandomSuffix?: boolean; allowOverwrite?: boolean; contentType?: string }} opts
 */
async function blobPutSmart(pathname, body, opts) {
	try {
		return await put(pathname, body, { ...opts, access: blobAccessMode });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (blobAccessMode === 'public' && msg.toLowerCase().includes('private')) {
			blobAccessMode = 'private';
			return await put(pathname, body, { ...opts, access: 'private' });
		}
		throw err;
	}
}

/**
 * @param {string} pathname
 * @param {string} [fallbackUrl]
 * @returns {Promise<{ buffer: Buffer; contentType: string } | null>}
 */
async function blobReadSmart(pathname, fallbackUrl) {
	if (blobAccessMode === 'public' && fallbackUrl) {
		try {
			const r = await fetch(fallbackUrl);
			if (r.ok) {
				const arr = await r.arrayBuffer();
				return {
					buffer: Buffer.from(arr),
					contentType: r.headers.get('content-type') || 'application/octet-stream'
				};
			}
		} catch {}
	}

	const tryOrder = blobAccessMode === 'private' ? /** @type {const} */ (['private', 'public']) : /** @type {const} */ (['private', 'public']);
	for (const access of tryOrder) {
		try {
			const result = await get(pathname, { access, useCache: false });
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

/** @param {string} prefix */
async function blobListAll(prefix) {
	/** @type {Awaited<ReturnType<typeof list>>['blobs']} */
	const all = [];
	/** @type {string | undefined} */
	let cursor;
	do {
		/** @type {Awaited<ReturnType<typeof list>>} */
		const page = await list({ prefix, limit: 1000, cursor });
		all.push(...page.blobs);
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return all;
}

async function blobGetAll() {
	const [metaBlobs, voteBlobs] = await Promise.all([
		blobListAll(BLOB_META_PREFIX),
		blobListAll(BLOB_LIKES_PREFIX)
	]);

	/** @type {Map<string, number>} */
	const votesByShuttle = new Map();
	for (const vb of voteBlobs) {
		const rel = vb.pathname.slice(BLOB_LIKES_PREFIX.length);
		const slashIdx = rel.indexOf('/');
		if (slashIdx <= 0) continue;
		const shuttleId = rel.slice(0, slashIdx);
		votesByShuttle.set(shuttleId, (votesByShuttle.get(shuttleId) || 0) + 1);
	}

	const items = await Promise.all(
		metaBlobs.map(async (mb) => {
			try {
				const loaded = await blobReadSmart(mb.pathname, mb.url);
				if (!loaded) return null;
				const meta = JSON.parse(loaded.buffer.toString('utf8'));
				const voteCount = votesByShuttle.get(meta.id);
				return sanitizeShuttlePublic({
					...meta,
					likes: typeof voteCount === 'number' && voteCount > 0 ? voteCount : meta.likes ?? 1
				});
			} catch {
				return null;
			}
		})
	);

	return items
		.filter((item) => item !== null)
		.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** @param {string} id */
async function blobGetOne(id) {
	const blobs = await blobListAll(`${BLOB_META_PREFIX}${id}.json`);
	if (blobs.length === 0) return null;
	const loaded = await blobReadSmart(blobs[0].pathname, blobs[0].url);
	if (!loaded) return null;
	const meta = JSON.parse(loaded.buffer.toString('utf8'));
	const voteBlobs = await blobListAll(`${BLOB_LIKES_PREFIX}${id}/`);
	let yamlContent = meta.yamlContent;
	if (!yamlContent) {
		const yamlLoaded = await blobReadSmart(`community-shuttles/maps/${id}.yml`);
		if (yamlLoaded) {
			yamlContent = yamlLoaded.buffer.toString('utf8');
		}
	}
	return {
		...meta,
		yamlContent,
		likes: voteBlobs.length > 0 ? voteBlobs.length : meta.likes ?? 1
	};
}

/** @param {ReturnType<typeof validateAndNormalizeSubmission>} draft */
async function blobCreate(draft) {
	let imageUrl = draft.image;
	const decoded = decodeImageDataUrl(draft.image);
	if (decoded) {
		const imgBlob = await blobPutSmart(`community-shuttles/images/${draft.id}.${decoded.ext}`, decoded.buffer, {
			addRandomSuffix: false,
			allowOverwrite: true,
			contentType: decoded.contentType
		});
		imageUrl =
			blobAccessMode === 'private'
				? `/api/gallery?blob=${encodeURIComponent(imgBlob.pathname)}`
				: imgBlob.url;
	}

	let yamlUrl = draft.yamlUrl;
	if (draft.yamlContent) {
		const yamlBlob = await blobPutSmart(`community-shuttles/maps/${draft.id}.yml`, draft.yamlContent, {
			addRandomSuffix: false,
			allowOverwrite: true,
			contentType: 'text/yaml; charset=utf-8'
		});
		yamlUrl =
			blobAccessMode === 'private'
				? `/api/gallery?blob=${encodeURIComponent(yamlBlob.pathname)}`
				: yamlBlob.url;
	}

	const meta = {
		id: draft.id,
		deleteTokenHash: draft.deleteTokenHash,
		name: draft.name,
		author: draft.author,
		description: draft.description,
		createdAt: draft.createdAt,
		updatedAt: draft.updatedAt,
		tileWidth: draft.tileWidth,
		tileHeight: draft.tileHeight,
		entityCount: draft.entityCount,
		size: draft.size,
		hullClass: draft.hullClass,
		tags: draft.tags,
		image: imageUrl,
		yamlUrl,
		likes: 1
	};

	await Promise.all([
		blobPutSmart(`${BLOB_META_PREFIX}${draft.id}.json`, JSON.stringify(meta), {
			addRandomSuffix: false,
			allowOverwrite: true,
			contentType: 'application/json; charset=utf-8'
		}),
		blobPutSmart(`${BLOB_LIKES_PREFIX}${draft.id}/author.txt`, '1', {
			addRandomSuffix: false,
			allowOverwrite: true,
			contentType: 'text/plain'
		})
	]);

	return sanitizeShuttlePublic(meta);
}

/**
 * @param {string} id
 * @param {string} voterId
 * @param {boolean} liked
 */
async function blobToggleLike(id, voterId, liked) {
	const safeVoter = String(voterId || 'anon').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'anon';
	const votePath = `${BLOB_LIKES_PREFIX}${id}/${safeVoter}.txt`;
	if (liked) {
		await blobPutSmart(votePath, '1', {
			addRandomSuffix: false,
			allowOverwrite: true,
			contentType: 'text/plain'
		});
	} else {
		const existing = await blobListAll(votePath);
		if (existing.length > 0) {
			await del(existing.map((b) => b.url));
		}
	}
	const voteBlobs = await blobListAll(`${BLOB_LIKES_PREFIX}${id}/`);
	return voteBlobs.length;
}

/**
 * @param {string} id
 * @param {string} token
 */
async function blobDelete(id, token) {
	const blobs = await blobListAll(`${BLOB_META_PREFIX}${id}.json`);
	if (blobs.length === 0) {
		throw httpError('Шаттл не найден.', 404);
	}
	const loaded = await blobReadSmart(blobs[0].pathname, blobs[0].url);
	if (!loaded) {
		throw httpError('Шаттл не найден.', 404);
	}
	const meta = JSON.parse(loaded.buffer.toString('utf8'));
	if (!token || sha256(token) !== meta.deleteTokenHash) {
		throw httpError('Нет прав на удаление этого шаттла.', 403);
	}

	const [imgBlobs, mapBlobs, voteBlobs] = await Promise.all([
		blobListAll(`community-shuttles/images/${id}.`),
		blobListAll(`community-shuttles/maps/${id}.`),
		blobListAll(`${BLOB_LIKES_PREFIX}${id}/`)
	]);
	const toDelete = [
		blobs[0].url,
		...imgBlobs.map((b) => b.url),
		...mapBlobs.map((b) => b.url),
		...voteBlobs.map((b) => b.url)
	];

	await del(toDelete);
}

// ---------------- Upstash Redis / Vercel KV Backend ----------------

/**
 * @param {KvConfig} kv
 * @param {unknown[]} args
 */
async function kvCommand(kv, args) {
	const res = await fetch(kv.url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${kv.token}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(args)
	});
	const data = await res.json();
	if (!res.ok || data.error) {
		throw new Error(data.error || `KV HTTP ${res.status}`);
	}
	return data.result;
}

/**
 * @param {KvConfig} kv
 * @param {unknown[][]} commands
 */
async function kvPipeline(kv, commands) {
	const res = await fetch(`${kv.url}/pipeline`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${kv.token}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(commands)
	});
	const data = await res.json();
	if (!res.ok) throw new Error(`KV Pipeline HTTP ${res.status}`);
	return data;
}

/** @param {KvConfig} kv */
async function kvGetAll(kv) {
	/** @type {string[]} */
	const ids = (await kvCommand(kv, ['SMEMBERS', 'webmap:gallery:ids'])) || [];
	if (ids.length === 0) return [];
	const itemCmds = ids.map((id) => ['GET', `webmap:gallery:item:${id}`]);
	const likeCmds = ids.map((id) => ['SCARD', `webmap:gallery:likes:${id}`]);
	const results = await kvPipeline(kv, [...itemCmds, ...likeCmds]);

	/** @type {Record<string, any>[]} */
	const items = [];
	for (let i = 0; i < ids.length; i++) {
		const raw = results[i]?.result;
		if (!raw) continue;
		try {
			const parsed = JSON.parse(raw);
			const likeCount = results[ids.length + i]?.result;
			const clean = sanitizeShuttlePublic({
				...parsed,
				likes: typeof likeCount === 'number' && likeCount > 0 ? likeCount : parsed.likes ?? 1
			});
			if (clean) items.push(clean);
		} catch {}
	}
	return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * @param {KvConfig} kv
 * @param {string} id
 */
async function kvGetOne(kv, id) {
	const [itemRes, likeRes] = await kvPipeline(kv, [
		['GET', `webmap:gallery:item:${id}`],
		['SCARD', `webmap:gallery:likes:${id}`]
	]);
	if (!itemRes?.result) return null;
	const parsed = JSON.parse(itemRes.result);
	const likes = typeof likeRes?.result === 'number' && likeRes.result > 0 ? likeRes.result : parsed.likes ?? 1;
	return { ...parsed, likes };
}

/**
 * @param {KvConfig} kv
 * @param {ReturnType<typeof validateAndNormalizeSubmission>} draft
 */
async function kvCreate(kv, draft) {
	const { deleteToken: _tok, ...stored } = draft;
	await kvPipeline(kv, [
		['SET', `webmap:gallery:item:${draft.id}`, JSON.stringify(stored)],
		['SADD', 'webmap:gallery:ids', draft.id],
		['SADD', `webmap:gallery:likes:${draft.id}`, 'author']
	]);
	return sanitizeShuttlePublic(stored);
}

/**
 * @param {KvConfig} kv
 * @param {string} id
 * @param {string} voterId
 * @param {boolean} liked
 */
async function kvToggleLike(kv, id, voterId, liked) {
	const safeVoter = String(voterId || 'anon').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'anon';
	await kvCommand(kv, [liked ? 'SADD' : 'SREM', `webmap:gallery:likes:${id}`, safeVoter]);
	const count = await kvCommand(kv, ['SCARD', `webmap:gallery:likes:${id}`]);
	return Number(count) || 0;
}

/**
 * @param {KvConfig} kv
 * @param {string} id
 * @param {string} token
 */
async function kvDelete(kv, id, token) {
	const raw = await kvCommand(kv, ['GET', `webmap:gallery:item:${id}`]);
	if (!raw) throw httpError('Шаттл не найден.', 404);
	const parsed = JSON.parse(raw);
	if (!token || sha256(token) !== parsed.deleteTokenHash) {
		throw httpError('Нет прав на удаление этого шаттла.', 403);
	}
	await kvPipeline(kv, [
		['SREM', 'webmap:gallery:ids', id],
		['DEL', `webmap:gallery:item:${id}`],
		['DEL', `webmap:gallery:likes:${id}`]
	]);
}

// ---------------- GitHub Branch Backend ----------------

/** @returns {GhConfig} */
function getGithubConfig() {
	return {
		token: process.env.GITHUB_TOKEN,
		repo: process.env.GALLERY_GITHUB_REPO || 'Cempeleti/webmap-exodus',
		branch: process.env.GALLERY_GITHUB_BRANCH || 'community-gallery'
	};
}

/**
 * @param {GhConfig} gh
 * @param {string} endpoint
 * @param {RequestInit} [opts]
 */
async function ghRequest(gh, endpoint, opts = {}) {
	return fetch(`https://api.github.com/repos/${gh.repo}${endpoint}`, {
		...opts,
		headers: {
			Authorization: `Bearer ${gh.token}`,
			Accept: 'application/vnd.github+json',
			'User-Agent': 'webmap-exodus-gallery',
			...(opts.headers || {})
		}
	});
}

/** @param {GhConfig} gh */
async function ensureGithubBranch(gh) {
	const check = await ghRequest(gh, `/git/ref/heads/${gh.branch}`);
	if (check.ok) return;
	const masterRef = await ghRequest(gh, '/git/ref/heads/master');
	if (!masterRef.ok) throw new Error('Cannot resolve master branch on GitHub');
	const masterData = await masterRef.json();
	const create = await ghRequest(gh, '/git/refs', {
		method: 'POST',
		body: JSON.stringify({
			ref: `refs/heads/${gh.branch}`,
			sha: masterData.object.sha
		})
	});
	if (!create.ok && create.status !== 422) {
		throw new Error(`Failed to create GitHub branch ${gh.branch}`);
	}
}

/**
 * @param {GhConfig} gh
 * @param {string} filePath
 * @param {string} contentBase64
 * @param {string} message
 * @param {string} [sha]
 */
async function ghPutFile(gh, filePath, contentBase64, message, sha) {
	const res = await ghRequest(gh, `/contents/${filePath}`, {
		method: 'PUT',
		body: JSON.stringify({
			message,
			content: contentBase64,
			branch: gh.branch,
			...(sha ? { sha } : {})
		})
	});
	if (!res.ok) {
		const txt = await res.text();
		throw new Error(`GitHub PUT ${filePath} failed: ${res.status} ${txt}`);
	}
	return res.json();
}

/** @param {GhConfig} gh */
async function ghGetAll(gh) {
	const res = await ghRequest(gh, `/contents/meta?ref=${gh.branch}`);
	if (res.status === 404) return [];
	if (!res.ok) throw new Error(`GitHub list meta failed: ${res.status}`);
	const files = await res.json();
	if (!Array.isArray(files)) return [];

	const items = await Promise.all(
		files
			.filter((f) => f.name.endsWith('.json'))
			.map(async (f) => {
				try {
					const r = await fetch(f.download_url);
					if (!r.ok) return null;
					const parsed = await r.json();
					return sanitizeShuttlePublic(parsed);
				} catch {
					return null;
				}
			})
	);
	return items
		.filter((item) => item !== null)
		.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * @param {GhConfig} gh
 * @param {string} id
 */
async function ghGetOne(gh, id) {
	const res = await ghRequest(gh, `/contents/meta/${id}.json?ref=${gh.branch}`);
	if (!res.ok) return null;
	const data = await res.json();
	return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
}

/**
 * @param {GhConfig} gh
 * @param {ReturnType<typeof validateAndNormalizeSubmission>} draft
 */
async function ghCreate(gh, draft) {
	await ensureGithubBranch(gh);
	let imageUrl = draft.image;
	const decoded = decodeImageDataUrl(draft.image);
	if (decoded) {
		const imgPath = `images/${draft.id}.${decoded.ext}`;
		await ghPutFile(gh, imgPath, decoded.buffer.toString('base64'), `gallery: add image ${draft.id}`);
		imageUrl = `https://raw.githubusercontent.com/${gh.repo}/${gh.branch}/${imgPath}`;
	}

	let yamlUrl = draft.yamlUrl;
	if (draft.yamlContent) {
		const mapPath = `maps/${draft.id}.yml`;
		await ghPutFile(
			gh,
			mapPath,
			Buffer.from(draft.yamlContent, 'utf8').toString('base64'),
			`gallery: add map ${draft.id}`
		);
		yamlUrl = `https://raw.githubusercontent.com/${gh.repo}/${gh.branch}/${mapPath}`;
	}

	const meta = {
		id: draft.id,
		deleteTokenHash: draft.deleteTokenHash,
		name: draft.name,
		author: draft.author,
		description: draft.description,
		createdAt: draft.createdAt,
		updatedAt: draft.updatedAt,
		tileWidth: draft.tileWidth,
		tileHeight: draft.tileHeight,
		entityCount: draft.entityCount,
		size: draft.size,
		hullClass: draft.hullClass,
		tags: draft.tags,
		image: imageUrl,
		yamlUrl,
		likes: 1,
		voters: ['author']
	};

	await ghPutFile(
		gh,
		`meta/${draft.id}.json`,
		Buffer.from(JSON.stringify(meta, null, 2), 'utf8').toString('base64'),
		`gallery: publish ${draft.name}`
	);
	return sanitizeShuttlePublic(meta);
}

/**
 * @param {GhConfig} gh
 * @param {string} id
 * @param {string} voterId
 * @param {boolean} liked
 */
async function ghToggleLike(gh, id, voterId, liked) {
	const res = await ghRequest(gh, `/contents/meta/${id}.json?ref=${gh.branch}`);
	if (!res.ok) throw httpError('Шаттл не найден.', 404);
	const file = await res.json();
	const meta = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
	const safeVoter = String(voterId || 'anon').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'anon';
	const voters = new Set(Array.isArray(meta.voters) ? meta.voters : ['author']);
	if (liked) voters.add(safeVoter);
	else voters.delete(safeVoter);
	meta.voters = Array.from(voters);
	meta.likes = meta.voters.length;
	await ghPutFile(
		gh,
		`meta/${id}.json`,
		Buffer.from(JSON.stringify(meta, null, 2), 'utf8').toString('base64'),
		`gallery: like ${id}`,
		file.sha
	);
	return meta.likes;
}

/**
 * @param {GhConfig} gh
 * @param {string} id
 * @param {string} token
 */
async function ghDelete(gh, id, token) {
	const res = await ghRequest(gh, `/contents/meta/${id}.json?ref=${gh.branch}`);
	if (!res.ok) throw httpError('Шаттл не найден.', 404);
	const file = await res.json();
	const meta = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
	if (!token || sha256(token) !== meta.deleteTokenHash) {
		throw httpError('Нет прав на удаление этого шаттла.', 403);
	}
	await ghRequest(gh, `/contents/meta/${id}.json`, {
		method: 'DELETE',
		body: JSON.stringify({
			message: `gallery: delete ${id}`,
			sha: file.sha,
			branch: gh.branch
		})
	});
}

// ---------------- Local Filesystem Backend (Dev only) ----------------

async function localEnsureDirs() {
	await fs.mkdir(path.join(LOCAL_DIR, 'meta'), { recursive: true });
	await fs.mkdir(path.join(LOCAL_DIR, 'images'), { recursive: true });
	await fs.mkdir(path.join(LOCAL_DIR, 'maps'), { recursive: true });
}

async function localGetAll() {
	await localEnsureDirs();
	const metaDir = path.join(LOCAL_DIR, 'meta');
	const entries = await fs.readdir(metaDir);
	/** @type {Record<string, any>[]} */
	const items = [];
	for (const name of entries) {
		if (!name.endsWith('.json')) continue;
		try {
			const raw = await fs.readFile(path.join(metaDir, name), 'utf8');
			const clean = sanitizeShuttlePublic(JSON.parse(raw));
			if (clean) items.push(clean);
		} catch {}
	}
	return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** @param {string} id */
async function localGetOne(id) {
	const filePath = path.join(LOCAL_DIR, 'meta', `${id}.json`);
	try {
		const raw = await fs.readFile(filePath, 'utf8');
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

/** @param {ReturnType<typeof validateAndNormalizeSubmission>} draft */
async function localCreate(draft) {
	await localEnsureDirs();
	let imageUrl = draft.image;
	const decoded = decodeImageDataUrl(draft.image);
	if (decoded) {
		const imgName = `${draft.id}.${decoded.ext}`;
		await fs.writeFile(path.join(LOCAL_DIR, 'images', imgName), decoded.buffer);
		imageUrl = `/api/gallery?asset=images/${imgName}`;
	}
	let yamlUrl = draft.yamlUrl;
	if (draft.yamlContent) {
		const mapName = `${draft.id}.yml`;
		await fs.writeFile(path.join(LOCAL_DIR, 'maps', mapName), draft.yamlContent, 'utf8');
		yamlUrl = `/api/gallery?asset=maps/${mapName}`;
	}
	const meta = {
		id: draft.id,
		deleteTokenHash: draft.deleteTokenHash,
		name: draft.name,
		author: draft.author,
		description: draft.description,
		createdAt: draft.createdAt,
		updatedAt: draft.updatedAt,
		tileWidth: draft.tileWidth,
		tileHeight: draft.tileHeight,
		entityCount: draft.entityCount,
		size: draft.size,
		hullClass: draft.hullClass,
		tags: draft.tags,
		image: imageUrl,
		yamlUrl,
		likes: 1,
		voters: ['author']
	};
	await fs.writeFile(path.join(LOCAL_DIR, 'meta', `${draft.id}.json`), JSON.stringify(meta, null, 2), 'utf8');
	return sanitizeShuttlePublic(meta);
}

/**
 * @param {string} id
 * @param {string} voterId
 * @param {boolean} liked
 */
async function localToggleLike(id, voterId, liked) {
	const meta = await localGetOne(id);
	if (!meta) throw httpError('Шаттл не найден.', 404);
	const safeVoter = String(voterId || 'anon').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'anon';
	const voters = new Set(Array.isArray(meta.voters) ? meta.voters : ['author']);
	if (liked) voters.add(safeVoter);
	else voters.delete(safeVoter);
	meta.voters = Array.from(voters);
	meta.likes = meta.voters.length;
	await fs.writeFile(path.join(LOCAL_DIR, 'meta', `${id}.json`), JSON.stringify(meta, null, 2), 'utf8');
	return meta.likes;
}

/**
 * @param {string} id
 * @param {string} token
 */
async function localDelete(id, token) {
	const meta = await localGetOne(id);
	if (!meta) throw httpError('Шаттл не найден.', 404);
	if (!token || sha256(token) !== meta.deleteTokenHash) {
		throw httpError('Нет прав на удаление этого шаттла.', 403);
	}
	await fs.rm(path.join(LOCAL_DIR, 'meta', `${id}.json`), { force: true });
	await fs.rm(path.join(LOCAL_DIR, 'maps', `${id}.yml`), { force: true });
	await fs.rm(path.join(LOCAL_DIR, 'images', `${id}.png`), { force: true });
	await fs.rm(path.join(LOCAL_DIR, 'images', `${id}.webp`), { force: true });
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
	const backend = detectStorageBackend();

	// Serve private Vercel Blob image/map assets when store uses private access
	const blobParam = query.get('blob');
	if (req.method === 'GET' && blobParam && backend === 'blob') {
		if (!blobParam.startsWith('community-shuttles/images/') && !blobParam.startsWith('community-shuttles/maps/')) {
			return sendJson(res, 403, { error: 'Forbidden' });
		}
		try {
			const loaded = await blobReadSmart(blobParam);
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

	// Serve local assets in dev mode
	const assetParam = query.get('asset');
	if (req.method === 'GET' && assetParam && backend === 'local') {
		const safeRel = path.normalize(assetParam).replace(/^(\.\.(\/|\\|$))+/, '');
		if (!safeRel.startsWith('images') && !safeRel.startsWith('maps')) {
			return sendJson(res, 403, { error: 'Forbidden' });
		}
		const fullPath = path.join(LOCAL_DIR, safeRel);
		try {
			const data = await fs.readFile(fullPath);
			res.statusCode = 200;
			res.setHeader('Access-Control-Allow-Origin', '*');
			if (fullPath.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
			else if (fullPath.endsWith('.webp')) res.setHeader('Content-Type', 'image/webp');
			else if (fullPath.endsWith('.yml')) res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
			return res.end(data);
		} catch {
			return sendJson(res, 404, { error: 'Not found' });
		}
	}

	if (backend === 'unconfigured') {
		if (req.method === 'GET') {
			return sendJson(res, 200, {
				configured: false,
				storageMode: 'unconfigured',
				shuttles: []
			});
		}
		return sendJson(res, 503, {
			code: 'STORAGE_NOT_CONFIGURED',
			error:
				'Общее хранилище на Vercel ещё не подключено. Откройте проект в Vercel → Storage → Create Database → Blob (или добавьте GITHUB_TOKEN в Environment Variables) и сделайте Redeploy.'
		});
	}

	try {
		const idParam = query.get('id');
		const action = query.get('action');

		if (req.method === 'GET') {
			if (idParam) {
				let item = null;
				if (backend === 'blob') item = await blobGetOne(idParam);
				else if (backend === 'kv') item = await kvGetOne(/** @type {KvConfig} */ (getKvConfig()), idParam);
				else if (backend === 'github') item = await ghGetOne(getGithubConfig(), idParam);
				else item = await localGetOne(idParam);

				if (!item) return sendJson(res, 404, { error: 'Шаттл не найден.' });
				const clean = sanitizeShuttlePublic(item);
				if (clean && !clean.yamlContent && clean.yamlUrl && clean.yamlUrl.startsWith('https://')) {
					try {
						const yr = await fetch(clean.yamlUrl);
						if (yr.ok) clean.yamlContent = await yr.text();
					} catch {}
				}
				return sendJson(res, 200, { configured: true, storageMode: backend, item: clean });
			}

			let shuttles = [];
			if (backend === 'blob') shuttles = await blobGetAll();
			else if (backend === 'kv') shuttles = await kvGetAll(/** @type {KvConfig} */ (getKvConfig()));
			else if (backend === 'github') shuttles = await ghGetAll(getGithubConfig());
			else shuttles = await localGetAll();

			return sendJson(res, 200, { configured: true, storageMode: backend, shuttles });
		}

		if ((req.method === 'POST' && action === 'like') || req.method === 'PATCH') {
			const body = await readJsonBody(req);
			const targetId = String(body.id || idParam || '').trim();
			if (!targetId) return sendJson(res, 400, { error: 'Missing shuttle id' });
			const liked = Boolean(body.liked);
			const voterId = String(body.voterId || 'anon');

			let likes = 0;
			if (backend === 'blob') likes = await blobToggleLike(targetId, voterId, liked);
			else if (backend === 'kv') likes = await kvToggleLike(/** @type {KvConfig} */ (getKvConfig()), targetId, voterId, liked);
			else if (backend === 'github') likes = await ghToggleLike(getGithubConfig(), targetId, voterId, liked);
			else likes = await localToggleLike(targetId, voterId, liked);

			return sendJson(res, 200, { ok: true, id: targetId, likes, liked });
		}

		if (req.method === 'POST') {
			const body = await readJsonBody(req);
			const draft = validateAndNormalizeSubmission(body);

			let created;
			if (backend === 'blob') created = await blobCreate(draft);
			else if (backend === 'kv') created = await kvCreate(/** @type {KvConfig} */ (getKvConfig()), draft);
			else if (backend === 'github') created = await ghCreate(getGithubConfig(), draft);
			else created = await localCreate(draft);

			return sendJson(res, 201, {
				ok: true,
				storageMode: backend,
				item: created,
				deleteToken: draft.deleteToken
			});
		}

		if (req.method === 'DELETE') {
			const targetId = String(idParam || '').trim();
			if (!targetId) return sendJson(res, 400, { error: 'Missing id' });
			const rawToken = req.headers['x-delete-token'] || query.get('token') || '';
			const token = Array.isArray(rawToken) ? rawToken[0] : String(rawToken);

			if (backend === 'blob') await blobDelete(targetId, token);
			else if (backend === 'kv') await kvDelete(/** @type {KvConfig} */ (getKvConfig()), targetId, token);
			else if (backend === 'github') await ghDelete(getGithubConfig(), targetId, token);
			else await localDelete(targetId, token);

			return sendJson(res, 200, { ok: true, deletedId: targetId });
		}

		return sendJson(res, 405, { error: 'Method not allowed' });
	} catch (err) {
		const typedErr = /** @type {{ statusCode?: number; message?: string }} */ (err);
		const status = typedErr?.statusCode || 500;
		console.error('Gallery API error:', err);
		return sendJson(res, status, {
			error: typedErr?.message || 'Внутренняя ошибка сервера галереи'
		});
	}
}
