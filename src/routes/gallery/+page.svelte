<script lang="ts">
	import Button from '$lib/button.svelte';
	import ImageModal from '$lib/image-modal.svelte';
	import {
		getUserGallery,
		deleteFromUserGallery,
		shuttleConfig,
		type UserGalleryItem
	} from '$lib';
	import { resolve } from '$app/paths';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import configJson from '$root/config.json' with { type: 'json' };

	let gallery = $state<UserGalleryItem[]>([]);
	let searchQuery = $state('');
	let selectedSize = $state('all');
	let sortBy = $state<'date-desc' | 'date-asc' | 'name-asc' | 'name-desc'>('date-desc');
	let previewImage = $state<{ src: string; alt: string } | null>(null);
	let copiedId = $state<string | null>(null);

	function refresh() {
		if (browser) {
			gallery = getUserGallery();
		}
	}

	onMount(() => {
		refresh();
		const handleUpdate = () => refresh();
		window.addEventListener('webmap:gallery_updated', handleUpdate);
		window.addEventListener('storage', handleUpdate);
		return () => {
			window.removeEventListener('webmap:gallery_updated', handleUpdate);
			window.removeEventListener('storage', handleUpdate);
		};
	});

	const filteredGallery = $derived.by(() => {
		let list = [...gallery];

		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase().trim();
			list = list.filter(
				(item) =>
					item.name.toLowerCase().includes(q) ||
					(item.description && item.description.toLowerCase().includes(q))
			);
		}

		if (selectedSize !== 'all') {
			list = list.filter((item) => item.size === selectedSize);
		}

		list.sort((a, b) => {
			if (sortBy === 'date-desc') {
				return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
			}
			if (sortBy === 'date-asc') {
				return new Date(a.updatedAt || a.createdAt).getTime() - new Date(b.updatedAt || b.createdAt).getTime();
			}
			if (sortBy === 'name-asc') {
				return a.name.localeCompare(b.name, 'ru');
			}
			if (sortBy === 'name-desc') {
				return b.name.localeCompare(a.name, 'ru');
			}
			return 0;
		});

		return list;
	});

	function handleDelete(item: UserGalleryItem) {
		if (confirm(`Удалить «${item.name}» из пользовательской галереи?`)) {
			deleteFromUserGallery(item.id);
			refresh();
		}
	}

	function handleEditInEditor(item: UserGalleryItem) {
		if (item.yamlContent) {
			sessionStorage.setItem('editor_load_yaml', item.yamlContent);
			window.location.href = resolve('/editor?loadSession=1');
		} else if (item.shareUrl) {
			window.location.href = resolve(`/editor?loadUrl=${encodeURIComponent(item.shareUrl)}`);
		} else {
			window.location.href = resolve('/editor');
		}
	}

	function handleDownloadImage(item: UserGalleryItem) {
		if (!item.image) return;
		const a = document.createElement('a');
		a.href = item.image;
		a.download = `${item.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'shuttle'}-render.png`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	}

	function handleDownloadYaml(item: UserGalleryItem) {
		if (!item.yamlContent) return;
		const blob = new Blob([item.yamlContent], { type: 'text/yaml' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${item.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'shuttle'}.yml`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	async function handleCopyShare(item: UserGalleryItem) {
		const url = item.shareUrl || `${window.location.origin}${resolve(`/shuttle?galleryId=${item.id}`)}`;
		try {
			await navigator.clipboard.writeText(url);
			copiedId = item.id;
			setTimeout(() => {
				if (copiedId === item.id) copiedId = null;
			}, 2500);
		} catch (e) {
			console.error('Failed to copy link:', e);
		}
	}

	function formatDate(isoStr: string): string {
		try {
			const d = new Date(isoStr);
			return d.toLocaleDateString('ru-RU', {
				day: '2-digit',
				month: '2-digit',
				year: 'numeric'
			});
		} catch {
			return isoStr;
		}
	}
</script>

<svelte:head>
	<title>Пользовательская галерея — {configJson.name}</title>
	<meta
		name="description"
		content="Галерея пользовательских и модифицированных шаттлов Space Station 14."
	/>
</svelte:head>

<div class="gallery-container">
	<!-- Top Bar -->
	<div class="gallery-header">
		<div class="header-titles">
			<div class="header-badge">
				<span>🎨</span>
				<span>Кастомные шаттлы</span>
			</div>
			<h1 class="gallery-title">Пользовательская галерея</h1>
			<p class="gallery-subtitle">
				Ваши созданные и отредактированные ванильные шаттлы. Хранятся локально в вашем браузере, готовы к открытию в редакторе, скачиванию и шерингу.
			</p>
		</div>

		<div class="header-actions">
			<a href={resolve('/editor')} class="btn-create">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
					<line x1="12" y1="5" x2="12" y2="19"></line>
					<line x1="5" y1="12" x2="19" y2="12"></line>
				</svg>
				Создать в редакторе
			</a>
			<a href={resolve('/')} class="btn-catalog">
				<span>🚀</span>
				Ванильный каталог
			</a>
		</div>
	</div>

	<!-- Controls: Search & Filters -->
	<div class="gallery-controls">
		<div class="search-box">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="search-icon">
				<circle cx="11" cy="11" r="8"></circle>
				<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
			</svg>
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Поиск по названию или описанию..."
				class="search-input"
			/>
			{#if searchQuery}
				<button class="clear-btn" onclick={() => (searchQuery = '')}>✕</button>
			{/if}
		</div>

		<div class="filter-group">
			<select bind:value={selectedSize} class="select-control">
				<option value="all">Все размеры</option>
				<option value="micro">Микро</option>
				<option value="small">Малый</option>
				<option value="medium">Средний</option>
				<option value="large">Крупный</option>
			</select>

			<select bind:value={sortBy} class="select-control">
				<option value="date-desc">Сначала новые</option>
				<option value="date-asc">Сначала старые</option>
				<option value="name-asc">По имени (А-Я)</option>
				<option value="name-desc">По имени (Я-А)</option>
			</select>
		</div>
	</div>

	<!-- Gallery Content -->
	{#if gallery.length === 0}
		<div class="empty-state">
			<div class="empty-icon">🛸</div>
			<h2 class="empty-title">В вашей галерее пока нет шаттлов</h2>
			<p class="empty-desc">
				Вы можете открыть любой ванильный шаттл из каталога, нажать «Редактировать в редакторе», модифицировать его и сохранить в свою галерею, либо построить новый корабль с нуля.
			</p>
			<div class="empty-actions">
				<a href={resolve('/')} class="btn-primary-lg">
					<span>📚</span>
					Выбрать шаттл в каталоге
				</a>
				<a href={resolve('/editor')} class="btn-secondary-lg">
					<span>🛠️</span>
					Построить шаттл с нуля
				</a>
			</div>
		</div>
	{:else if filteredGallery.length === 0}
		<div class="no-results">
			<p>По вашему запросу ничего не найдено.</p>
			<button class="btn-reset" onclick={() => { searchQuery = ''; selectedSize = 'all'; }}>
				Сбросить фильтры
			</button>
		</div>
	{:else}
		<div class="gallery-grid">
			{#each filteredGallery as item (item.id)}
				<div class="shuttle-card hud-corner">
					<!-- Preview image area -->
					<div
						class="card-image-box"
						onclick={() => (previewImage = { src: item.image, alt: item.name })}
						role="button"
						tabindex="0"
						onkeydown={(e) => e.key === 'Enter' && (previewImage = { src: item.image, alt: item.name })}
					>
						<img
							src={item.image}
							alt={item.name}
							class="card-render"
							style="image-rendering: pixelated;"
						/>
						<span class="size-pill">
							{shuttleConfig.sizes[item.size] ?? item.size}
						</span>
						<div class="zoom-pill">
							🔍 Увеличить
						</div>
					</div>

					<!-- Card info -->
					<div class="card-body">
						<div class="card-header-row">
							<h3 class="card-name" title={item.name}>{item.name}</h3>
							{#if item.baseShuttleId}
								<span class="base-badge" title="Отредактирован на основе ванильного шаттла">
									Мод
								</span>
							{/if}
						</div>

						<div class="card-specs">
							<div class="spec-item">
								<span class="spec-label">Размер:</span>
								<span class="spec-val font-mono">{item.tileWidth}×{item.tileHeight} т.</span>
							</div>
							<div class="spec-item">
								<span class="spec-label">Сущностей:</span>
								<span class="spec-val font-mono">{item.entityCount}</span>
							</div>
							<div class="spec-item">
								<span class="spec-label">Дата:</span>
								<span class="spec-val font-mono">{formatDate(item.createdAt)}</span>
							</div>
						</div>

						<!-- Action buttons -->
						<div class="card-actions">
							<a href={resolve(`/shuttle?galleryId=${item.id}`)} class="act-btn act-view" title="Открыть подробную карточку">
								Карточка
							</a>

							<button
								type="button"
								class="act-btn act-edit"
								onclick={() => handleEditInEditor(item)}
								title="Редактировать в редакторе"
							>
								Редактор
							</button>

							<button
								type="button"
								class="act-btn act-share"
								onclick={() => handleCopyShare(item)}
								title="Скопировать ссылку"
							>
								{copiedId === item.id ? 'Скопировано!' : 'Поделиться'}
							</button>

							<div class="act-dropdown-wrap">
								<button
									type="button"
									class="act-btn act-download"
									onclick={() => handleDownloadImage(item)}
									title="Скачать рендер PNG"
								>
									PNG
								</button>
								{#if item.yamlContent}
									<button
										type="button"
										class="act-btn act-download"
										onclick={() => handleDownloadYaml(item)}
										title="Скачать карту .yml"
									>
										YAML
									</button>
								{/if}
								<button
									type="button"
									class="act-btn act-delete"
									onclick={() => handleDelete(item)}
									title="Удалить из галереи"
								>
									✕
								</button>
							</div>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if previewImage}
	<ImageModal
		src={previewImage.src}
		alt={previewImage.alt}
		onClose={() => (previewImage = null)}
	/>
{/if}

<style>
	.gallery-container {
		display: flex;
		flex-direction: column;
		gap: 24px;
		padding: 24px 20px;
		max-width: 1400px;
		margin: 0 auto;
		width: 100%;
		flex: 1;
	}

	.gallery-header {
		display: flex;
		flex-direction: column;
		gap: 16px;
		background: var(--bg-panel);
		border: 1px solid var(--border-dim);
		border-radius: var(--radius-xl);
		padding: 24px;
		position: relative;
		overflow: hidden;
		box-shadow: 0 4px 30px rgba(0, 0, 0, 0.35);
	}

	.gallery-header::before {
		content: '';
		position: absolute;
		top: 0;
		left: 10%;
		right: 10%;
		height: 1px;
		background: linear-gradient(90deg, transparent, #38bdf8, transparent);
		opacity: 0.5;
	}

	@media (min-width: 768px) {
		.gallery-header {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
		}
	}

	.header-titles {
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-width: 750px;
	}

	.header-badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #38bdf8;
		background: rgba(56, 189, 248, 0.12);
		border: 1px solid rgba(56, 189, 248, 0.3);
		padding: 3px 10px;
		border-radius: var(--radius-sm);
		width: fit-content;
	}

	.gallery-title {
		font-family: var(--font-display);
		font-size: 1.8rem;
		font-weight: 700;
		color: var(--text);
		margin: 0;
		letter-spacing: 0.02em;
	}

	.gallery-subtitle {
		font-size: 0.875rem;
		color: var(--text-muted);
		line-height: 1.5;
		margin: 0;
	}

	.header-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}

	.btn-create {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 10px 18px;
		background: #0284c7;
		color: #ffffff;
		border-radius: var(--radius);
		font-family: var(--font-display);
		font-size: 0.875rem;
		font-weight: 600;
		text-decoration: none;
		transition: background 0.2s, transform 0.1s;
	}
	.btn-create:hover {
		background: #0369a1;
	}
	.btn-create:active {
		transform: translateY(1px);
	}

	.btn-catalog {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 10px 18px;
		background: rgba(255, 255, 255, 0.04);
		color: var(--text-muted);
		border: 1px solid var(--border-dim);
		border-radius: var(--radius);
		font-family: var(--font-display);
		font-size: 0.875rem;
		font-weight: 600;
		text-decoration: none;
		transition: color 0.2s, background 0.2s, border-color 0.2s;
	}
	.btn-catalog:hover {
		color: var(--text);
		background: rgba(255, 255, 255, 0.08);
		border-color: var(--border);
	}

	/* Controls */
	.gallery-controls {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	@media (min-width: 640px) {
		.gallery-controls {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
		}
	}

	.search-box {
		position: relative;
		flex: 1;
		max-width: 480px;
	}

	.search-icon {
		position: absolute;
		left: 12px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--text-dim);
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding: 9px 36px 9px 36px;
		background: var(--bg-card);
		border: 1px solid var(--border-dim);
		border-radius: var(--radius);
		color: var(--text);
		font-size: 0.875rem;
		outline: none;
		transition: border-color 0.2s;
	}
	.search-input:focus {
		border-color: #38bdf8;
	}

	.clear-btn {
		position: absolute;
		right: 10px;
		top: 50%;
		transform: translateY(-50%);
		background: none;
		border: none;
		color: var(--text-dim);
		cursor: pointer;
		padding: 2px 6px;
	}
	.clear-btn:hover {
		color: var(--text);
	}

	.filter-group {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.select-control {
		padding: 9px 12px;
		background: var(--bg-card);
		border: 1px solid var(--border-dim);
		border-radius: var(--radius);
		color: var(--text-muted);
		font-size: 0.85rem;
		outline: none;
		cursor: pointer;
	}
	.select-control:focus {
		border-color: #38bdf8;
	}

	/* Grid */
	.gallery-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 20px;
	}

	.shuttle-card {
		display: flex;
		flex-direction: column;
		background: var(--bg-card);
		border: 1px solid var(--border-dim);
		border-radius: var(--radius-xl);
		overflow: hidden;
		transition: border-color 0.25s, transform 0.15s, box-shadow 0.25s;
		position: relative;
	}
	.shuttle-card:hover {
		border-color: rgba(56, 189, 248, 0.4);
		transform: translateY(-2px);
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
	}

	.card-image-box {
		width: 100%;
		height: 190px;
		background: #050811;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		position: relative;
		cursor: zoom-in;
		overflow: hidden;
	}

	.card-render {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		filter: drop-shadow(0 0 16px rgba(56, 189, 248, 0.15));
		transition: transform 0.2s ease;
	}
	.card-image-box:hover .card-render {
		transform: scale(1.04);
	}

	.size-pill {
		position: absolute;
		top: 10px;
		left: 10px;
		background: rgba(0, 0, 0, 0.7);
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: 0.68rem;
		padding: 2px 8px;
		border-radius: var(--radius-pill);
		backdrop-filter: blur(4px);
	}

	.zoom-pill {
		position: absolute;
		bottom: 10px;
		right: 10px;
		background: rgba(0, 0, 0, 0.75);
		border: 1px solid rgba(56, 189, 248, 0.3);
		color: #38bdf8;
		font-size: 0.68rem;
		padding: 3px 8px;
		border-radius: var(--radius-pill);
		opacity: 0;
		transition: opacity 0.2s;
	}
	.card-image-box:hover .zoom-pill {
		opacity: 1;
	}

	.card-body {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		flex: 1;
		justify-content: space-between;
	}

	.card-header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.card-name {
		font-family: var(--font-display);
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--text);
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.base-badge {
		font-family: var(--font-mono);
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		color: #eab308;
		background: rgba(234, 179, 8, 0.12);
		border: 1px solid rgba(234, 179, 8, 0.35);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
	}

	.card-specs {
		display: flex;
		justify-content: space-between;
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid var(--border-dim);
		padding: 8px 10px;
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
	}

	.spec-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.spec-label {
		color: var(--text-dim);
		font-size: 0.68rem;
	}
	.spec-val {
		color: var(--text-muted);
		font-weight: 600;
	}

	.card-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		padding-top: 6px;
		border-top: 1px solid var(--border-dim);
	}

	.act-dropdown-wrap {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-left: auto;
	}

	.act-btn {
		padding: 6px 10px;
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		font-weight: 600;
		font-family: var(--font-display);
		cursor: pointer;
		text-decoration: none;
		border: 1px solid transparent;
		transition: background 0.15s, color 0.15s, border-color 0.15s;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.act-view {
		background: rgba(56, 189, 248, 0.12);
		color: #38bdf8;
		border-color: rgba(56, 189, 248, 0.3);
	}
	.act-view:hover {
		background: #38bdf8;
		color: #000;
	}

	.act-edit {
		background: rgba(255, 255, 255, 0.05);
		color: var(--text-muted);
		border-color: var(--border-dim);
	}
	.act-edit:hover {
		background: rgba(255, 255, 255, 0.1);
		color: var(--text);
		border-color: var(--border);
	}

	.act-share {
		background: rgba(168, 85, 247, 0.12);
		color: #c084fc;
		border-color: rgba(168, 85, 247, 0.3);
	}
	.act-share:hover {
		background: #a855f7;
		color: #fff;
	}

	.act-download {
		background: rgba(255, 255, 255, 0.04);
		color: var(--text-dim);
		border-color: var(--border-dim);
		padding: 6px 8px;
	}
	.act-download:hover {
		color: var(--text);
		background: rgba(255, 255, 255, 0.08);
	}

	.act-delete {
		background: rgba(239, 68, 68, 0.1);
		color: #f87171;
		border-color: rgba(239, 68, 68, 0.25);
		padding: 6px 8px;
	}
	.act-delete:hover {
		background: #ef4444;
		color: #fff;
	}

	/* Empty state */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 60px 20px;
		background: var(--bg-panel);
		border: 1px dashed var(--border-dim);
		border-radius: var(--radius-xl);
		text-align: center;
		gap: 16px;
		margin: 20px 0;
	}

	.empty-icon {
		font-size: 3.5rem;
		opacity: 0.8;
	}

	.empty-title {
		font-family: var(--font-display);
		font-size: 1.4rem;
		font-weight: 700;
		color: var(--text);
		margin: 0;
	}

	.empty-desc {
		font-size: 0.875rem;
		color: var(--text-muted);
		max-width: 520px;
		line-height: 1.6;
		margin: 0;
	}

	.empty-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px;
		margin-top: 8px;
	}

	.btn-primary-lg {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 10px 22px;
		background: #0284c7;
		color: #fff;
		border-radius: var(--radius);
		font-family: var(--font-display);
		font-size: 0.9rem;
		font-weight: 600;
		text-decoration: none;
		transition: background 0.2s;
	}
	.btn-primary-lg:hover {
		background: #0369a1;
	}

	.btn-secondary-lg {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 10px 22px;
		background: rgba(255, 255, 255, 0.05);
		color: var(--text-muted);
		border: 1px solid var(--border-dim);
		border-radius: var(--radius);
		font-family: var(--font-display);
		font-size: 0.9rem;
		font-weight: 600;
		text-decoration: none;
		transition: background 0.2s, color 0.2s;
	}
	.btn-secondary-lg:hover {
		background: rgba(255, 255, 255, 0.1);
		color: var(--text);
	}

	.no-results {
		text-align: center;
		padding: 40px;
		color: var(--text-dim);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
	}

	.btn-reset {
		padding: 6px 14px;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid var(--border-dim);
		border-radius: var(--radius);
		color: #38bdf8;
		cursor: pointer;
		font-size: 0.8rem;
	}
</style>
