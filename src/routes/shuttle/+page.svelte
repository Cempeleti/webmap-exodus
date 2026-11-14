<script lang="ts">
	import Button from '$lib/button.svelte';
	import ImageModal from '$lib/image-modal.svelte';
	import {
		formatPrice,
		getShuttleById,
		shuttleConfig,
		shuttleGroupColors,
		type Shuttle,
		type ShuttleSize
	} from '$lib';
	import { page } from '$app/state';
	import { asset, resolve } from '$app/paths';
	import { browser } from '$app/environment';
	import configJson from '$root/config.json' with { type: 'json' };

	let isModalOpen = $state(false);
	let shareCopied = $state(false);
	let isLoadingShared = $state(false);
	let customShuttle = $state<Shuttle | null>(null);

	let id = $derived(browser ? (page.url.searchParams.get('id') ?? '') : '');
	let shareParam = $derived(browser ? (page.url.searchParams.get('share') ?? '') : '');
	let imgParam = $derived(browser ? (page.url.searchParams.get('img') ?? '') : '');

	let isShared = $derived(
		Boolean(shareParam || imgParam || (id === 'custom' && customShuttle?.isShared))
	);
	let isCustom = $derived(id === 'custom' || Boolean(shareParam) || Boolean(imgParam));

	$effect(() => {
		if (!browser) return;

		// 1. Shared shuttle via URL query
		if (shareParam || imgParam) {
			const nameParam = page.url.searchParams.get('name');
			const descParam = page.url.searchParams.get('desc');
			const sizeParam = (page.url.searchParams.get('size') as ShuttleSize) || 'small';
			const w = Number(page.url.searchParams.get('w')) || undefined;
			const h = Number(page.url.searchParams.get('h')) || undefined;
			const e = Number(page.url.searchParams.get('e')) || undefined;
			const yamlParam = page.url.searchParams.get('yaml') || undefined;
			const expParam = page.url.searchParams.get('exp') || undefined;

			customShuttle = {
				id: 'shared',
				name: nameParam || 'Пользовательский шаттл',
				description:
					descParam ||
					(w && h
						? `Пользовательский шаттл (${w}×${h} тайлов, сущностей: ${e ?? '—'}).`
						: 'Пользовательский шаттл, созданный в редакторе карт.'),
				price: 0,
				group: 'custom',
				hullClass: 'shuttle',
				size: sizeParam,
				classes: ['civilian'],
				engines: ['plasma'],
				image: imgParam || '',
				tileWidth: w,
				tileHeight: h,
				entityCount: e,
				yamlUrl: yamlParam,
				expiresAt: expParam,
				isShared: true
			};

			// If manifest link is provided, fetch complete details in background
			if (shareParam) {
				const manifestUrl =
					shareParam.startsWith('http://') || shareParam.startsWith('https://')
						? shareParam
						: `https://trystocare.com/${shareParam}`;

				isLoadingShared = true;
				fetch(manifestUrl)
					.then((res) => {
						if (!res.ok) throw new Error(`HTTP ${res.status}`);
						return res.json();
					})
					.then((manifest) => {
						if (manifest && customShuttle) {
							customShuttle = {
								...customShuttle,
								name: manifest.name || customShuttle.name,
								description: manifest.description || customShuttle.description,
								image: manifest.imageUrl || customShuttle.image,
								yamlUrl: manifest.yamlUrl || customShuttle.yamlUrl,
								tileWidth: manifest.tileWidth ?? customShuttle.tileWidth,
								tileHeight: manifest.tileHeight ?? customShuttle.tileHeight,
								entityCount: manifest.entityCount ?? customShuttle.entityCount,
								size: manifest.size || customShuttle.size,
								expiresAt: manifest.expiresAt || customShuttle.expiresAt,
								isShared: true
							};
						}
					})
					.catch((err) => {
						console.warn('Failed to load shared manifest:', err);
					})
					.finally(() => {
						isLoadingShared = false;
					});
			}
			return;
		}

		// 2. Local sessionStorage preview from editor
		if (id === 'custom') {
			try {
				const raw = sessionStorage.getItem('custom_preview_shuttle');
				if (raw) {
					customShuttle = JSON.parse(raw);
				}
			} catch (e) {
				console.error('Failed to parse custom shuttle preview:', e);
			}
			return;
		}

		customShuttle = null;
	});

	let shuttle = $derived(isCustom ? customShuttle : getShuttleById(id));
	let factionColor = $derived(
		shuttle ? (shuttleGroupColors[shuttle.group] ?? '#00adb5') : '#00adb5'
	);
	let imageSrc = $derived(
		shuttle?.image?.startsWith('data:') ||
			shuttle?.image?.startsWith('http://') ||
			shuttle?.image?.startsWith('https://')
			? shuttle.image
			: shuttle
				? asset(shuttle.image as `/${string}`)
				: ''
	);

	function formatExpiration(isoDateStr?: string): string {
		if (!isoDateStr) return '';
		try {
			const d = new Date(isoDateStr);
			return d.toLocaleString('ru-RU', {
				day: '2-digit',
				month: '2-digit',
				year: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return isoDateStr;
		}
	}

	async function handleCopyShareLink() {
		try {
			await navigator.clipboard.writeText(window.location.href);
			shareCopied = true;
			setTimeout(() => (shareCopied = false), 2500);
		} catch (e) {
			console.error('Failed to copy share link:', e);
		}
	}

	function handleDownloadImage() {
		if (!imageSrc) return;
		const a = document.createElement('a');
		a.href = imageSrc;
		a.download = `${(shuttle?.name || 'shuttle').toLowerCase().replace(/[^a-z0-9_-]/g, '_')}-render.png`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	}
</script>

<svelte:head>
	<title
		>{shuttle
			? `${shuttle.name} — ${configJson.name}`
			: `Шаттл не найден — ${configJson.name}`}</title
	>
	{#if shuttle}
		<meta
			name="description"
			content={shuttle.description || `${shuttle.name} — ${shuttleConfig.shipyard[shuttle.group]}`}
		/>
	{/if}
</svelte:head>

{#if !shuttle}
	<div class="not-found-page">
		<div class="not-found-inner">
			<div class="not-found-icon" aria-hidden="true">
				<svg
					width="56"
					height="56"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path
						d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
					/>
					<line x1="12" y1="9" x2="12" y2="13" />
					<line x1="12" y1="17" x2="12.01" y2="17" />
				</svg>
			</div>
			<span class="not-found-title">Шаттл не найден</span>
			<span class="not-found-sub">Запрошенный шаттл не существует в базе данных</span>
			<Button text="Вернуться в каталог" onClick={() => window.history.back()} />
		</div>
	</div>
{:else}
	<div class="detail-page" style="--faction: {factionColor}">
		<!-- Back nav -->
		<div class="detail-nav">
			<button class="back-btn" onclick={() => window.history.back()} aria-label="Вернуться назад">
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<line x1="19" y1="12" x2="5" y2="12" />
					<polyline points="12 19 5 12 12 5" />
				</svg>
				Назад
			</button>
			<div class="breadcrumb" aria-label="Навигационная цепочка">
				<a href={resolve('/')} class="bc-link">Каталог</a>
				<span aria-hidden="true">/</span>
				{#if isShared}
					<span class="bc-link">Общий рендер</span>
					<span aria-hidden="true">/</span>
				{/if}
				<span class="bc-current">{shuttle.name}</span>
			</div>
		</div>

		<!-- Main content -->
		<div class="detail-content">
			<!-- Left: info panel -->
			<div class="info-panel">
				<!-- Title block -->
				<div class="title-block">
					<div class="title-row">
						<h1 class="shuttle-name">{shuttle.name}</h1>
						<div class="title-tags">
							{#if isShared}
								<span class="shared-badge">
									<svg
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2.5"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
										<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
									</svg>
									Временная ссылка
								</span>
							{/if}
							{#if shuttle.voucher}
								<span class="voucher-badge-detail">
									<span class="voucher-icon" aria-hidden="true">🎫</span>
									Только по ваучеру
								</span>
							{/if}
							{#if shuttle.hullClass}
								<span class="hull-badge">
									{shuttleConfig.hullClasses[shuttle.hullClass] ?? shuttle.hullClass}
								</span>
							{/if}
							<span class="faction-tag" style="color: {factionColor}">
								{shuttleConfig.shipyard[shuttle.group] ?? shuttle.group}
							</span>
						</div>
					</div>

					{#if shuttle.expiresAt}
						<div class="expiration-banner">
							<span class="exp-icon">⏳</span>
							<span
								>Ссылка активна до: <strong>{formatExpiration(shuttle.expiresAt)}</strong> (хранится 3 дня)</span
							>
						</div>
					{/if}

					{#if shuttle.description}
						<p class="shuttle-desc">{shuttle.description}</p>
					{/if}
				</div>

				<!-- Stats grid -->
				<div class="stats-section">
					<div class="section-divider">Характеристики</div>
					<div class="stats-grid">
						<!-- Price -->
						<div class="stat-block">
							<span class="stat-label">Стоимость</span>
							{#if shuttle.voucher}
								<div class="voucher-stat-wrap">
									<span class="stat-value voucher-val">
										<span class="voucher-icon" aria-hidden="true">🎫</span>
										По ваучеру
									</span>
									{#if shuttle.price > 0}
										<span class="voucher-stat-sub">Оценка: {formatPrice(shuttle.price)} кред.</span>
									{/if}
								</div>
							{:else if shuttle.price > 0}
								<span class="stat-value price-display large">
									{formatPrice(shuttle.price)}
									<span style="font-size: 0.6em; opacity: 0.7; margin-left: 2px;">кред.</span>
								</span>
							{:else}
								<span class="stat-value" style="color: var(--text-dim); font-size: 0.85rem;"
									>{isShared ? 'Пользовательский' : 'Не продаётся'}</span
								>
							{/if}
						</div>

						<!-- Hull Class -->
						{#if shuttle.hullClass}
							<div class="stat-block">
								<span class="stat-label">Класс</span>
								<span class="stat-value"
									>{shuttleConfig.hullClasses[shuttle.hullClass] ?? shuttle.hullClass}</span
								>
							</div>
						{/if}

						<!-- Size -->
						<div class="stat-block">
							<span class="stat-label">Размер</span>
							<span class="stat-value">{shuttleConfig.sizes[shuttle.size] ?? shuttle.size}</span>
						</div>

						<!-- Dimensions -->
						{#if shuttle.tileWidth && shuttle.tileHeight}
							<div class="stat-block">
								<span class="stat-label">Разрешение</span>
								<span class="stat-value font-mono">{shuttle.tileWidth} × {shuttle.tileHeight} тайлов</span>
							</div>
						{/if}

						<!-- Entities count -->
						{#if shuttle.entityCount}
							<div class="stat-block">
								<span class="stat-label">Сущностей</span>
								<span class="stat-value font-mono">{shuttle.entityCount}</span>
							</div>
						{/if}

						<!-- Engines -->
						{#if shuttle.engines && shuttle.engines.length > 0}
							<div class="stat-block" style="grid-column: 1 / -1;">
								<span class="stat-label">
									<svg
										width="10"
										height="10"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
										style="display:inline;margin-right:4px"
									>
										<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
									</svg>
									Силовая установка
								</span>
								<div class="engines-list">
									{#each shuttle.engines as eng (eng)}
										<span class="engine-tag">{shuttleConfig.engines[eng] ?? eng}</span>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				</div>

				<!-- Classes -->
				<div class="classes-section">
					<div class="section-divider">Специализация и роль</div>
					{#if shuttle.classes.length === 0}
						<span style="font-size:0.8rem; color: var(--text-dim);">Универсальный</span>
					{:else}
						<div class="classes-list">
							{#each shuttle.classes as cls (cls)}
								<span class="class-badge">{shuttleConfig.classes[cls] ?? cls}</span>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Action -->
				<div class="action-row">
					<Button text="Вернуться в каталог" onClick={() => window.history.back()} />

					<button
						type="button"
						class="share-action-btn"
						onclick={handleCopyShareLink}
						title="Скопировать ссылку на этот шаттл"
					>
						<svg
							width="15"
							height="15"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<circle cx="18" cy="5" r="3" />
							<circle cx="6" cy="12" r="3" />
							<circle cx="18" cy="19" r="3" />
							<line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
							<line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
						</svg>
						{shareCopied ? 'Ссылка скопирована!' : 'Поделиться'}
					</button>

					{#if imageSrc}
						<button
							type="button"
							class="download-action-btn"
							onclick={handleDownloadImage}
							title="Скачать изображение рендера"
						>
							<svg
								width="15"
								height="15"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
								<polyline points="7 10 12 15 17 10" />
								<line x1="12" y1="15" x2="12" y2="3" />
							</svg>
							Скачать PNG
						</button>
					{/if}

					{#if shuttle.yamlUrl}
						<a
							class="download-action-btn"
							href={shuttle.yamlUrl}
							download={`${(shuttle.name || 'shuttle').toLowerCase().replace(/[^a-z0-9_-]/g, '_')}.yml`}
							target="_blank"
							rel="noopener noreferrer"
							title="Скачать файл карты SS14 Grid"
						>
							<svg
								width="15"
								height="15"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
								<polyline points="14 2 14 8 20 8" />
								<line x1="12" y1="18" x2="12" y2="12" />
								<line x1="9" y1="15" x2="15" y2="15" />
							</svg>
							Скачать .yml
						</a>
						<a
							class="edit-link"
							href={resolve(`/editor?loadUrl=${encodeURIComponent(shuttle.yamlUrl)}`)}
						>
							Редактировать в редакторе
						</a>
					{:else if shuttle.mapPath}
						<a
							class="edit-link"
							href={resolve(`/editor?shuttle=${encodeURIComponent(shuttle.id)}`)}
						>
							Редактировать в редакторе
						</a>
					{/if}
				</div>
			</div>

			<!-- Right: image panel -->
			<div class="image-panel hud-corner">
				<button
					class="image-viewer scanline-overlay"
					onclick={() => (isModalOpen = true)}
					aria-label="Открыть изображение на весь экран: {shuttle.name}"
					title="Нажмите для просмотра в полном размере"
				>
					<img src={imageSrc} alt={shuttle.name} class="shuttle-img" />
					<div class="zoom-hint" aria-hidden="true">
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
							<line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
						</svg>
						Полный размер
					</div>
				</button>
			</div>
		</div>
	</div>

	{#if isModalOpen}
		<ImageModal
			src={imageSrc}
			alt={shuttle.name}
			onClose={() => (isModalOpen = false)}
		/>
	{/if}
{/if}

<style>
	/* ── Not found ── */
	.not-found-page {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 1;
		padding: 40px 16px;
	}

	.edit-link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 8px 20px;
		border: 1px solid var(--accent);
		border-radius: var(--radius);
		color: var(--accent);
		font-family: var(--font-display);
		font-size: 0.875rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-decoration: none;
		transition:
			background 0.2s,
			color 0.2s;
	}

	.edit-link:hover {
		background: var(--accent-muted);
		color: var(--text);
	}

	.not-found-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		text-align: center;
		max-width: 360px;
	}
	.not-found-icon {
		color: var(--text-dim);
		opacity: 0.5;
	}
	.not-found-title {
		font-family: var(--font-display);
		font-size: 1.3rem;
		font-weight: 700;
		color: var(--text-muted);
	}
	.not-found-sub {
		font-size: 0.85rem;
		color: var(--text-dim);
	}

	/* ── Detail page ── */
	.detail-page {
		display: flex;
		flex-direction: column;
		gap: 20px;
		padding: 20px 16px;
		max-width: 1400px;
		margin: 0 auto;
		width: 100%;
		flex: 1;
	}

	@media (min-width: 768px) {
		.detail-page {
			padding: 24px 24px;
			gap: 24px;
		}
	}

	/* Nav row */
	.detail-nav {
		display: flex;
		align-items: center;
		gap: 16px;
	}

	.back-btn {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 7px 14px;
		background: transparent;
		border: 1px solid var(--border-dim);
		border-radius: var(--radius);
		color: var(--text-muted);
		font-family: var(--font-display);
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		outline: none;
		transition:
			color 0.2s,
			border-color 0.2s,
			background 0.2s;
	}
	.back-btn:hover {
		color: var(--accent);
		border-color: var(--border);
		background: var(--accent-muted);
	}

	.breadcrumb {
		display: flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-mono);
		font-size: 0.72rem;
		letter-spacing: 0.06em;
		color: var(--text-dim);
	}
	.bc-link {
		color: var(--text-dim);
		text-decoration: none;
		transition: color 0.15s;
	}
	.bc-link:hover {
		color: var(--accent);
	}
	.bc-current {
		color: var(--text-muted);
	}

	/* Content grid */
	.detail-content {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	@media (min-width: 768px) {
		.detail-content {
			flex-direction: row;
			align-items: flex-start;
			gap: 24px;
		}
	}

	/* Info panel */
	.info-panel {
		display: flex;
		flex-direction: column;
		gap: 20px;
		background: var(--bg-panel);
		border: 1px solid var(--border-dim);
		border-radius: var(--radius-xl);
		padding: 22px;
		width: 100%;
		box-shadow:
			0 4px 30px rgba(0, 0, 0, 0.35),
			0 0 0 1px color-mix(in srgb, var(--faction, var(--accent)) 10%, transparent);
		position: relative;
		overflow: hidden;
	}
	/* top glow line in faction color */
	.info-panel::before {
		content: '';
		position: absolute;
		top: 0;
		left: 15%;
		right: 15%;
		height: 1px;
		background: linear-gradient(90deg, transparent, var(--faction, var(--accent)), transparent);
		opacity: 0.45;
	}

	@media (min-width: 768px) {
		.info-panel {
			min-width: 320px;
			max-width: 420px;
			width: auto;
			flex-shrink: 0;
		}
	}

	/* Title block */
	.title-block {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.title-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}

	.title-tags {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.shuttle-name {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 1.6rem;
		letter-spacing: 0.02em;
		color: var(--text);
		line-height: 1.1;
		margin: 0;
	}

	.shuttle-desc {
		font-size: 0.875rem;
		line-height: 1.6;
		color: var(--text-muted);
		margin: 0;
	}

	/* Stats */
	.stats-section,
	.classes-section {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}

	.engines-list {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		margin-top: 4px;
	}

	.engine-tag {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		letter-spacing: 0.06em;
		color: var(--text-muted);
		padding: 4px 10px;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: rgba(65, 182, 251, 0.04);
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.classes-list {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	/* Action */
	.action-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		padding-top: 8px;
		border-top: 1px solid var(--border-dim);
	}

	.voucher-badge-detail {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding: 4px 10px;
		border-radius: var(--radius-sm);
		background: rgba(245, 158, 11, 0.15);
		color: #f59e0b;
		border: 1px solid rgba(245, 158, 11, 0.45);
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}

	.voucher-stat-wrap {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.voucher-val {
		color: #f59e0b;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.voucher-stat-sub {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--text-dim);
		letter-spacing: 0.02em;
	}

	.shared-badge {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding: 4px 10px;
		border-radius: var(--radius-sm);
		background: rgba(14, 165, 233, 0.15);
		color: #38bdf8;
		border: 1px solid rgba(14, 165, 233, 0.45);
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.expiration-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 14px;
		border-radius: var(--radius-sm);
		background: rgba(14, 165, 233, 0.08);
		border: 1px solid rgba(14, 165, 233, 0.25);
		font-size: 0.8rem;
		color: #93c5fd;
	}

	.share-action-btn,
	.download-action-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 8px 16px;
		border: 1px solid var(--border-dim);
		border-radius: var(--radius);
		background: rgba(255, 255, 255, 0.03);
		color: var(--text-muted);
		font-family: var(--font-display);
		font-size: 0.875rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-decoration: none;
		cursor: pointer;
		outline: none;
		transition:
			background 0.2s,
			color 0.2s,
			border-color 0.2s;
	}

	.share-action-btn:hover,
	.download-action-btn:hover {
		background: rgba(14, 165, 233, 0.12);
		border-color: rgba(14, 165, 233, 0.4);
		color: #38bdf8;
	}

	/* Image panel */
	.image-panel {
		flex: 1;
		min-height: 300px;
		background: var(--bg-panel);
		border: 1px solid var(--border-dim);
		border-radius: var(--radius-xl);
		overflow: hidden;
		position: relative;
		box-shadow: 0 4px 30px rgba(0, 0, 0, 0.3);
	}

	.image-viewer {
		width: 100%;
		height: 100%;
		min-height: 320px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.3);
		cursor: zoom-in;
		border: none;
		outline: none;
		padding: 24px;
		position: relative;
		transition: background 0.2s;
	}
	.image-viewer:hover {
		background: rgba(0, 0, 0, 0.4);
	}

	.shuttle-img {
		max-width: 100%;
		max-height: 60vh;
		width: auto;
		height: auto;
		object-fit: contain;
		transition: transform 0.3s ease;
		filter: drop-shadow(0 0 30px rgba(65, 182, 251, 0.12));
	}
	.image-viewer:hover .shuttle-img {
		transform: scale(1.02);
	}

	.zoom-hint {
		position: absolute;
		bottom: 14px;
		right: 14px;
		display: flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 0.65rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-dim);
		background: rgba(5, 8, 16, 0.75);
		border: 1px solid var(--border-dim);
		padding: 6px 12px;
		border-radius: var(--radius-pill);
		backdrop-filter: blur(8px);
		opacity: 0;
		transition: opacity 0.25s;
	}
	.image-viewer:hover .zoom-hint {
		opacity: 1;
	}
</style>
