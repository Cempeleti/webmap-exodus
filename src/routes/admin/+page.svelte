<script lang="ts">
	import { onMount } from 'svelte';
	import { asset, base, resolve } from '$app/paths';
	import { browser } from '$app/environment';
	import configJson from '$root/config.json' with { type: 'json' };
	import {
		getShuttles,
		shuttleConfig,
		shuttleGroupColors,
		formatPrice,
		fetchCatalogPublicState,
		mergeCatalogWithOverrides,
		invalidateCatalogStateCache,
		optimizeImageForUpload,
		getAdminToken,
		setAdminToken,
		adminApiFetch,
		type CatalogPublicState,
		type CommunityShuttle,
		type Shuttle
	} from '$lib';

	type AdminTab = 'batch' | 'catalog' | 'gallery' | 'settings';
	type BatchSource = 'site' | 'local' | 'monolith';
	type BatchJobStatus = 'pending' | 'rendering' | 'done' | 'error';

	interface BatchJob {
		key: string;
		id: string;
		name: string;
		sourceLabel: string;
		mapUrl?: string;
		monolithPath?: string;
		yamlText?: string;
		isCustom?: boolean;
		status: BatchJobStatus;
		previewUrl?: string;
		savedUrl?: string;
		dims?: string;
		entities?: number;
		error?: string;
	}

	interface MonolithFileEntry {
		path: string;
		name: string;
		size: number;
		kind?: 'shared' | 'poi';
	}

	interface RenderEngineResult {
		ok: boolean;
		dataUrl?: string;
		width?: number;
		height?: number;
		tileWidth?: number;
		tileHeight?: number;
		entityCount?: number;
		error?: string;
	}

	const baseShuttles = getShuttles();

	// Auth state
	let authLoading = $state(true);
	let initialized = $state(true);
	let authenticated = $state(false);
	let authSource = $state<'env' | 'storage'>('storage');
	let backendMode = $state('unknown');
	let authConfigured = $state(true);
	let passwordInput = $state('');
	let passwordConfirmInput = $state('');
	let authError = $state<string | null>(null);
	let authSubmitting = $state(false);

	// Global UI state
	let activeTab = $state<AdminTab>('batch');
	let toast = $state<{ msg: string; kind: 'ok' | 'err' } | null>(null);
	let catalogState = $state<CatalogPublicState | null>(null);

	// Embedded headless SS14 batch render engine
	let renderFrameEl = $state<HTMLIFrameElement | null>(null);
	let batchEngineReady = $state(false);
	let batchEngineInfo = $state('Инициализация ядра рендера Monolith...');
	const pendingRenderJobs = new Map<
		string,
		{ resolve: (res: RenderEngineResult) => void; timer: ReturnType<typeof setTimeout> }
	>();

	// Batch renderer state
	let batchSource = $state<BatchSource>('site');
	let batchFilterGroup = $state('');
	let batchSearch = $state('');
	let batchOnlyUnrendered = $state(false);
	let batchAutoSave = $state(true);
	let batchBgMode = $state<'transparent' | 'dark'>('transparent');
	let batchMaxDim = $state(2048);
	let batchSelectedIds = $state<Set<string>>(new Set());
	let batchJobs = $state<BatchJob[]>([]);
	let batchRunning = $state(false);
	let batchPaused = $state(false);
	let batchStopRequested = $state(false);
	let batchLatestPreview = $state<BatchJob | null>(null);
	let batchStartedAt = $state<number>(0);
	let batchElapsedSec = $state(0);

	// Local YAML files & Monolith GitHub tree
	let localYamlFiles = $state<Array<{ id: string; name: string; filename: string; yamlText: string }>>([]);
	let monolithFiles = $state<MonolithFileEntry[]>([]);
	let monolithKindFilter = $state<'all' | 'shared' | 'poi'>('all');
	let monolithLoading = $state(false);
	let monolithError = $state<string | null>(null);
	let monolithSelectedPaths = $state<Set<string>>(new Set());

	// Catalog management state
	let catalogSearch = $state('');
	let catalogGroupFilter = $state('');
	let catalogOnlyEdited = $state(false);
	let editingShuttle = $state<(Shuttle & { _isCustom?: boolean; _hidden?: boolean }) | null>(null);
	let editForm = $state({
		name: '',
		description: '',
		price: 0,
		group: 'shipyard',
		hullClass: 'shuttle',
		size: 'small',
		voucher: false,
		hidden: false,
		imageDataUrl: '',
		yamlContent: ''
	});
	let isSavingEdit = $state(false);
	let rerenderingId = $state<string | null>(null);

	// New Shuttle modal state
	let showAddShuttle = $state(false);
	let newShuttleForm = $state({
		id: '',
		name: '',
		description: '',
		price: 0,
		group: 'custom',
		hullClass: 'shuttle',
		size: 'small',
		voucher: false,
		yamlContent: '',
		imageDataUrl: '',
		tileWidth: 0,
		tileHeight: 0,
		entityCount: 0
	});
	let isRenderingNewShuttle = $state(false);
	let isCreatingShuttle = $state(false);

	// Community gallery moderation state
	let galleryItems = $state<CommunityShuttle[]>([]);
	let galleryLoading = $state(false);
	let gallerySearch = $state('');
	let editingCommunity = $state<CommunityShuttle | null>(null);
	let communityEditForm = $state({
		name: '',
		author: '',
		description: '',
		tags: '',
		featured: false
	});

	// Settings state
	let bannerTextInput = $state('');
	let bannerTypeInput = $state<'info' | 'warning' | 'success'>('info');
	let isSavingSettings = $state(false);
	let currentPassInput = $state('');
	let newPassInput = $state('');
	let isChangingPass = $state(false);

	function showToast(msg: string, kind: 'ok' | 'err' = 'ok') {
		toast = { msg, kind };
		setTimeout(() => {
			if (toast?.msg === msg) toast = null;
		}, 3800);
	}

	const mergedCatalog = $derived(
		mergeCatalogWithOverrides(baseShuttles, catalogState, { includeHidden: true })
	);

	const overrideCount = $derived(Object.keys(catalogState?.overrides || {}).length);
	const customCount = $derived((catalogState?.customShuttles || []).length);

	const siteBatchCandidates = $derived.by(() => {
		const q = batchSearch.trim().toLowerCase();
		return mergedCatalog.filter((s) => {
			const hasOverrideImg = Boolean(catalogState?.overrides?.[s.id]?.image);
			if (batchOnlyUnrendered && hasOverrideImg) return false;
			if (batchFilterGroup && s.group !== batchFilterGroup) return false;
			if (q) {
				const hay = `${s.id} ${s.name}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return Boolean(s.mapPath || s.yamlUrl);
		});
	});

	const filteredMonolithFiles = $derived.by(() => {
		const q = batchSearch.trim().toLowerCase();
		return monolithFiles.filter((f) => {
			const kind = f.kind ?? (f.path.startsWith('Resources/SharedMaps/') ? 'shared' : 'poi');
			if (monolithKindFilter !== 'all' && kind !== monolithKindFilter) return false;
			if (!q) return true;
			return f.path.toLowerCase().includes(q);
		});
	});

	const filteredCatalog = $derived.by(() => {
		const q = catalogSearch.trim().toLowerCase();
		return mergedCatalog.filter((s) => {
			if (catalogOnlyEdited && !(s as any)._hasOverride && !(s as any)._isCustom) return false;
			if (catalogGroupFilter && s.group !== catalogGroupFilter) return false;
			if (q) {
				const hay = `${s.id} ${s.name} ${s.description}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	});

	const filteredGallery = $derived.by(() => {
		const q = gallerySearch.trim().toLowerCase();
		if (!q) return galleryItems;
		return galleryItems.filter((item) =>
			`${item.name} ${item.author} ${item.id} ${(item.tags || []).join(' ')}`
				.toLowerCase()
				.includes(q)
		);
	});

	const batchStats = $derived.by(() => {
		const total = batchJobs.length;
		const done = batchJobs.filter((j) => j.status === 'done').length;
		const err = batchJobs.filter((j) => j.status === 'error').length;
		const finished = done + err;
		const pct = total > 0 ? Math.round((finished / total) * 100) : 0;
		return { total, done, err, finished, pct };
	});

	function resolveShuttleImg(image: string): string {
		if (!image) return '';
		if (
			image.startsWith('data:') ||
			image.startsWith('http://') ||
			image.startsWith('https://') ||
			image.startsWith('/api/')
		) {
			return image;
		}
		return asset(image as `/${string}`);
	}

	function resolveMapFetchUrl(s: Shuttle): string | null {
		if (s.yamlUrl) return s.yamlUrl;
		if (s.mapPath) {
			if (s.mapPath.startsWith('/api/') || s.mapPath.startsWith('http')) return s.mapPath;
			return s.mapPath.startsWith('static/')
				? `${base}/${s.mapPath.slice(7)}`
				: `${base}/editor/${s.mapPath}`;
		}
		return null;
	}

	async function loadPublicCatalog(force = false) {
		const st = await fetchCatalogPublicState(force);
		catalogState = st;
		bannerTextInput = st.siteSettings?.bannerText || '';
		bannerTypeInput = st.siteSettings?.bannerType || 'info';
	}

	async function checkAuthStatus() {
		authLoading = true;
		try {
			const res = await adminApiFetch<{
				initialized: boolean;
				authenticated: boolean;
				authSource: 'env' | 'storage';
				backend: string;
				configured: boolean;
			}>('/api/admin?action=auth-status');
			initialized = res.initialized;
			authenticated = res.authenticated;
			authSource = res.authSource;
			backendMode = res.backend;
			authConfigured = res.configured;
			if (authenticated) {
				await Promise.all([loadPublicCatalog(true), loadCommunityGallery()]);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes('не подключено') || msg.includes('BLOB')) {
				authConfigured = false;
			}
			authError = msg;
		} finally {
			authLoading = false;
		}
	}

	async function loadCommunityGallery() {
		if (!authenticated) return;
		galleryLoading = true;
		try {
			const res = await adminApiFetch<{ shuttles: CommunityShuttle[] }>(
				'/api/admin?action=gallery-list'
			);
			galleryItems = res.shuttles || [];
		} catch (e) {
			showToast(`Ошибка загрузки галереи: ${e instanceof Error ? e.message : e}`, 'err');
		} finally {
			galleryLoading = false;
		}
	}

	onMount(() => {
		if (!browser) return;
		checkAuthStatus();

		const onMessage = (event: MessageEvent) => {
			if (event.origin !== window.location.origin) return;
			const msg = event.data;
			if (!msg || typeof msg !== 'object') return;

			if (msg.type === 'WEBMAP_BATCH_READY') {
				batchEngineReady = true;
				batchEngineInfo = `Готово: ${msg.entityCount ?? 0} сущностей, ${msg.tileCount ?? 0} тайлов`;
				return;
			}

			if (msg.type === 'WEBMAP_RENDER_RESULT') {
				const pending = pendingRenderJobs.get(String(msg.jobId || ''));
				if (pending) {
					clearTimeout(pending.timer);
					pendingRenderJobs.delete(String(msg.jobId || ''));
					pending.resolve(msg as RenderEngineResult);
				}
			}
		};

		window.addEventListener('message', onMessage);
		const pingTimer = setInterval(() => {
			if (!batchEngineReady && renderFrameEl?.contentWindow) {
				renderFrameEl.contentWindow.postMessage(
					{ type: 'WEBMAP_BATCH_PING' },
					window.location.origin
				);
			}
		}, 1200);

		return () => {
			window.removeEventListener('message', onMessage);
			clearInterval(pingTimer);
		};
	});

	async function handleAuthSubmit(e: SubmitEvent) {
		e.preventDefault();
		authError = null;
		const pw = passwordInput.trim();
		if (pw.length < 4) {
			authError = 'Пароль должен содержать минимум 4 символа.';
			return;
		}
		if (!initialized && pw !== passwordConfirmInput.trim()) {
			authError = 'Пароли не совпадают.';
			return;
		}

		const wasInitialized = initialized;
		authSubmitting = true;
		try {
			const endpoint = wasInitialized ? '/api/admin?action=login' : '/api/admin?action=setup';
			const res = await adminApiFetch<{ ok: boolean; token?: string }>(endpoint, {
				method: 'POST',
				body: JSON.stringify({ password: pw })
			});
			if (res.token) setAdminToken(res.token);
			initialized = true;
			authenticated = true;
			passwordInput = '';
			passwordConfirmInput = '';
			showToast(wasInitialized ? 'Вы вошли в админ-панель' : 'Пароль администратора создан');
			await Promise.all([loadPublicCatalog(true), loadCommunityGallery()]);
		} catch (err) {
			authError = err instanceof Error ? err.message : 'Ошибка входа';
		} finally {
			authSubmitting = false;
		}
	}

	async function handleLogout() {
		try {
			await adminApiFetch('/api/admin?action=logout', { method: 'POST', body: '{}' });
		} catch {}
		setAdminToken('');
		authenticated = false;
		showToast('Вы вышли из админ-панели');
	}

	function renderYamlViaEngine(
		yamlText: string,
		opts?: { backgroundColor?: string | null; maxDimension?: number }
	): Promise<RenderEngineResult> {
		if (!batchEngineReady || !renderFrameEl?.contentWindow) {
			return Promise.reject(new Error('Ядро рендера ещё загружается. Подождите пару секунд.'));
		}
		const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				pendingRenderJobs.delete(jobId);
				reject(new Error('Таймаут рендера шаттла (35 сек)'));
			}, 35000);
			pendingRenderJobs.set(jobId, { resolve, timer });
			renderFrameEl!.contentWindow!.postMessage(
				{
					type: 'WEBMAP_RENDER_YAML',
					jobId,
					yamlText,
					backgroundColor:
						opts?.backgroundColor !== undefined
							? opts.backgroundColor
							: batchBgMode === 'dark'
								? '#080c16'
								: null,
					maxDimension: opts?.maxDimension ?? batchMaxDim
				},
				window.location.origin
			);
		});
	}

	function notifyCatalogChanged() {
		invalidateCatalogStateCache();
		if (typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent('webmap:catalog_updated'));
		}
	}

	// -------- Batch Runner Logic --------

	function toggleSelectAllSite() {
		const next = new Set(batchSelectedIds);
		const allSelected =
			siteBatchCandidates.length > 0 && siteBatchCandidates.every((s) => next.has(s.id));
		if (allSelected) {
			for (const s of siteBatchCandidates) next.delete(s.id);
		} else {
			for (const s of siteBatchCandidates) next.add(s.id);
		}
		batchSelectedIds = next;
	}

	function toggleSiteId(id: string) {
		const next = new Set(batchSelectedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		batchSelectedIds = next;
	}

	function toggleMonolithPath(p: string) {
		const next = new Set(monolithSelectedPaths);
		if (next.has(p)) next.delete(p);
		else next.add(p);
		monolithSelectedPaths = next;
	}

	function toggleSelectAllMonolith() {
		const next = new Set(monolithSelectedPaths);
		const allSelected =
			filteredMonolithFiles.length > 0 && filteredMonolithFiles.every((f) => next.has(f.path));
		if (allSelected) {
			for (const f of filteredMonolithFiles) next.delete(f.path);
		} else {
			for (const f of filteredMonolithFiles) next.add(f.path);
		}
		monolithSelectedPaths = next;
	}

	async function handleLoadMonolithTree() {
		monolithLoading = true;
		monolithError = null;
		try {
			const res = await adminApiFetch<{ files: MonolithFileEntry[] }>(
				'/api/admin?action=monolith-tree'
			);
			monolithFiles = res.files || [];
			showToast(`Загружен список карт Monolith: ${monolithFiles.length} файлов`);
		} catch (e) {
			monolithError = e instanceof Error ? e.message : String(e);
		} finally {
			monolithLoading = false;
		}
	}

	async function handleLocalFilesSelected(files: FileList | null) {
		if (!files || files.length === 0) return;
		const parsed: typeof localYamlFiles = [];
		for (const file of Array.from(files)) {
			if (!file.name.endsWith('.yml') && !file.name.endsWith('.yaml')) continue;
			const yamlText = await file.text();
			const stem = file.name.replace(/\.(yml|yaml)$/i, '');
			const existingMatch = mergedCatalog.find(
				(s) => s.id.toLowerCase() === stem.toLowerCase()
			);
			parsed.push({
				id: existingMatch ? existingMatch.id : `custom_${stem.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
				name: existingMatch ? existingMatch.name : stem,
				filename: file.name,
				yamlText
			});
		}
		localYamlFiles = [...localYamlFiles, ...parsed];
		showToast(`Добавлено YAML-файлов: ${parsed.length}`);
	}

	function buildQueueFromSelection(renderAllDefault = false): BatchJob[] {
		if (batchSource === 'site') {
			const chosen =
				!renderAllDefault && batchSelectedIds.size > 0
					? siteBatchCandidates.filter((s) => batchSelectedIds.has(s.id))
					: siteBatchCandidates;
			return chosen.map((s) => ({
				key: `site:${s.id}`,
				id: s.id,
				name: s.name,
				sourceLabel: s.mapPath || 'custom',
				mapUrl: resolveMapFetchUrl(s) || undefined,
				isCustom: Boolean((s as any)._isCustom),
				status: 'pending'
			}));
		}

		if (batchSource === 'local') {
			return localYamlFiles.map((f, idx) => ({
				key: `local:${f.id}:${idx}`,
				id: f.id,
				name: f.name,
				sourceLabel: f.filename,
				yamlText: f.yamlText,
				isCustom: !baseShuttles.some((b) => b.id === f.id),
				status: 'pending'
			}));
		}

		// Monolith GitHub direct source (SharedMaps shuttles + Maps POI only)
		const chosen =
			monolithSelectedPaths.size > 0
				? filteredMonolithFiles.filter((f) => monolithSelectedPaths.has(f.path))
				: filteredMonolithFiles;
		return chosen.map((f) => {
			const stem = f.name.replace(/\.yml$/i, '');
			const stemLow = stem.toLowerCase();
			const lowerPath = f.path.toLowerCase();

			let existingMatch: Shuttle | undefined;
			if (lowerPath.includes('/companies/blackhawk/scarab.yml')) {
				existingMatch = mergedCatalog.find((s) => s.id === 'BlackhawkScarab');
			} else if (lowerPath.includes('/expedition/medusa.yml')) {
				existingMatch = mergedCatalog.find((s) => s.id === 'Medusa');
			} else if (lowerPath.includes('/world/')) {
				existingMatch = mergedCatalog.find((s) => s.id.toLowerCase() === `drone-${stemLow}`);
			} else if (lowerPath.includes('/poi/')) {
				existingMatch = mergedCatalog.find(
					(s) =>
						s.id.toLowerCase() === `station-${stemLow.replace(/_/g, '-')}` ||
						(s.group === 'station' &&
							s.image.replace(/^\//, '').replace(/-0\.png$/i, '').toLowerCase() === stemLow)
				);
			}
			if (!existingMatch) {
				existingMatch = mergedCatalog.find(
					(s) =>
						s.id.toLowerCase() === stemLow ||
						s.image.replace(/^\//, '').replace(/-0\.png$/i, '').toLowerCase() === stemLow
				);
			}

			return {
				key: `mono:${f.path}`,
				id: existingMatch ? existingMatch.id : `mono_${stem.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
				name: existingMatch ? existingMatch.name : stem,
				sourceLabel: f.path.replace(/^Resources\//, ''),
				monolithPath: f.path,
				isCustom: !existingMatch,
				status: 'pending'
			};
		});
	}

	async function executeBatchQueue(jobs: BatchJob[]) {
		if (jobs.length === 0) {
			showToast('Нет шаттлов для рендера в очереди.', 'err');
			return;
		}
		if (!batchEngineReady) {
			showToast('Ядро рендера ещё загружается — подождите завершения загрузки текстур.', 'err');
			return;
		}

		batchJobs = jobs;
		batchRunning = true;
		batchPaused = false;
		batchStopRequested = false;
		batchStartedAt = Date.now();
		batchElapsedSec = 0;
		batchLatestPreview = null;
		const elapsedTimer = setInterval(() => {
			if (batchRunning && !batchPaused) {
				batchElapsedSec = Math.round((Date.now() - batchStartedAt) / 1000);
			}
		}, 1000);

		for (let i = 0; i < batchJobs.length; i++) {
			if (batchStopRequested) break;
			while (batchPaused && !batchStopRequested) {
				await new Promise((r) => setTimeout(r, 200));
			}
			if (batchStopRequested) break;

			const job = batchJobs[i];
			if (job.status === 'done') continue;

			batchJobs[i] = { ...job, status: 'rendering', error: undefined };
			try {
				let yamlText = job.yamlText;
				if (!yamlText && job.mapUrl) {
					const r = await fetch(job.mapUrl);
					if (!r.ok) throw new Error(`YAML HTTP ${r.status}`);
					yamlText = await r.text();
				} else if (!yamlText && job.monolithPath) {
					const r = await adminApiFetch<{ yamlContent: string }>(
						`/api/admin?action=monolith-file&path=${encodeURIComponent(job.monolithPath)}`
					);
					yamlText = r.yamlContent;
				}
				if (!yamlText) throw new Error('Не найден YAML шаттла');

				const rendered = await renderYamlViaEngine(yamlText);
				if (!rendered.ok || !rendered.dataUrl) {
					throw new Error(rendered.error || 'Сбой рендера');
				}

				const optimized = await optimizeImageForUpload(rendered.dataUrl);
				let savedUrl: string | undefined;

				if (batchAutoSave) {
					const saved = await adminApiFetch<{ imageUrl?: string }>(
						'/api/admin?action=save-shuttle',
						{
							method: 'POST',
							body: JSON.stringify({
								id: job.id,
								isCustom: job.isCustom,
								imageDataUrl: optimized,
								...(job.isCustom ? { yamlContent: yamlText } : {}),
								tileWidth: rendered.tileWidth,
								tileHeight: rendered.tileHeight,
								entityCount: rendered.entityCount,
								patch: job.isCustom ? { name: job.name } : {}
							})
						}
					);
					savedUrl = saved.imageUrl;
				}

				const finishedJob: BatchJob = {
					...batchJobs[i],
					status: 'done',
					previewUrl: optimized,
					savedUrl,
					dims: `${rendered.tileWidth ?? '?'}×${rendered.tileHeight ?? '?'}`,
					entities: rendered.entityCount
				};
				batchJobs[i] = finishedJob;
				batchLatestPreview = finishedJob;
			} catch (err) {
				batchJobs[i] = {
					...batchJobs[i],
					status: 'error',
					error: err instanceof Error ? err.message : String(err)
				};
			}
		}

		clearInterval(elapsedTimer);
		batchElapsedSec = Math.round((Date.now() - batchStartedAt) / 1000);
		batchRunning = false;
		batchPaused = false;
		if (batchAutoSave) {
			await loadPublicCatalog(true);
			notifyCatalogChanged();
		}
		showToast(
			batchStopRequested
				? 'Пакетный рендер остановлен'
				: `Рендер завершён: ${batchStats.done} успешно, ${batchStats.err} с ошибкой`
		);
	}

	async function handleRetrySingleJob(idx: number) {
		if (batchRunning) return;
		const copy = [...batchJobs];
		const target = { ...copy[idx], status: 'pending' as const, error: undefined };
		copy[idx] = target;
		batchJobs = copy;
		batchRunning = true;
		batchStopRequested = false;
		batchPaused = false;
		batchStartedAt = Date.now();
		try {
			let yamlText = target.yamlText;
			if (!yamlText && target.mapUrl) {
				const r = await fetch(target.mapUrl);
				if (!r.ok) throw new Error(`YAML HTTP ${r.status}`);
				yamlText = await r.text();
			} else if (!yamlText && target.monolithPath) {
				const r = await adminApiFetch<{ yamlContent: string }>(
					`/api/admin?action=monolith-file&path=${encodeURIComponent(target.monolithPath)}`
				);
				yamlText = r.yamlContent;
			}
			if (!yamlText) throw new Error('Не найден YAML шаттла');
			batchJobs[idx] = { ...target, status: 'rendering' };
			const rendered = await renderYamlViaEngine(yamlText);
			if (!rendered.ok || !rendered.dataUrl) throw new Error(rendered.error || 'Сбой рендера');
			const optimized = await optimizeImageForUpload(rendered.dataUrl);
			let savedUrl: string | undefined;
			if (batchAutoSave) {
				const saved = await adminApiFetch<{ imageUrl?: string }>('/api/admin?action=save-shuttle', {
					method: 'POST',
					body: JSON.stringify({
						id: target.id,
						isCustom: target.isCustom,
						imageDataUrl: optimized,
						...(target.isCustom ? { yamlContent: yamlText } : {}),
						tileWidth: rendered.tileWidth,
						tileHeight: rendered.tileHeight,
						entityCount: rendered.entityCount,
						patch: target.isCustom ? { name: target.name } : {}
					})
				});
				savedUrl = saved.imageUrl;
				await loadPublicCatalog(true);
				notifyCatalogChanged();
			}
			batchJobs[idx] = {
				...batchJobs[idx],
				status: 'done',
				previewUrl: optimized,
				savedUrl,
				dims: `${rendered.tileWidth ?? '?'}×${rendered.tileHeight ?? '?'}`,
				entities: rendered.entityCount
			};
			batchLatestPreview = batchJobs[idx];
		} catch (e) {
			batchJobs[idx] = {
				...batchJobs[idx],
				status: 'error',
				error: e instanceof Error ? e.message : String(e)
			};
		} finally {
			batchElapsedSec = Math.round((Date.now() - batchStartedAt) / 1000);
			batchRunning = false;
		}
	}

	function downloadBatchManifest() {
		const payload = batchJobs
			.filter((j) => j.status === 'done')
			.map((j) => ({
				id: j.id,
				name: j.name,
				dims: j.dims,
				entities: j.entities,
				image: j.savedUrl || j.previewUrl
			}));
		const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `rendered-shuttles-${Date.now()}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	// -------- Catalog Edit / Single Re-render --------

	async function handleRerenderCatalogShuttle(s: Shuttle & { _isCustom?: boolean }) {
		if (!batchEngineReady) {
			showToast('Ядро рендера ещё загружается...', 'err');
			return;
		}
		const url = resolveMapFetchUrl(s);
		if (!url) {
			showToast('У этого шаттла отсутствует YAML карты.', 'err');
			return;
		}
		rerenderingId = s.id;
		try {
			const r = await fetch(url);
			if (!r.ok) throw new Error(`YAML HTTP ${r.status}`);
			const yamlText = await r.text();
			const rendered = await renderYamlViaEngine(yamlText);
			if (!rendered.ok || !rendered.dataUrl) throw new Error(rendered.error || 'Сбой рендера');
			const optimized = await optimizeImageForUpload(rendered.dataUrl);
			await adminApiFetch('/api/admin?action=save-shuttle', {
				method: 'POST',
				body: JSON.stringify({
					id: s.id,
					isCustom: Boolean(s._isCustom),
					imageDataUrl: optimized,
					tileWidth: rendered.tileWidth,
					tileHeight: rendered.tileHeight,
					entityCount: rendered.entityCount
				})
			});
			await loadPublicCatalog(true);
			notifyCatalogChanged();
			showToast(`Шаттл «${s.name}» перерендерен и сохранён`);
		} catch (e) {
			showToast(`Ошибка рендера: ${e instanceof Error ? e.message : e}`, 'err');
		} finally {
			rerenderingId = null;
		}
	}

	function openEditShuttleModal(s: Shuttle & { _isCustom?: boolean; _hidden?: boolean }) {
		editingShuttle = s;
		editForm = {
			name: s.name,
			description: s.description || '',
			price: s.price || 0,
			group: s.group,
			hullClass: s.hullClass || 'shuttle',
			size: s.size || 'small',
			voucher: Boolean(s.voucher),
			hidden: Boolean(s._hidden),
			imageDataUrl: '',
			yamlContent: ''
		};
	}

	async function handleSaveShuttleEdit(e: SubmitEvent) {
		e.preventDefault();
		if (!editingShuttle) return;
		isSavingEdit = true;
		try {
			const optimized = editForm.imageDataUrl
				? await optimizeImageForUpload(editForm.imageDataUrl)
				: '';
			await adminApiFetch('/api/admin?action=save-shuttle', {
				method: 'POST',
				body: JSON.stringify({
					id: editingShuttle.id,
					isCustom: Boolean(editingShuttle._isCustom),
					...(optimized ? { imageDataUrl: optimized } : {}),
					...(editForm.yamlContent ? { yamlContent: editForm.yamlContent } : {}),
					patch: {
						name: editForm.name,
						description: editForm.description,
						price: Number(editForm.price) || 0,
						group: editForm.group,
						hullClass: editForm.hullClass,
						size: editForm.size,
						voucher: editForm.voucher,
						hidden: editForm.hidden
					}
				})
			});
			editingShuttle = null;
			await loadPublicCatalog(true);
			notifyCatalogChanged();
			showToast('Изменения шаттла сохранены');
		} catch (err) {
			showToast(`Ошибка сохранения: ${err instanceof Error ? err.message : err}`, 'err');
		} finally {
			isSavingEdit = false;
		}
	}

	async function handleResetOrDeleteShuttle(s: Shuttle & { _isCustom?: boolean }) {
		const label = s._isCustom ? `Удалить добавленный шаттл «${s.name}»?` : `Сбросить переопределения для «${s.name}»?`;
		if (!confirm(label)) return;
		try {
			await adminApiFetch(`/api/admin?action=delete-shuttle&id=${encodeURIComponent(s.id)}`, {
				method: 'DELETE'
			});
			await loadPublicCatalog(true);
			notifyCatalogChanged();
			showToast(s._isCustom ? 'Шаттл удалён из каталога' : 'Правки и кастомный рендер сброшены');
		} catch (err) {
			showToast(`Ошибка: ${err instanceof Error ? err.message : err}`, 'err');
		}
	}

	// -------- New Custom Catalog Shuttle --------

	async function handleNewShuttleYamlUpload(files: FileList | null) {
		const file = files?.[0];
		if (!file) return;
		const text = await file.text();
		newShuttleForm.yamlContent = text;
		const stem = file.name.replace(/\.(yml|yaml)$/i, '');
		if (!newShuttleForm.name) newShuttleForm.name = stem;
		if (!newShuttleForm.id) {
			newShuttleForm.id = `ship_${stem.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}`;
		}
		if (batchEngineReady) {
			isRenderingNewShuttle = true;
			try {
				const rendered = await renderYamlViaEngine(text);
				if (rendered.ok && rendered.dataUrl) {
					newShuttleForm.imageDataUrl = await optimizeImageForUpload(rendered.dataUrl);
					newShuttleForm.tileWidth = rendered.tileWidth || 0;
					newShuttleForm.tileHeight = rendered.tileHeight || 0;
					newShuttleForm.entityCount = rendered.entityCount || 0;
				}
			} catch (e) {
				showToast(`Авторендер не удался: ${e instanceof Error ? e.message : e}`, 'err');
			} finally {
				isRenderingNewShuttle = false;
			}
		}
	}

	async function handleCreateNewShuttle(e: SubmitEvent) {
		e.preventDefault();
		const id = newShuttleForm.id.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
		if (!id || !newShuttleForm.name.trim()) {
			showToast('Укажите ID и название шаттла.', 'err');
			return;
		}
		isCreatingShuttle = true;
		try {
			const optimized = newShuttleForm.imageDataUrl
				? await optimizeImageForUpload(newShuttleForm.imageDataUrl)
				: '';
			await adminApiFetch('/api/admin?action=save-shuttle', {
				method: 'POST',
				body: JSON.stringify({
					id,
					isCustom: true,
					...(optimized ? { imageDataUrl: optimized } : {}),
					...(newShuttleForm.yamlContent ? { yamlContent: newShuttleForm.yamlContent } : {}),
					tileWidth: newShuttleForm.tileWidth || undefined,
					tileHeight: newShuttleForm.tileHeight || undefined,
					entityCount: newShuttleForm.entityCount || undefined,
					patch: {
						name: newShuttleForm.name.trim(),
						description: newShuttleForm.description.trim(),
						price: Number(newShuttleForm.price) || 0,
						group: newShuttleForm.group,
						hullClass: newShuttleForm.hullClass,
						size: newShuttleForm.size,
						voucher: newShuttleForm.voucher,
						hidden: false
					}
				})
			});
			showAddShuttle = false;
			newShuttleForm = {
				id: '',
				name: '',
				description: '',
				price: 0,
				group: 'custom',
				hullClass: 'shuttle',
				size: 'small',
				voucher: false,
				yamlContent: '',
				imageDataUrl: '',
				tileWidth: 0,
				tileHeight: 0,
				entityCount: 0
			};
			await loadPublicCatalog(true);
			notifyCatalogChanged();
			showToast('Новый шаттл добавлен на сайт!');
		} catch (err) {
			showToast(`Ошибка создания: ${err instanceof Error ? err.message : err}`, 'err');
		} finally {
			isCreatingShuttle = false;
		}
	}

	// -------- Community Moderation --------

	async function handleToggleFeatured(item: CommunityShuttle) {
		try {
			await adminApiFetch('/api/admin?action=gallery-update', {
				method: 'POST',
				body: JSON.stringify({ id: item.id, featured: !item.featured })
			});
			await loadCommunityGallery();
			showToast(!item.featured ? 'Шаттл закреплён' : 'Снят с закрепления');
		} catch (e) {
			showToast(`Ошибка: ${e instanceof Error ? e.message : e}`, 'err');
		}
	}

	async function handleSaveCommunityEdit(e: SubmitEvent) {
		e.preventDefault();
		if (!editingCommunity) return;
		try {
			await adminApiFetch('/api/admin?action=gallery-update', {
				method: 'POST',
				body: JSON.stringify({
					id: editingCommunity.id,
					name: communityEditForm.name,
					author: communityEditForm.author,
					description: communityEditForm.description,
					featured: communityEditForm.featured,
					tags: communityEditForm.tags.split(',').map((t) => t.trim()).filter(Boolean)
				})
			});
			editingCommunity = null;
			await loadCommunityGallery();
			showToast('Запись галереи обновлена');
		} catch (err) {
			showToast(`Ошибка: ${err instanceof Error ? err.message : err}`, 'err');
		}
	}

	async function handleDeleteCommunityItem(item: CommunityShuttle) {
		if (!confirm(`Удалить шаттл «${item.name}» из общей галереи? Это действие необратимо.`)) return;
		try {
			await adminApiFetch(`/api/admin?action=gallery-delete&id=${encodeURIComponent(item.id)}`, {
				method: 'DELETE'
			});
			await loadCommunityGallery();
			showToast('Шаттл удалён из галереи');
		} catch (e) {
			showToast(`Ошибка удаления: ${e instanceof Error ? e.message : e}`, 'err');
		}
	}

	// -------- Settings --------

	async function handleSaveSettings(e: SubmitEvent) {
		e.preventDefault();
		isSavingSettings = true;
		try {
			await adminApiFetch('/api/admin?action=save-settings', {
				method: 'POST',
				body: JSON.stringify({
					bannerText: bannerTextInput,
					bannerType: bannerTypeInput
				})
			});
			await loadPublicCatalog(true);
			notifyCatalogChanged();
			showToast('Настройки сайта сохранены');
		} catch (err) {
			showToast(`Ошибка: ${err instanceof Error ? err.message : err}`, 'err');
		} finally {
			isSavingSettings = false;
		}
	}

	async function handleResetAllOverrides(includeCustom: boolean) {
		const msg = includeCustom
			? 'Сбросить ВСЕ переопределённые рендеры И удалить все кастомные шаттлы каталога?'
			: 'Сбросить все переопределённые рендеры (вернуть исходные картинки из репозитория)?';
		if (!confirm(msg)) return;
		try {
			await adminApiFetch('/api/admin?action=reset-overrides', {
				method: 'POST',
				body: JSON.stringify({ includeCustom })
			});
			await loadPublicCatalog(true);
			notifyCatalogChanged();
			showToast('Переопределения сброшены');
		} catch (err) {
			showToast(`Ошибка: ${err instanceof Error ? err.message : err}`, 'err');
		}
	}

	async function handleChangePassword(e: SubmitEvent) {
		e.preventDefault();
		isChangingPass = true;
		try {
			const res = await adminApiFetch<{ token?: string }>('/api/admin?action=change-password', {
				method: 'POST',
				body: JSON.stringify({ currentPassword: currentPassInput, newPassword: newPassInput })
			});
			if (res.token) setAdminToken(res.token);
			currentPassInput = '';
			newPassInput = '';
			showToast('Пароль администратора обновлён');
		} catch (err) {
			showToast(`Ошибка: ${err instanceof Error ? err.message : err}`, 'err');
		} finally {
			isChangingPass = false;
		}
	}
</script>

<svelte:head>
	<title>Админ-панель — {configJson.name}</title>
</svelte:head>

<div class="admin-page">
	{#if toast}
		<div class="toast" class:toast-err={toast.kind === 'err'}>
			<span>{toast.kind === 'err' ? '⚠' : '✓'}</span>
			<span>{toast.msg}</span>
		</div>
	{/if}

	{#if authLoading}
		<div class="gate-wrap">
			<div class="gate-card">
				<div class="gate-eyebrow">EXODUS COMMAND TERMINAL</div>
				<h1 class="gate-title">Проверка доступа...</h1>
				<p class="gate-sub">Подключение к облачному хранилищу и модулю авторизации.</p>
			</div>
		</div>
	{:else if !authConfigured}
		<div class="gate-wrap">
			<div class="gate-card">
				<div class="gate-eyebrow">STORAGE OFFLINE</div>
				<h1 class="gate-title">Хранилище не подключено</h1>
				<p class="gate-sub">
					Для сохранения рендеров и настроек без Git подключите Vercel Blob (`BLOB_READ_WRITE_TOKEN` и
					`BLOB_STORE_ID`) в Environment Variables и выполните Redeploy.
				</p>
			</div>
		</div>
	{:else if !authenticated}
		<div class="gate-wrap">
			<form class="gate-card" onsubmit={handleAuthSubmit}>
				<div class="gate-eyebrow">EXODUS WEBMAP // SECURITY GATE</div>
				<h1 class="gate-title">
					{initialized ? 'Вход в админ-панель' : 'Первичная настройка пароля'}
				</h1>
				<p class="gate-sub">
					{initialized
						? 'Введите пароль администратора для управления каталогом и пакетного рендера шаттлов.'
						: 'Создайте пароль администратора (минимум 4 символа). Он сохранится в облачном хранилище без коммитов в Git.'}
				</p>

				{#if authError}
					<div class="error-box">{authError}</div>
				{/if}

				<label class="field">
					<span>Пароль администратора</span>
					<input
						type="password"
						bind:value={passwordInput}
						placeholder="••••••••"
						required
						minlength="4"
					/>
				</label>

				{#if !initialized}
					<label class="field">
						<span>Подтвердите пароль</span>
						<input
							type="password"
							bind:value={passwordConfirmInput}
							placeholder="••••••••"
							required
							minlength="4"
						/>
					</label>
				{/if}

				<button type="submit" class="btn btn-primary w-full" disabled={authSubmitting}>
					{authSubmitting
						? 'Проверка...'
						: initialized
							? 'Войти в панель'
							: 'Задать пароль и войти'}
				</button>
			</form>
		</div>
	{:else}
		<!-- Hidden SS14 Batch Renderer Iframe (reuses baked Monolith registry + 100% of textures) -->
		<iframe
			bind:this={renderFrameEl}
			src={`${base}/editor/index.html?batch=1`}
			title="SS14 Batch Render Engine"
			class="hidden-engine"
		></iframe>

		<div class="admin-shell">
			<!-- Header Bar -->
			<div class="top-bar">
				<div>
					<div class="top-eyebrow">EXODUS WEBMAP // ADMIN CONTROL CENTER</div>
					<h1 class="top-title">Панель управления и рендер шаттлов без Git</h1>
				</div>
				<div class="top-right">
					<div class="engine-pill" class:engine-ready={batchEngineReady}>
						<span class="dot"></span>
						<span>{batchEngineReady ? 'Рендер-ядро готово' : batchEngineInfo}</span>
					</div>
					<div class="storage-pill">
						<span>Хранилище:</span>
						<strong>{backendMode === 'blob' ? 'Vercel Blob' : backendMode}</strong>
					</div>
					<button
						type="button"
						class="btn btn-ghost"
						onclick={() => Promise.all([loadPublicCatalog(true), loadCommunityGallery()])}
					>
						↻ Обновить
					</button>
					<button type="button" class="btn btn-danger-ghost" onclick={handleLogout}>Выйти</button>
				</div>
			</div>

			<!-- KPI Strip -->
			<div class="stats-grid">
				<div class="stat-card">
					<div class="stat-label">Всего в каталоге</div>
					<div class="stat-val">{mergedCatalog.length}</div>
					<div class="stat-hint">{baseShuttles.length} встроенных + {customCount} через админку</div>
				</div>
				<div class="stat-card">
					<div class="stat-label">Обновлённых рендеров</div>
					<div class="stat-val accent">{overrideCount}</div>
					<div class="stat-hint">хранятся в облаке без Git</div>
				</div>
				<div class="stat-card">
					<div class="stat-label">Общая галерея</div>
					<div class="stat-val">{galleryItems.length}</div>
					<div class="stat-hint">пользовательских публикаций</div>
				</div>
				<div class="stat-card">
					<div class="stat-label">Статус ядра текстур</div>
					<div class="stat-val" style="font-size: 1rem;">
						{batchEngineReady ? 'MONOLITH ACTIVE' : 'LOADING...'}
					</div>
					<div class="stat-hint">{batchEngineInfo}</div>
				</div>
			</div>

			<!-- Navigation Tabs -->
			<div class="tabs-bar" role="tablist">
				<button
					type="button"
					class="tab-btn"
					class:active={activeTab === 'batch'}
					onclick={() => (activeTab = 'batch')}
				>
					🚀 Рендер всех шаттлов
				</button>
				<button
					type="button"
					class="tab-btn"
					class:active={activeTab === 'catalog'}
					onclick={() => (activeTab = 'catalog')}
				>
					🛸 Каталог шаттлов ({mergedCatalog.length})
				</button>
				<button
					type="button"
					class="tab-btn"
					class:active={activeTab === 'gallery'}
					onclick={() => (activeTab = 'gallery')}
				>
					🖼 Галерея сообщества ({galleryItems.length})
				</button>
				<button
					type="button"
					class="tab-btn"
					class:active={activeTab === 'settings'}
					onclick={() => (activeTab = 'settings')}
				>
					⚙ Настройки сайта
				</button>
			</div>

			<!-- TAB 1: BATCH RENDERER -->
			{#if activeTab === 'batch'}
				<div class="panel">
					<div class="panel-head">
						<div>
							<h2>Пакетный рендер всех шаттлов прямо в браузере (без Git / GitHub Actions)</h2>
							<p class="muted">
								Использует движок рендера Monolith (Exodus) и мгновенно сохраняет новые PNG/WebP
								на витрину сайта для всех игроков.
							</p>
						</div>
						<div class="btn-row">
							{#if !batchRunning}
								<button
									type="button"
									class="btn btn-primary"
									disabled={!batchEngineReady}
									onclick={() => executeBatchQueue(buildQueueFromSelection(true))}
								>
									▶ Отрeндерить все ({batchSource === 'site'
										? siteBatchCandidates.length
										: batchSource === 'local'
											? localYamlFiles.length
											: filteredMonolithFiles.length})
								</button>
								{#if (batchSource === 'site' && batchSelectedIds.size > 0) || (batchSource === 'monolith' && monolithSelectedPaths.size > 0)}
									<button
										type="button"
										class="btn btn-secondary"
										disabled={!batchEngineReady}
										onclick={() => executeBatchQueue(buildQueueFromSelection(false))}
									>
										▶ Только выбранные ({batchSource === 'site'
											? batchSelectedIds.size
											: monolithSelectedPaths.size})
									</button>
								{/if}
							{:else}
								<button
									type="button"
									class="btn btn-secondary"
									onclick={() => (batchPaused = !batchPaused)}
								>
									{batchPaused ? '▶ Продолжить' : '⏸ Пауза'}
								</button>
								<button
									type="button"
									class="btn btn-danger"
									onclick={() => (batchStopRequested = true)}
								>
									⏹ Остановить
								</button>
							{/if}
							{#if batchStats.done > 0}
								<button type="button" class="btn btn-ghost" onclick={downloadBatchManifest}>
									⬇ JSON манифест
								</button>
							{/if}
						</div>
					</div>

					<!-- Source selector + Render options -->
					<div class="controls-grid">
						<div class="source-pills">
							<button
								type="button"
								class="pill"
								class:active={batchSource === 'site'}
								onclick={() => (batchSource = 'site')}
							>
								1. Все карты сайта ({mergedCatalog.filter((s) => s.mapPath || s.yamlUrl).length})
							</button>
							<button
								type="button"
								class="pill"
								class:active={batchSource === 'local'}
								onclick={() => (batchSource = 'local')}
							>
								2. Файлы .yml с ПК ({localYamlFiles.length})
							</button>
							<button
								type="button"
								class="pill"
								class:active={batchSource === 'monolith'}
								onclick={() => (batchSource = 'monolith')}
							>
								3. Из Monolith (SharedMaps + POI)
							</button>
						</div>

						<div class="options-row">
							<label class="check">
								<input type="checkbox" bind:checked={batchAutoSave} />
								<span>Автопубликация на сайт (в облако)</span>
							</label>
							<label class="select-inline">
								<span>Фон:</span>
								<select bind:value={batchBgMode}>
									<option value="transparent">Прозрачный</option>
									<option value="dark">Космос #080c16</option>
								</select>
							</label>
							<label class="select-inline">
								<span>Макс. размер:</span>
								<select bind:value={batchMaxDim}>
									<option value={1600}>1600 px (быстрее)</option>
									<option value={2048}>2048 px (реком.)</option>
									<option value={3072}>3072 px (HD)</option>
								</select>
							</label>
						</div>
					</div>

					<!-- Source-specific controls -->
					<div class="source-box">
						{#if batchSource === 'site'}
							<div class="filter-bar">
								<input
									type="text"
									placeholder="Поиск по ID или названию..."
									bind:value={batchSearch}
									class="input-sm"
								/>
								<select bind:value={batchFilterGroup} class="input-sm">
									<option value="">Все верфи</option>
									{#each Object.entries(shuttleConfig.shipyard) as [key, label] (key)}
										<option value={key}>{label}</option>
									{/each}
								</select>
								<label class="check">
									<input type="checkbox" bind:checked={batchOnlyUnrendered} />
									<span>Только без облачного рендера</span>
								</label>
								<button type="button" class="btn btn-ghost btn-xs" onclick={toggleSelectAllSite}>
									Выбрать / снять все ({siteBatchCandidates.length})
								</button>
							</div>
							<div class="mini-grid">
								{#each siteBatchCandidates.slice(0, 120) as s (s.id)}
									{@const hasOv = Boolean(catalogState?.overrides?.[s.id]?.image)}
									<label class="mini-item" class:selected={batchSelectedIds.has(s.id)}>
										<input
											type="checkbox"
											checked={batchSelectedIds.has(s.id)}
											onchange={() => toggleSiteId(s.id)}
										/>
										<span class="mini-name">{s.name}</span>
										<span class="mini-id">{s.id}</span>
										{#if hasOv}
											<span class="badge-ok">✓</span>
										{/if}
									</label>
								{/each}
							</div>
							{#if siteBatchCandidates.length > 120}
								<div class="muted text-xs" style="margin-top: 8px;">
									Показаны первые 120 из {siteBatchCandidates.length}. Кнопка «Отрeндерить все» обработает
									все {siteBatchCandidates.length} шаттлов целиком.
								</div>
							{/if}
						{:else if batchSource === 'local'}
							<div class="drop-area">
								<p>Выберите один или сразу десятки `.yml` файлов карт шаттлов с компьютера</p>
								<label class="btn btn-secondary cursor-pointer">
									<span>📂 Выбрать .yml файлы</span>
									<input
										type="file"
										multiple
										accept=".yml,.yaml"
										class="sr-only"
										onchange={(e) => handleLocalFilesSelected((e.target as HTMLInputElement).files)}
									/>
								</label>
								{#if localYamlFiles.length > 0}
									<button
										type="button"
										class="btn btn-ghost btn-xs"
										onclick={() => (localYamlFiles = [])}
									>
										Очистить список
									</button>
								{/if}
							</div>
							{#if localYamlFiles.length > 0}
								<div class="mini-grid">
									{#each localYamlFiles as lf, idx (lf.filename + idx)}
										<div class="mini-item">
											<span class="mini-name">{lf.name}</span>
											<span class="mini-id">{lf.id}</span>
										</div>
									{/each}
								</div>
							{/if}
						{:else}
							<div class="filter-bar">
								<button
									type="button"
									class="btn btn-secondary"
									disabled={monolithLoading}
									onclick={handleLoadMonolithTree}
								>
									{monolithLoading ? '⏳ Загрузка списка...' : '🔄 Загрузить SharedMaps и POI из Monolith'}
								</button>
								{#if monolithFiles.length > 0}
									<select bind:value={monolithKindFilter} class="input-sm">
										<option value="all">Все ({monolithFiles.length})</option>
										<option value="shared">
											SharedMaps ({monolithFiles.filter((f) => (f.kind ?? (f.path.startsWith('Resources/SharedMaps/') ? 'shared' : 'poi')) === 'shared').length})
										</option>
										<option value="poi">
											POI из Maps ({monolithFiles.filter((f) => (f.kind ?? (f.path.startsWith('Resources/SharedMaps/') ? 'shared' : 'poi')) === 'poi').length})
										</option>
									</select>
									<input
										type="text"
										placeholder="Фильтр пути (_Exodus/Shuttles, _Mono/Shuttles, POI)..."
										bind:value={batchSearch}
										class="input-sm"
									/>
									<button
										type="button"
										class="btn btn-ghost btn-xs"
										onclick={toggleSelectAllMonolith}
									>
										Выбрать / снять ({filteredMonolithFiles.length})
									</button>
								{/if}
							</div>
							{#if monolithError}
								<div class="error-box">{monolithError}</div>
							{/if}
							{#if filteredMonolithFiles.length > 0}
								<div class="mini-grid">
									{#each filteredMonolithFiles.slice(0, 120) as mf (mf.path)}
										<label
											class="mini-item"
											class:selected={monolithSelectedPaths.has(mf.path)}
											title={mf.path}
										>
											<input
												type="checkbox"
												checked={monolithSelectedPaths.has(mf.path)}
												onchange={() => toggleMonolithPath(mf.path)}
											/>
											<span class="mini-name">{mf.name}</span>
											<span class="mini-id">{Math.round(mf.size / 1024)} КБ</span>
										</label>
									{/each}
								</div>
							{/if}
						{/if}
					</div>

					<!-- Progress & Live Queue -->
					{#if batchJobs.length > 0}
						<div class="progress-section">
							<div class="progress-top">
								<span>
									Прогресс: <strong>{batchStats.finished} / {batchStats.total}</strong> ({batchStats.pct}%)
									· Успешно: <strong style="color:#3fb950">{batchStats.done}</strong>
									· Ошибок: <strong style="color:#ef4444">{batchStats.err}</strong>
								</span>
								{#if batchStartedAt > 0}
									<span class="mono">
										Время: {batchElapsedSec} сек
									</span>
								{/if}
							</div>
							<div class="progress-track">
								<div class="progress-fill" style={`width: ${batchStats.pct}%`}></div>
							</div>

							<div class="batch-split">
								{#if batchLatestPreview?.previewUrl}
									<div class="live-preview-card">
										<div class="live-preview-title">
											Последний рендер: <strong>{batchLatestPreview.name}</strong>
										</div>
										<img src={batchLatestPreview.previewUrl} alt={batchLatestPreview.name} />
										<div class="live-preview-meta">
											{batchLatestPreview.dims} тайлов · {batchLatestPreview.entities ?? 0} сущностей
										</div>
									</div>
								{/if}

								<div class="queue-list">
									{#each batchJobs as job, idx (job.key)}
										<div class="queue-row" class:q-err={job.status === 'error'} class:q-done={job.status === 'done'}>
											<span class="q-status">
												{job.status === 'done'
													? '✅'
													: job.status === 'rendering'
														? '⏳'
														: job.status === 'error'
															? '❌'
															: '•'}
											</span>
											<span class="q-name">{job.name}</span>
											<span class="q-id">{job.id}</span>
											<span class="q-info">
												{#if job.status === 'done'}
													{job.dims} · {job.entities ?? 0} obj
												{:else if job.status === 'error'}
													{job.error}
												{:else if job.status === 'rendering'}
													Рендерится...
												{:else}
													В очереди
												{/if}
											</span>
											{#if job.status === 'error' && !batchRunning}
												<button
													type="button"
													class="btn btn-ghost btn-xs"
													onclick={() => handleRetrySingleJob(idx)}
												>
													Повтор
												</button>
											{/if}
										</div>
									{/each}
								</div>
							</div>
						</div>
					{/if}
				</div>
			{/if}

			<!-- TAB 2: CATALOG MANAGER -->
			{#if activeTab === 'catalog'}
				<div class="panel">
					<div class="panel-head">
						<div>
							<h2>Управление каталогом шаттлов ({filteredCatalog.length})</h2>
							<p class="muted">
								Добавляйте новые шаттлы, перерендеривайте отдельные корабли, меняйте описание и цены
								без правок в Git.
							</p>
						</div>
						<button
							type="button"
							class="btn btn-primary"
							onclick={() => (showAddShuttle = true)}
						>
							+ Добавить шаттл на сайт
						</button>
					</div>

					<div class="filter-bar">
						<input
							type="text"
							placeholder="Поиск по названию, ID, описанию..."
							bind:value={catalogSearch}
							class="input-sm"
						/>
						<select bind:value={catalogGroupFilter} class="input-sm">
							<option value="">Все верфи</option>
							{#each Object.entries(shuttleConfig.shipyard) as [key, label] (key)}
								<option value={key}>{label}</option>
							{/each}
						</select>
						<label class="check">
							<input type="checkbox" bind:checked={catalogOnlyEdited} />
							<span>Только изменённые / кастомные</span>
						</label>
					</div>

					<div class="catalog-list">
						{#each filteredCatalog.slice(0, 120) as s (s.id)}
							<div class="cat-row" class:cat-hidden={(s as any)._hidden}>
								<div class="cat-thumb">
									<img src={resolveShuttleImg(s.image)} alt={s.name} loading="lazy" />
								</div>
								<div class="cat-main">
									<div class="cat-title-row">
										<strong>{s.name}</strong>
										<span class="mono-id">{s.id}</span>
										{#if (s as any)._isCustom}
											<span class="tag-pill custom">Добавлен в админке</span>
										{:else if (s as any)._hasOverride}
											<span class="tag-pill edited">Переопределён</span>
										{/if}
										{#if (s as any)._hidden}
											<span class="tag-pill hidden-badge">Скрыт</span>
										{/if}
									</div>
									<div class="cat-sub">
										<span style={`color: ${shuttleGroupColors[s.group] || '#41b6fb'}`}>
											{shuttleConfig.shipyard[s.group] || s.group}
										</span>
										· {shuttleConfig.hullClasses[s.hullClass] || s.hullClass}
										· {shuttleConfig.sizes[s.size] || s.size}
										· {s.voucher ? 'По ваучеру' : s.price > 0 ? `${formatPrice(s.price)} кред.` : 'Не продаётся'}
									</div>
								</div>
								<div class="cat-actions">
									<button
										type="button"
										class="btn btn-secondary btn-xs"
										disabled={rerenderingId === s.id || !batchEngineReady || (!s.mapPath && !s.yamlUrl)}
										onclick={() => handleRerenderCatalogShuttle(s)}
										title="Перерендерить изображение из YAML карты"
									>
										{rerenderingId === s.id ? '⏳...' : '🎨 Рендер'}
									</button>
									<button
										type="button"
										class="btn btn-ghost btn-xs"
										onclick={() => openEditShuttleModal(s)}
									>
										✏ Правка
									</button>
									<a
										class="btn btn-ghost btn-xs no-underline"
										href={resolve(`/shuttle?id=${s.id}`)}
										target="_blank"
									>
										↗
									</a>
									{#if (s as any)._hasOverride || (s as any)._isCustom}
										<button
											type="button"
											class="btn btn-danger-ghost btn-xs"
											onclick={() => handleResetOrDeleteShuttle(s)}
										>
											{(s as any)._isCustom ? '🗑' : '↺'}
										</button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- TAB 3: COMMUNITY GALLERY MODERATION -->
			{#if activeTab === 'gallery'}
				<div class="panel">
					<div class="panel-head">
						<div>
							<h2>Модерация общей галереи ({galleryItems.length})</h2>
							<p class="muted">
								Удаление любых публикаций, редактирование описаний и закрепление лучших работ.
							</p>
						</div>
						<button type="button" class="btn btn-ghost" onclick={loadCommunityGallery}>
							↻ Обновить список
						</button>
					</div>

					<div class="filter-bar">
						<input
							type="text"
							placeholder="Поиск по названию, автору или тегу..."
							bind:value={gallerySearch}
							class="input-sm"
						/>
					</div>

					{#if galleryLoading}
						<div class="muted" style="padding: 24px 0;">⏳ Загрузка публикаций...</div>
					{:else if filteredGallery.length === 0}
						<div class="muted" style="padding: 24px 0;">Облачная галерея пока пуста.</div>
					{:else}
						<div class="catalog-list">
							{#each filteredGallery as item (item.id)}
								<div class="cat-row">
									<div class="cat-thumb">
										<img src={item.image} alt={item.name} loading="lazy" />
									</div>
									<div class="cat-main">
										<div class="cat-title-row">
											<strong>{item.name}</strong>
											<span class="mono-id">{item.id}</span>
											{#if item.featured}
												<span class="tag-pill edited">⭐ Закреплён</span>
											{/if}
										</div>
										<div class="cat-sub">
											Автор: <strong>{item.author}</strong> · ❤ {item.likes ?? 0} · {item.tileWidth}×{item.tileHeight}
											· {(item.tags || []).join(' ')}
										</div>
									</div>
									<div class="cat-actions">
										<button
											type="button"
											class="btn btn-ghost btn-xs"
											onclick={() => handleToggleFeatured(item)}
										>
											{item.featured ? '★ Снять' : '☆ Закрепить'}
										</button>
										<button
											type="button"
											class="btn btn-secondary btn-xs"
											onclick={() => {
												editingCommunity = item;
												communityEditForm = {
													name: item.name,
													author: item.author,
													description: item.description,
													tags: (item.tags || []).join(', '),
													featured: Boolean(item.featured)
												};
											}}
										>
											✏ Правка
										</button>
										<button
											type="button"
											class="btn btn-danger-ghost btn-xs"
											onclick={() => handleDeleteCommunityItem(item)}
										>
											🗑 Удалить
										</button>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<!-- TAB 4: SITE SETTINGS -->
			{#if activeTab === 'settings'}
				<div class="settings-grid">
					<form class="panel" onsubmit={handleSaveSettings}>
						<h2>Объявление на сайте</h2>
						<p class="muted" style="margin-bottom: 14px;">
							Отображается баннером в верхней части всех страниц (оставьте пустым, чтобы скрыть).
						</p>
						<label class="field">
							<span>Текст объявления</span>
							<input
								type="text"
								bind:value={bannerTextInput}
								placeholder="Например: Обновлены рендеры всех шаттлов Monolith!"
								maxlength="300"
							/>
						</label>
						<label class="field">
							<span>Тип баннера</span>
							<select bind:value={bannerTypeInput}>
								<option value="info">Информационный (Голубой)</option>
								<option value="success">Успех / Новинка (Зелёный)</option>
								<option value="warning">Предупреждение (Оранжевый)</option>
							</select>
						</label>
						<div class="btn-row">
							<button type="submit" class="btn btn-primary" disabled={isSavingSettings}>
								{isSavingSettings ? 'Сохранение...' : 'Сохранить баннер'}
							</button>
							<button
								type="button"
								class="btn btn-ghost"
								onclick={() => {
									bannerTextInput = '';
								}}
							>
								Очистить текст
							</button>
						</div>
					</form>

					<div class="panel">
						<h2>Смена пароля и сброс данных</h2>
						{#if authSource === 'env'}
							<p class="muted" style="margin-bottom: 16px;">
								Пароль задан переменной окружения <code>ADMIN_PASSWORD</code> в настройках Vercel.
							</p>
						{:else}
							<form onsubmit={handleChangePassword} style="margin-bottom: 20px;">
								<label class="field">
									<span>Текущий пароль</span>
									<input type="password" bind:value={currentPassInput} required />
								</label>
								<label class="field">
									<span>Новый пароль</span>
									<input type="password" bind:value={newPassInput} required minlength="4" />
								</label>
								<button type="submit" class="btn btn-secondary" disabled={isChangingPass}>
									{isChangingPass ? 'Сохранение...' : 'Сменить пароль'}
								</button>
							</form>
						{/if}

						<div class="danger-zone">
							<h3>Опасная зона</h3>
							<p class="muted" style="margin-bottom: 10px;">
								Сброс откатит облачные рендеры к статическим картинкам из сборки сайта.
							</p>
							<div class="btn-row">
								<button
									type="button"
									class="btn btn-danger-ghost"
									onclick={() => handleResetAllOverrides(false)}
								>
									↺ Сбросить переопределения ({overrideCount})
								</button>
								<button
									type="button"
									class="btn btn-danger"
									onclick={() => handleResetAllOverrides(true)}
								>
									🗑 Сбросить всё + кастомные шаттлы
								</button>
							</div>
						</div>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Edit Shuttle Modal -->
	{#if editingShuttle}
		<div class="modal-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && (editingShuttle = null)}>
			<form class="modal-card" onsubmit={handleSaveShuttleEdit}>
				<div class="modal-head">
					<h3>Редактирование: {editingShuttle.name}</h3>
					<button type="button" class="close-x" onclick={() => (editingShuttle = null)}>×</button>
				</div>
				<label class="field">
					<span>Название</span>
					<input type="text" bind:value={editForm.name} required />
				</label>
				<div class="field-row">
					<label class="field">
						<span>Верфь</span>
						<select bind:value={editForm.group}>
							{#each Object.entries(shuttleConfig.shipyard) as [k, l] (k)}
								<option value={k}>{l}</option>
							{/each}
						</select>
					</label>
					<label class="field">
						<span>Класс корпуса</span>
						<select bind:value={editForm.hullClass}>
							{#each Object.entries(shuttleConfig.hullClasses) as [k, l] (k)}
								<option value={k}>{l}</option>
							{/each}
						</select>
					</label>
					<label class="field">
						<span>Размер</span>
						<select bind:value={editForm.size}>
							{#each Object.entries(shuttleConfig.sizes) as [k, l] (k)}
								<option value={k}>{l}</option>
							{/each}
						</select>
					</label>
				</div>
				<div class="field-row">
					<label class="field">
						<span>Цена (кредиты)</span>
						<input type="number" min="0" bind:value={editForm.price} />
					</label>
					<label class="check" style="margin-top: 22px;">
						<input type="checkbox" bind:checked={editForm.voucher} />
						<span>По ваучеру</span>
					</label>
					<label class="check" style="margin-top: 22px;">
						<input type="checkbox" bind:checked={editForm.hidden} />
						<span>Скрыть с витрины</span>
					</label>
				</div>
				<label class="field">
					<span>Описание</span>
					<textarea rows="3" bind:value={editForm.description}></textarea>
				</label>
				<label class="field">
					<span>Загрузить своё превью (PNG/WebP, необязательно)</span>
					<input
						type="file"
						accept="image/png,image/webp,image/jpeg"
						onchange={(e) => {
							const f = (e.target as HTMLInputElement).files?.[0];
							if (!f) return;
							const r = new FileReader();
							r.onload = () => (editForm.imageDataUrl = String(r.result || ''));
							r.readAsDataURL(f);
						}}
					/>
				</label>
				<div class="modal-actions">
					<button type="button" class="btn btn-ghost" onclick={() => (editingShuttle = null)}>Отмена</button>
					<button type="submit" class="btn btn-primary" disabled={isSavingEdit}>
						{isSavingEdit ? 'Сохранение...' : 'Сохранить'}
					</button>
				</div>
			</form>
		</div>
	{/if}

	<!-- Add New Shuttle Modal -->
	{#if showAddShuttle}
		<div class="modal-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && (showAddShuttle = false)}>
			<form class="modal-card" onsubmit={handleCreateNewShuttle}>
				<div class="modal-head">
					<h3>Добавить новый шаттл в каталог</h3>
					<button type="button" class="close-x" onclick={() => (showAddShuttle = false)}>×</button>
				</div>

				<label class="field">
					<span>1. Выберите файл карты (.yml) — превью отрендерится автоматически</span>
					<input
						type="file"
						accept=".yml,.yaml"
						onchange={(e) => handleNewShuttleYamlUpload((e.target as HTMLInputElement).files)}
					/>
				</label>

				{#if isRenderingNewShuttle}
					<div class="muted text-xs">⏳ Рендерим карту через движок Monolith...</div>
				{:else if newShuttleForm.imageDataUrl}
					<div class="preview-strip">
						<img src={newShuttleForm.imageDataUrl} alt="Preview" />
						<div class="muted text-xs">
							{newShuttleForm.tileWidth}×{newShuttleForm.tileHeight} тайлов · {newShuttleForm.entityCount} сущностей
						</div>
					</div>
				{/if}

				<div class="field-row">
					<label class="field">
						<span>ID (лат./цифры)</span>
						<input type="text" bind:value={newShuttleForm.id} placeholder="my_shuttle" required />
					</label>
					<label class="field">
						<span>Название</span>
						<input type="text" bind:value={newShuttleForm.name} placeholder="Мой шаттл" required />
					</label>
				</div>

				<div class="field-row">
					<label class="field">
						<span>Верфь</span>
						<select bind:value={newShuttleForm.group}>
							{#each Object.entries(shuttleConfig.shipyard) as [k, l] (k)}
								<option value={k}>{l}</option>
							{/each}
						</select>
					</label>
					<label class="field">
						<span>Класс корпуса</span>
						<select bind:value={newShuttleForm.hullClass}>
							{#each Object.entries(shuttleConfig.hullClasses) as [k, l] (k)}
								<option value={k}>{l}</option>
							{/each}
						</select>
					</label>
					<label class="field">
						<span>Размер</span>
						<select bind:value={newShuttleForm.size}>
							{#each Object.entries(shuttleConfig.sizes) as [k, l] (k)}
								<option value={k}>{l}</option>
							{/each}
						</select>
					</label>
				</div>

				<div class="field-row">
					<label class="field">
						<span>Цена</span>
						<input type="number" min="0" bind:value={newShuttleForm.price} />
					</label>
					<label class="check" style="margin-top: 22px;">
						<input type="checkbox" bind:checked={newShuttleForm.voucher} />
						<span>По ваучеру</span>
					</label>
				</div>

				<label class="field">
					<span>Описание</span>
					<textarea rows="2" bind:value={newShuttleForm.description}></textarea>
				</label>

				<div class="modal-actions">
					<button type="button" class="btn btn-ghost" onclick={() => (showAddShuttle = false)}>Отмена</button>
					<button type="submit" class="btn btn-primary" disabled={isCreatingShuttle}>
						{isCreatingShuttle ? 'Публикация...' : 'Опубликовать в каталог'}
					</button>
				</div>
			</form>
		</div>
	{/if}

	<!-- Edit Community Item Modal -->
	{#if editingCommunity}
		<div class="modal-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && (editingCommunity = null)}>
			<form class="modal-card" onsubmit={handleSaveCommunityEdit}>
				<div class="modal-head">
					<h3>Правка публикации галереи</h3>
					<button type="button" class="close-x" onclick={() => (editingCommunity = null)}>×</button>
				</div>
				<label class="field">
					<span>Название</span>
					<input type="text" bind:value={communityEditForm.name} required />
				</label>
				<label class="field">
					<span>Автор</span>
					<input type="text" bind:value={communityEditForm.author} required />
				</label>
				<label class="field">
					<span>Теги (через запятую)</span>
					<input type="text" bind:value={communityEditForm.tags} />
				</label>
				<label class="field">
					<span>Описание</span>
					<textarea rows="3" bind:value={communityEditForm.description}></textarea>
				</label>
				<label class="check">
					<input type="checkbox" bind:checked={communityEditForm.featured} />
					<span>Закрепить (Featured)</span>
				</label>
				<div class="modal-actions">
					<button type="button" class="btn btn-ghost" onclick={() => (editingCommunity = null)}>Отмена</button>
					<button type="submit" class="btn btn-primary">Сохранить</button>
				</div>
			</form>
		</div>
	{/if}
</div>

<style>
	.admin-page {
		min-height: calc(100dvh - 60px);
		padding: 24px 20px 60px;
		max-width: 1460px;
		width: 100%;
		margin: 0 auto;
		color: var(--text);
	}

	.hidden-engine {
		position: fixed;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
		border: 0;
		left: -9999px;
	}

	.toast {
		position: fixed;
		right: 22px;
		bottom: 22px;
		z-index: 300;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 16px;
		background: #0a1426;
		border: 1px solid var(--accent);
		color: #e6f4ff;
		border-radius: 8px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
		font-size: 0.85rem;
	}
	.toast-err {
		border-color: #ef4444;
		color: #fecaca;
	}

	.gate-wrap {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 62vh;
	}
	.gate-card {
		width: 100%;
		max-width: 440px;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 14px;
		padding: 28px;
		box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
	}
	.gate-eyebrow,
	.top-eyebrow {
		font-family: var(--font-mono);
		font-size: 0.68rem;
		letter-spacing: 0.16em;
		color: var(--accent);
		margin-bottom: 6px;
	}
	.gate-title {
		font-family: var(--font-display);
		font-size: 1.55rem;
		font-weight: 700;
		margin-bottom: 8px;
	}
	.gate-sub {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin-bottom: 18px;
		line-height: 1.45;
	}

	.top-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 18px;
	}
	.top-title {
		font-family: var(--font-display);
		font-size: 1.65rem;
		font-weight: 700;
		line-height: 1.1;
	}
	.top-right {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.engine-pill,
	.storage-pill {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 6px 12px;
		font-size: 0.78rem;
		font-family: var(--font-mono);
		border-radius: 999px;
		background: var(--bg-panel);
		border: 1px solid var(--border-dim);
		color: var(--text-muted);
	}
	.engine-pill .dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #f0a500;
	}
	.engine-pill.engine-ready {
		border-color: rgba(63, 185, 80, 0.35);
		color: #9be9a8;
	}
	.engine-pill.engine-ready .dot {
		background: #3fb950;
		box-shadow: 0 0 8px #3fb950;
	}
	.storage-pill strong {
		color: var(--accent);
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 12px;
		margin-bottom: 18px;
	}
	.stat-card {
		background: var(--bg-panel);
		border: 1px solid var(--border-dim);
		border-radius: 10px;
		padding: 14px 16px;
	}
	.stat-label {
		font-size: 0.75rem;
		color: var(--text-muted);
		margin-bottom: 4px;
	}
	.stat-val {
		font-family: var(--font-display);
		font-size: 1.6rem;
		font-weight: 700;
	}
	.stat-val.accent {
		color: var(--accent);
	}
	.stat-hint {
		font-size: 0.72rem;
		color: var(--text-dim);
		font-family: var(--font-mono);
		margin-top: 2px;
	}

	.tabs-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 16px;
		border-bottom: 1px solid var(--border-dim);
		padding-bottom: 10px;
	}
	.tab-btn {
		padding: 8px 16px;
		border-radius: 8px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--text-muted);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 0.92rem;
		cursor: pointer;
		transition: all 0.18s ease;
	}
	.tab-btn:hover {
		color: var(--text);
		background: rgba(65, 182, 251, 0.08);
	}
	.tab-btn.active {
		color: var(--accent);
		background: rgba(65, 182, 251, 0.14);
		border-color: var(--border);
	}

	.panel {
		background: var(--bg-panel);
		border: 1px solid var(--border-dim);
		border-radius: 12px;
		padding: 20px;
	}
	.panel h2 {
		font-family: var(--font-display);
		font-size: 1.25rem;
		font-weight: 700;
		margin-bottom: 4px;
	}
	.panel-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 14px;
		margin-bottom: 16px;
	}
	.muted {
		color: var(--text-muted);
		font-size: 0.85rem;
	}
	.mono {
		font-family: var(--font-mono);
		font-size: 0.78rem;
		color: var(--text-muted);
	}

	.controls-grid {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px;
		background: rgba(5, 8, 16, 0.55);
		border: 1px solid var(--border-dim);
		border-radius: 10px;
		margin-bottom: 14px;
	}
	.source-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.pill {
		padding: 6px 12px;
		border-radius: 7px;
		border: 1px solid var(--border-dim);
		background: var(--bg-card);
		color: var(--text-muted);
		font-size: 0.8rem;
		cursor: pointer;
	}
	.pill.active {
		color: var(--accent);
		border-color: var(--accent);
		background: rgba(65, 182, 251, 0.14);
	}

	.options-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 14px;
		font-size: 0.8rem;
	}
	.check {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
		font-size: 0.82rem;
		color: var(--text);
	}
	.select-inline {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--text-muted);
	}
	.select-inline select,
	.input-sm,
	.field input,
	.field select,
	.field textarea {
		background: #050810;
		border: 1px solid var(--border-dim);
		color: var(--text);
		border-radius: 6px;
		padding: 6px 10px;
		font-size: 0.84rem;
		outline: none;
	}
	.select-inline select:focus,
	.input-sm:focus,
	.field input:focus,
	.field select:focus,
	.field textarea:focus {
		border-color: var(--accent);
	}

	.source-box {
		border: 1px solid var(--border-dim);
		border-radius: 10px;
		padding: 14px;
		background: rgba(5, 8, 16, 0.4);
	}
	.filter-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
	}
	.mini-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 6px;
		max-height: 280px;
		overflow-y: auto;
	}
	.mini-item {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 8px;
		border-radius: 6px;
		border: 1px solid var(--border-dim);
		background: var(--bg-card);
		font-size: 0.78rem;
		cursor: pointer;
	}
	.mini-item.selected {
		border-color: var(--accent);
		background: rgba(65, 182, 251, 0.12);
	}
	.mini-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mini-id {
		font-family: var(--font-mono);
		font-size: 0.68rem;
		color: var(--text-dim);
	}
	.badge-ok {
		color: #3fb950;
		font-weight: 700;
	}

	.drop-area {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 14px;
		border: 1px dashed var(--border);
		border-radius: 8px;
		margin-bottom: 10px;
	}

	.progress-section {
		margin-top: 16px;
		padding-top: 16px;
		border-top: 1px solid var(--border-dim);
	}
	.progress-top {
		display: flex;
		justify-content: space-between;
		font-size: 0.85rem;
		margin-bottom: 8px;
	}
	.progress-track {
		width: 100%;
		height: 8px;
		background: #050810;
		border: 1px solid var(--border-dim);
		border-radius: 999px;
		overflow: hidden;
		margin-bottom: 14px;
	}
	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #41b6fb, #3fb950);
		transition: width 0.2s ease;
	}

	.batch-split {
		display: grid;
		grid-template-columns: 280px 1fr;
		gap: 14px;
	}
	@media (max-width: 820px) {
		.batch-split {
			grid-template-columns: 1fr;
		}
	}
	.live-preview-card {
		background: #050810;
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}
	.live-preview-title {
		font-size: 0.8rem;
		text-align: center;
	}
	.live-preview-card img {
		max-width: 100%;
		max-height: 220px;
		object-fit: contain;
	}
	.live-preview-meta {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--text-muted);
	}

	.queue-list {
		max-height: 300px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.queue-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		border-radius: 6px;
		background: rgba(5, 8, 16, 0.5);
		border: 1px solid var(--border-dim);
		font-size: 0.78rem;
	}
	.queue-row.q-done {
		border-color: rgba(63, 185, 80, 0.3);
	}
	.queue-row.q-err {
		border-color: rgba(239, 68, 68, 0.45);
	}
	.q-name {
		font-weight: 600;
	}
	.q-id {
		font-family: var(--font-mono);
		color: var(--text-dim);
		font-size: 0.72rem;
	}
	.q-info {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--text-muted);
	}

	.catalog-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-height: 62vh;
		overflow-y: auto;
	}
	.cat-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		background: rgba(5, 8, 16, 0.55);
		border: 1px solid var(--border-dim);
		border-radius: 8px;
	}
	.cat-row.cat-hidden {
		opacity: 0.58;
	}
	.cat-thumb {
		width: 64px;
		height: 48px;
		border-radius: 6px;
		background: rgba(0, 0, 0, 0.35);
		border: 1px solid var(--border-dim);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		overflow: hidden;
	}
	.cat-thumb img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
	}
	.cat-main {
		flex: 1;
		min-width: 0;
	}
	.cat-title-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.mono-id {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--text-dim);
	}
	.tag-pill {
		font-family: var(--font-mono);
		font-size: 0.65rem;
		padding: 2px 7px;
		border-radius: 999px;
		border: 1px solid var(--border);
		color: var(--accent);
	}
	.tag-pill.custom {
		border-color: rgba(63, 185, 80, 0.45);
		color: #8be29a;
	}
	.tag-pill.hidden-badge {
		border-color: rgba(240, 165, 0, 0.45);
		color: #ffd166;
	}
	.cat-sub {
		font-size: 0.78rem;
		color: var(--text-muted);
		margin-top: 2px;
	}
	.cat-actions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.settings-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
		gap: 16px;
	}
	.danger-zone {
		padding-top: 14px;
		border-top: 1px solid rgba(239, 68, 68, 0.25);
	}
	.danger-zone h3 {
		font-size: 0.95rem;
		color: #fca5a5;
		margin-bottom: 4px;
	}

	.btn-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 8px 14px;
		border-radius: 7px;
		font-size: 0.82rem;
		font-weight: 600;
		border: 1px solid transparent;
		cursor: pointer;
		transition: all 0.16s ease;
	}
	.btn:disabled {
		opacity: 0.48;
		cursor: not-allowed;
	}
	.btn-xs {
		padding: 4px 9px;
		font-size: 0.75rem;
	}
	.btn-primary {
		background: rgba(65, 182, 251, 0.18);
		border-color: rgba(65, 182, 251, 0.55);
		color: #e6f4ff;
	}
	.btn-primary:hover:not(:disabled) {
		background: rgba(65, 182, 251, 0.28);
	}
	.btn-secondary {
		background: var(--bg-card);
		border-color: var(--border);
		color: var(--accent);
	}
	.btn-secondary:hover:not(:disabled) {
		background: rgba(65, 182, 251, 0.12);
	}
	.btn-ghost {
		background: transparent;
		border-color: var(--border-dim);
		color: var(--text-muted);
	}
	.btn-ghost:hover:not(:disabled) {
		color: var(--text);
		border-color: var(--border);
	}
	.btn-danger {
		background: rgba(239, 68, 68, 0.2);
		border-color: rgba(239, 68, 68, 0.5);
		color: #fecaca;
	}
	.btn-danger-ghost {
		background: transparent;
		border-color: rgba(239, 68, 68, 0.32);
		color: #fca5a5;
	}
	.btn-danger-ghost:hover:not(:disabled) {
		background: rgba(239, 68, 68, 0.16);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 5px;
		margin-bottom: 12px;
		font-size: 0.8rem;
		color: var(--text-muted);
	}
	.field-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: 10px;
	}
	.error-box {
		padding: 8px 12px;
		border-radius: 6px;
		background: rgba(239, 68, 68, 0.16);
		border: 1px solid rgba(239, 68, 68, 0.4);
		color: #fecaca;
		font-size: 0.8rem;
		margin-bottom: 12px;
	}

	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 250;
		background: rgba(5, 8, 16, 0.78);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
	}
	.modal-card {
		width: 100%;
		max-width: 560px;
		max-height: 90vh;
		overflow-y: auto;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 20px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.7);
	}
	.modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 14px;
	}
	.modal-head h3 {
		font-family: var(--font-display);
		font-size: 1.2rem;
		color: var(--accent);
	}
	.close-x {
		background: transparent;
		border: none;
		color: var(--text-muted);
		font-size: 1.4rem;
		cursor: pointer;
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 10px;
	}
	.preview-strip {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px;
		border: 1px solid var(--border-dim);
		border-radius: 8px;
		background: #050810;
		margin-bottom: 12px;
	}
	.preview-strip img {
		width: 72px;
		height: 54px;
		object-fit: contain;
	}
</style>
