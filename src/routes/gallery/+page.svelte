<script lang="ts">
	import Button from '$lib/button.svelte';
	import ImageModal from '$lib/image-modal.svelte';
	import {
		getCommunityShuttles,
		toggleCommunityLike,
		isCommunityShuttleLiked,
		publishToCommunity,
		deleteCommunitySubmission,
		importCommunityShuttle,
		getUserGallery,
		deleteFromUserGallery,
		shuttleConfig,
		type CommunityShuttle,
		type UserGalleryItem
	} from '$lib';
	import { base, resolve } from '$app/paths';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import configJson from '$root/config.json' with { type: 'json' };

	let activeTab = $state<'community' | 'personal'>('community');

	let communityList = $state<CommunityShuttle[]>([]);
	let personalList = $state<UserGalleryItem[]>([]);

	let searchQuery = $state('');
	let selectedSize = $state('all');
	let selectedTag = $state('all');
	let sortBy = $state<'likes-desc' | 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc'>('likes-desc');

	let previewImage = $state<{ src: string; alt: string } | null>(null);
	let copiedId = $state<string | null>(null);
	let toastMessage = $state<string | null>(null);

	// Publish Modal State
	let showPublishModal = $state(false);
	let publishTarget = $state<UserGalleryItem | null>(null);
	let publishAuthor = $state('Инженер Станции');
	let publishTags = $state('боевой, кастом');

	// Import Modal State
	let showImportModal = $state(false);
	let importInput = $state('');
	let isImporting = $state(false);
	let importError = $state<string | null>(null);

	function showToast(msg: string) {
		toastMessage = msg;
		setTimeout(() => {
			if (toastMessage === msg) toastMessage = null;
		}, 3000);
	}

	function refreshData() {
		if (browser) {
			communityList = getCommunityShuttles();
			personalList = getUserGallery();
			const storedNick = localStorage.getItem('webmap_author_nickname');
			if (storedNick) publishAuthor = storedNick;
		}
	}

	onMount(() => {
		refreshData();
		const handleCommunity = () => {
			if (browser) communityList = getCommunityShuttles();
		};
		const handlePersonal = () => {
			if (browser) personalList = getUserGallery();
		};

		window.addEventListener('webmap:community_updated', handleCommunity);
		window.addEventListener('webmap:gallery_updated', handlePersonal);
		window.addEventListener('storage', refreshData);

		return () => {
			window.removeEventListener('webmap:community_updated', handleCommunity);
			window.removeEventListener('webmap:gallery_updated', handlePersonal);
			window.removeEventListener('storage', refreshData);
		};
	});

	// Extract all unique tags across community items
	const availableTags = $derived.by(() => {
		const tagSet = new Set<string>();
		for (const item of communityList) {
			if (item.tags) {
				for (const t of item.tags) {
					if (t) tagSet.add(t.toLowerCase());
				}
			}
		}
		return Array.from(tagSet);
	});

	// Filtered Community List
	const filteredCommunity = $derived.by(() => {
		let list = [...communityList];

		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase().trim();
			list = list.filter(
				(item) =>
					item.name.toLowerCase().includes(q) ||
					(item.author && item.author.toLowerCase().includes(q)) ||
					(item.description && item.description.toLowerCase().includes(q)) ||
					(item.tags && item.tags.some((t) => t.toLowerCase().includes(q)))
			);
		}

		if (selectedSize !== 'all') {
			list = list.filter((item) => item.size === selectedSize);
		}

		if (selectedTag !== 'all') {
			list = list.filter(
				(item) => item.tags && item.tags.some((t) => t.toLowerCase() === selectedTag.toLowerCase())
			);
		}

		list.sort((a, b) => {
			if (sortBy === 'likes-desc') {
				const diff = (b.likes ?? 0) - (a.likes ?? 0);
				if (diff !== 0) return diff;
				return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
			}
			if (sortBy === 'date-desc') {
				return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
			}
			if (sortBy === 'date-asc') {
				return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
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

	// Filtered Personal List
	const filteredPersonal = $derived.by(() => {
		let list = [...personalList];

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
				return (
					new Date(b.updatedAt || b.createdAt).getTime() -
					new Date(a.updatedAt || a.createdAt).getTime()
				);
			}
			if (sortBy === 'date-asc') {
				return (
					new Date(a.updatedAt || a.createdAt).getTime() -
					new Date(b.updatedAt || b.createdAt).getTime()
				);
			}
			if (sortBy === 'name-asc') {
				return a.name.localeCompare(b.name, 'ru');
			}
			if (sortBy === 'name-desc') {
				return b.name.localeCompare(a.name, 'ru');
			}
			return (
				new Date(b.updatedAt || b.createdAt).getTime() -
				new Date(a.updatedAt || a.createdAt).getTime()
			);
		});

		return list;
	});

	function handleToggleLike(id: string) {
		toggleCommunityLike(id);
		communityList = getCommunityShuttles();
	}

	function handleEditCommunity(item: CommunityShuttle) {
		if (item.yamlContent) {
			sessionStorage.setItem('editor_load_yaml', item.yamlContent);
			window.location.href = resolve('/editor?loadSession=1');
		} else if (item.yamlUrl) {
			window.location.href = resolve(`/editor?loadUrl=${encodeURIComponent(item.yamlUrl)}`);
		} else if (item.mapPath) {
			const cleanMap = item.mapPath.replace('maps/by-id/', '').replace('.yml', '');
			window.location.href = resolve(`/editor?shuttle=${encodeURIComponent(cleanMap)}`);
		} else {
			window.location.href = resolve('/editor');
		}
	}

	function handleEditPersonal(item: UserGalleryItem) {
		if (item.yamlContent) {
			sessionStorage.setItem('editor_load_yaml', item.yamlContent);
			window.location.href = resolve('/editor?loadSession=1');
		} else if (item.shareUrl) {
			window.location.href = resolve(`/editor?loadUrl=${encodeURIComponent(item.shareUrl)}`);
		} else {
			window.location.href = resolve('/editor');
		}
	}

	function handleDownloadImage(item: { name: string; image: string }) {
		if (!item.image) return;
		const a = document.createElement('a');
		a.href = item.image;
		a.download = `${item.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'shuttle'}-render.png`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	}

	function handleDownloadYaml(item: { name: string; yamlContent?: string; yamlUrl?: string; mapPath?: string }) {
		if (item.yamlContent) {
			const blob = new Blob([item.yamlContent], { type: 'text/yaml' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${item.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'shuttle'}.yml`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} else if (item.yamlUrl) {
			window.open(item.yamlUrl, '_blank');
		} else if (item.mapPath) {
			const resolvedPath = `${base}/${item.mapPath.startsWith('static/') ? item.mapPath.slice(7) : `editor/${item.mapPath}`}`;
			const a = document.createElement('a');
			a.href = resolvedPath;
			a.download = `${item.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'shuttle'}.yml`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
		}
	}

	async function handleCopyCommunityShare(item: CommunityShuttle) {
		const url = item.shareUrl || `${window.location.origin}${resolve(`/shuttle?communityId=${item.id}`)}`;
		try {
			await navigator.clipboard.writeText(url);
			copiedId = item.id;
			showToast('Ссылка на шаттл скопирована!');
			setTimeout(() => {
				if (copiedId === item.id) copiedId = null;
			}, 2500);
		} catch (e) {
			console.error('Failed to copy link:', e);
		}
	}

	async function handleCopyPersonalShare(item: UserGalleryItem) {
		const url = item.shareUrl || `${window.location.origin}${resolve(`/shuttle?galleryId=${item.id}`)}`;
		try {
			await navigator.clipboard.writeText(url);
			copiedId = item.id;
			showToast('Ссылка на шаттл скопирована!');
			setTimeout(() => {
				if (copiedId === item.id) copiedId = null;
			}, 2500);
		} catch (e) {
			console.error('Failed to copy link:', e);
		}
	}

	function handleDeletePersonal(item: UserGalleryItem) {
		if (confirm(`Удалить «${item.name}» из личной галереи?`)) {
			deleteFromUserGallery(item.id);
			refreshData();
			showToast('Шаттл удален из вашей галереи');
		}
	}

	function handleDeleteCommunitySubmission(item: CommunityShuttle) {
		if (confirm(`Удалить вашу публикацию «${item.name}» из общественной галереи?`)) {
			deleteCommunitySubmission(item.id);
			refreshData();
			showToast('Публикация удалена из общественной галереи');
		}
	}

	function openPublishModal(item: UserGalleryItem) {
		publishTarget = item;
		publishTags = 'боевой, кастом';
		showPublishModal = true;
	}

	function confirmPublish() {
		if (!publishTarget) return;
		const tags = publishTags
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);

		publishToCommunity({
			name: publishTarget.name,
			author: publishAuthor.trim() || 'Инженер Станции',
			description: publishTarget.description,
			tileWidth: publishTarget.tileWidth,
			tileHeight: publishTarget.tileHeight,
			entityCount: publishTarget.entityCount,
			size: publishTarget.size,
			hullClass: publishTarget.hullClass,
			image: publishTarget.image,
			yamlContent: publishTarget.yamlContent,
			shareUrl: publishTarget.shareUrl,
			shareExpiresAt: publishTarget.shareExpiresAt,
			tags
		});

		if (browser) {
			localStorage.setItem('webmap_author_nickname', publishAuthor.trim());
		}

		showPublishModal = false;
		publishTarget = null;
		activeTab = 'community';
		refreshData();
		showToast('✨ Шаттл успешно опубликован в общественную галерею!');
	}

	async function handleImportLink() {
		if (!importInput.trim()) return;
		isImporting = true;
		importError = null;

		try {
			let url = importInput.trim();
			// If it's a full webmap URL, extract share param
			if (url.includes('share=')) {
				const params = new URL(url).searchParams;
				url = params.get('share') || url;
			}
			if (!url.startsWith('http://') && !url.startsWith('https://')) {
				url = `https://trystocare.com/${url}`;
			}

			const res = await fetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const manifest = await res.json();

			if (!manifest || !manifest.imageUrl) {
				throw new Error('Некорректный манифест шаттла');
			}

			importCommunityShuttle(manifest);
			showImportModal = false;
			importInput = '';
			activeTab = 'community';
			refreshData();
			showToast('Шаттл успешно импортирован в общественную галерею!');
		} catch (e: any) {
			importError = e.message || 'Не удалось загрузить шаттл по ссылке';
		} finally {
			isImporting = false;
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
	<title>Галерея шаттлов — {configJson.name}</title>
	<meta
		name="description"
		content="Общественная и пользовательская галерея кастомных шаттлов Space Station 14."
	/>
</svelte:head>

<div class="gallery-container">
	<!-- Top Bar -->
	<div class="gallery-header">
		<div class="header-titles">
			<div class="header-badge">
				<span>🛰️</span>
				<span>Верфь Сообщества</span>
			</div>
			<h1 class="gallery-title">Галерея шаттлов</h1>
			<p class="gallery-subtitle">
				Коллекция космических судов Space Station 14: исследуйте работы сообщества, делитесь своими проектами, загружайте карты и редактируйте их в один клик.
			</p>
		</div>

		<div class="header-actions">
			<button class="btn-import" onclick={() => (showImportModal = true)} title="Импортировать шаттл по ссылке">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
					<polyline points="7 10 12 15 17 10"></polyline>
					<line x1="12" y1="15" x2="12" y2="3"></line>
				</svg>
				Импорт по ссылке
			</button>
			<a href={resolve('/editor')} class="btn-create">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
					<line x1="12" y1="5" x2="12" y2="19"></line>
					<line x1="5" y1="12" x2="19" y2="12"></line>
				</svg>
				Создать в редакторе
			</a>
			<a href={resolve('/')} class="btn-catalog">
				<span>📚</span>
				Каталог
			</a>
		</div>
	</div>

	<!-- Navigation Tabs -->
	<div class="gallery-tabs">
		<button
			class="tab-btn {activeTab === 'community' ? 'active' : ''}"
			onclick={() => {
				activeTab = 'community';
				sortBy = 'likes-desc';
			}}
		>
			<span class="tab-icon">🌐</span>
			<span class="tab-text">Общественная галерея</span>
			<span class="tab-count">{communityList.length}</span>
		</button>

		<button
			class="tab-btn {activeTab === 'personal' ? 'active' : ''}"
			onclick={() => {
				activeTab = 'personal';
				sortBy = 'date-desc';
			}}
		>
			<span class="tab-icon">👤</span>
			<span class="tab-text">Моя галерея</span>
			<span class="tab-count">{personalList.length}</span>
		</button>
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
				placeholder={activeTab === 'community'
					? 'Поиск по названию, автору, тегу или описанию...'
					: 'Поиск по названию или описанию...'}
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
				{#if activeTab === 'community'}
					<option value="likes-desc">По популярности (❤️)</option>
				{/if}
				<option value="date-desc">Сначала новые</option>
				<option value="date-asc">Сначала старые</option>
				<option value="name-asc">По имени (А-Я)</option>
				<option value="name-desc">По имени (Я-А)</option>
			</select>
		</div>
	</div>

	<!-- Tags Bar for Community Tab -->
	{#if activeTab === 'community' && availableTags.length > 0}
		<div class="tags-bar">
			<span class="tags-label">Теги:</span>
			<button
				class="tag-pill {selectedTag === 'all' ? 'active' : ''}"
				onclick={() => (selectedTag = 'all')}
			>
				Все
			</button>
			{#each availableTags as tag}
				<button
					class="tag-pill {selectedTag === tag ? 'active' : ''}"
					onclick={() => (selectedTag = selectedTag === tag ? 'all' : tag)}
				>
					{tag}
				</button>
			{/each}
		</div>
	{/if}

	<!-- Gallery Content -->
	{#if activeTab === 'community'}
		<!-- Community Grid -->
		{#if communityList.length === 0}
			<div class="empty-state">
				<div class="empty-icon">🛰️</div>
				<h2 class="empty-title">В общественной галерее пока нет опубликованных шаттлов</h2>
				<p class="empty-desc">
					Станьте первым, кто опубликует свой проект! Вы можете построить шаттл в редакторе карт или модифицировать любой корабль из каталога и нажать «Опубликовать в общественную галерею».
				</p>
				<div class="empty-actions">
					<a href={resolve('/editor')} class="btn-primary-lg">
						<span>🛠️</span>
						Создать в редакторе
					</a>
					<button class="btn-secondary-lg" onclick={() => (showImportModal = true)}>
						<span>📥</span>
						Импортировать по ссылке
					</button>
					<a href={resolve('/')} class="btn-secondary-lg">
						<span>📚</span>
						Выбрать из каталога
					</a>
				</div>
			</div>
		{:else if filteredCommunity.length === 0}
			<div class="no-results">
				<p>По выбранным фильтрам ничего не найдено в общественной галерее.</p>
				<button
					class="btn-reset"
					onclick={() => {
						searchQuery = '';
						selectedSize = 'all';
						selectedTag = 'all';
					}}
				>
					Сбросить фильтры
				</button>
			</div>
		{:else}
			<div class="gallery-grid">
				{#each filteredCommunity as item (item.id)}
					<div class="shuttle-card hud-corner {item.featured ? 'featured-card' : ''}">
						<!-- Card Preview Image -->
						<div
							class="card-image-box"
							onclick={() => (previewImage = { src: item.image, alt: item.name })}
							role="button"
							tabindex="0"
							onkeydown={(e) => {
								if (e.key === 'Enter') previewImage = { src: item.image, alt: item.name };
							}}
							title="Нажмите для полноразмерного просмотра"
						>
							<img src={item.image} alt={item.name} class="card-img" />

							<div class="card-top-badges">
								<span class="size-badge size-{item.size}">
									{shuttleConfig.sizes[item.size] ?? item.size}
								</span>
								<span class="dim-badge">
									{item.tileWidth}×{item.tileHeight}
								</span>
							</div>

							<!-- Like Heart Button -->
							<button
								type="button"
								class="like-btn {isCommunityShuttleLiked(item.id) ? 'liked' : ''}"
								onclick={(e) => {
									e.stopPropagation();
									handleToggleLike(item.id);
								}}
								title={isCommunityShuttleLiked(item.id) ? 'Вам понравилось' : 'Поставить лайк'}
								aria-label="Лайк"
							>
								<span class="heart-icon">❤️</span>
								<span class="like-count">{item.likes ?? 0}</span>
							</button>

							<div class="img-hover-hint">
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<circle cx="11" cy="11" r="8"></circle>
									<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
								</svg>
							</div>
						</div>

						<!-- Card Body -->
						<div class="card-body">
							<div class="card-author-row">
								<span class="card-author">
									<span class="author-icon">👤</span>
									{item.author}
								</span>
								{#if item.isUserSubmission}
									<span class="my-badge">Вы автор</span>
								{/if}
								{#if item.featured}
									<span class="featured-badge">⭐ Выбор</span>
								{/if}
							</div>

							<h3 class="card-title">{item.name}</h3>

							{#if item.description}
								<p class="card-desc">{item.description}</p>
							{/if}

							{#if item.tags && item.tags.length > 0}
								<div class="card-tags">
									{#each item.tags as t}
										<span class="card-tag">{t}</span>
									{/each}
								</div>
							{/if}

							<div class="card-stats">
								<span class="stat-item">
									<span class="stat-lbl">Сущностей:</span>
									<span class="stat-val">{item.entityCount}</span>
								</span>
								<span class="stat-item">
									<span class="stat-lbl">Добавлен:</span>
									<span class="stat-val">{formatDate(item.createdAt)}</span>
								</span>
							</div>

							<!-- Card Actions -->
							<div class="card-actions">
								<a
									href={resolve(`/shuttle?communityId=${encodeURIComponent(item.id)}`)}
									class="action-btn btn-view"
									title="Подробная информация о шаттле"
								>
									<span>👁️</span> Карточка
								</a>

								<button
									class="action-btn btn-edit"
									onclick={() => handleEditCommunity(item)}
									title="Редактировать шаттл в SS14 Map Editor"
								>
									<span>🛠️</span> В редактор
								</button>

								<button
									class="action-btn btn-icon"
									onclick={() => handleDownloadYaml(item)}
									title="Скачать файл карты SS14 Grid (.yml)"
									aria-label="Скачать .yml"
								>
									<span>📄</span>
								</button>

								<button
									class="action-btn btn-icon"
									onclick={() => handleDownloadImage(item)}
									title="Скачать PNG рендер"
									aria-label="Скачать PNG"
								>
									<span>💾</span>
								</button>

								<button
									class="action-btn btn-icon"
									onclick={() => handleCopyCommunityShare(item)}
									title="Скопировать ссылку"
									aria-label="Поделиться"
								>
									<span>🔗</span>
								</button>

								{#if item.isUserSubmission}
									<button
										class="action-btn btn-icon btn-del"
										onclick={() => handleDeleteCommunitySubmission(item)}
										title="Удалить публикацию"
										aria-label="Удалить"
									>
										<span>🗑️</span>
									</button>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{:else}
		<!-- Personal Grid -->
		{#if personalList.length === 0}
			<div class="empty-state">
				<div class="empty-icon">🛸</div>
				<h2 class="empty-title">В вашей личной галерее пока нет шаттлов</h2>
				<p class="empty-desc">
					Вы можете открыть любой ванильный шаттл из каталога, отредактировать его в редакторе карт и нажать «Сохранить в галерею», либо построить судно с нуля.
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
		{:else if filteredPersonal.length === 0}
			<div class="no-results">
				<p>По вашему запросу ничего не найдено в личной галерее.</p>
				<button
					class="btn-reset"
					onclick={() => {
						searchQuery = '';
						selectedSize = 'all';
					}}
				>
					Сбросить фильтры
				</button>
			</div>
		{:else}
			<div class="gallery-grid">
				{#each filteredPersonal as item (item.id)}
					<div class="shuttle-card hud-corner">
						<!-- Card Preview Image -->
						<div
							class="card-image-box"
							onclick={() => (previewImage = { src: item.image, alt: item.name })}
							role="button"
							tabindex="0"
							onkeydown={(e) => {
								if (e.key === 'Enter') previewImage = { src: item.image, alt: item.name };
							}}
							title="Нажмите для полноразмерного просмотра"
						>
							<img src={item.image} alt={item.name} class="card-img" />

							<div class="card-top-badges">
								<span class="size-badge size-{item.size}">
									{shuttleConfig.sizes[item.size] ?? item.size}
								</span>
								<span class="dim-badge">
									{item.tileWidth}×{item.tileHeight}
								</span>
							</div>

							<div class="img-hover-hint">
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<circle cx="11" cy="11" r="8"></circle>
									<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
								</svg>
							</div>
						</div>

						<!-- Card Body -->
						<div class="card-body">
							<div class="card-author-row">
								<span class="my-badge">Локальное сохранение</span>
							</div>

							<h3 class="card-title">{item.name}</h3>

							{#if item.description}
								<p class="card-desc">{item.description}</p>
							{/if}

							<div class="card-stats">
								<span class="stat-item">
									<span class="stat-lbl">Сущностей:</span>
									<span class="stat-val">{item.entityCount}</span>
								</span>
								<span class="stat-item">
									<span class="stat-lbl">Сохранен:</span>
									<span class="stat-val">{formatDate(item.updatedAt || item.createdAt)}</span>
								</span>
							</div>

							<!-- Card Actions -->
							<div class="card-actions">
								<button
									class="action-btn btn-publish"
									onclick={() => openPublishModal(item)}
									title="Опубликовать этот шаттл в общественную галерею"
								>
									<span>🌐</span> Опубликовать
								</button>

								<button
									class="action-btn btn-edit"
									onclick={() => handleEditPersonal(item)}
									title="Редактировать в SS14 Map Editor"
								>
									<span>🛠️</span> Редактор
								</button>

								<button
									class="action-btn btn-icon"
									onclick={() => handleDownloadYaml(item)}
									title="Скачать .yml"
									aria-label="Скачать .yml"
								>
									<span>📄</span>
								</button>

								<button
									class="action-btn btn-icon"
									onclick={() => handleDownloadImage(item)}
									title="Скачать PNG"
									aria-label="Скачать PNG"
								>
									<span>💾</span>
								</button>

								<button
									class="action-btn btn-icon"
									onclick={() => handleCopyPersonalShare(item)}
									title="Скопировать ссылку"
									aria-label="Поделиться"
								>
									<span>🔗</span>
								</button>

								<button
									class="action-btn btn-icon btn-del"
									onclick={() => handleDeletePersonal(item)}
									title="Удалить из галереи"
									aria-label="Удалить"
								>
									<span>🗑️</span>
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<!-- Modal: Publish to Community -->
{#if showPublishModal && publishTarget}
	<div
		class="modal-backdrop"
		onclick={() => (showPublishModal = false)}
		onkeydown={(e) => e.key === 'Escape' && (showPublishModal = false)}
		role="presentation"
	>
		<div
			class="modal-dialog"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
		>
			<div class="modal-header">
				<div class="modal-title-row">
					<span class="modal-icon">🌐</span>
					<h3>Публикация в общественную галерею</h3>
				</div>
				<button class="modal-close-btn" onclick={() => (showPublishModal = false)}>✕</button>
			</div>

			<div class="modal-body">
				<div class="publish-preview">
					<img src={publishTarget.image} alt={publishTarget.name} class="publish-thumb" />
					<div class="publish-info">
						<h4>{publishTarget.name}</h4>
						<p>{publishTarget.tileWidth}×{publishTarget.tileHeight} тайлов, {publishTarget.entityCount} сущностей</p>
					</div>
				</div>

				<div class="form-field">
					<label for="pub-author">Никнейм или позывной автора:</label>
					<input
						id="pub-author"
						type="text"
						bind:value={publishAuthor}
						placeholder="Например: Инженер Сидоров"
						class="form-input"
					/>
				</div>

				<div class="form-field">
					<label for="pub-tags">Теги (через запятую):</label>
					<input
						id="pub-tags"
						type="text"
						bind:value={publishTags}
						placeholder="боевой, шахтерский, скоростной"
						class="form-input"
					/>
				</div>

				<p class="modal-hint">
					Шаттл станет доступен во вкладке «Общественная галерея» для всех посетителей этой страницы.
				</p>
			</div>

			<div class="modal-footer">
				<button class="btn-cancel" onclick={() => (showPublishModal = false)}>Отмена</button>
				<button class="btn-confirm-pub" onclick={confirmPublish}>Опубликовать</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal: Import from Link -->
{#if showImportModal}
	<div
		class="modal-backdrop"
		onclick={() => (showImportModal = false)}
		onkeydown={(e) => e.key === 'Escape' && (showImportModal = false)}
		role="presentation"
	>
		<div
			class="modal-dialog"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
		>
			<div class="modal-header">
				<div class="modal-title-row">
					<span class="modal-icon">📥</span>
					<h3>Импорт шаттла по ссылке</h3>
				</div>
				<button class="modal-close-btn" onclick={() => (showImportModal = false)}>✕</button>
			</div>

			<div class="modal-body">
				<p class="modal-hint">
					Вставьте временную ссылку сообщества (например, из Discord или сайта) для добавления шаттла в общественную галерею:
				</p>

				<div class="form-field">
					<input
						type="text"
						bind:value={importInput}
						placeholder="https://.../shuttle?share=... или код sto.care"
						class="form-input font-mono"
					/>
				</div>

				{#if importError}
					<div class="form-error">⚠️ {importError}</div>
				{/if}
			</div>

			<div class="modal-footer">
				<button class="btn-cancel" onclick={() => (showImportModal = false)}>Отмена</button>
				<button
					class="btn-confirm-pub"
					onclick={handleImportLink}
					disabled={isImporting || !importInput.trim()}
				>
					{isImporting ? 'Загрузка...' : 'Импортировать'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Full-screen Image Preview -->
{#if previewImage}
	<ImageModal
		src={previewImage.src}
		alt={previewImage.alt}
		onClose={() => (previewImage = null)}
	/>
{/if}

<!-- Toast Notification -->
{#if toastMessage}
	<div class="toast-popup">
		{toastMessage}
	</div>
{/if}

<style>
	.gallery-container {
		max-width: 1400px;
		margin: 0 auto;
		padding: 24px 20px 80px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	/* Header */
	.gallery-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 20px;
		flex-wrap: wrap;
		padding-bottom: 20px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
	}

	.header-titles {
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-width: 720px;
	}

	.header-badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 10px;
		border-radius: var(--radius-sm);
		background: rgba(168, 85, 247, 0.12);
		border: 1px solid rgba(168, 85, 247, 0.3);
		color: #c084fc;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		align-self: flex-start;
	}

	.gallery-title {
		font-family: var(--font-display);
		font-size: 2rem;
		font-weight: 700;
		color: var(--text-bright);
		margin: 0;
		letter-spacing: 0.02em;
	}

	.gallery-subtitle {
		font-size: 0.92rem;
		line-height: 1.5;
		color: var(--text-dim);
		margin: 0;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.btn-create,
	.btn-import,
	.btn-catalog {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 9px 16px;
		border-radius: var(--radius);
		font-family: var(--font-display);
		font-size: 0.85rem;
		font-weight: 600;
		letter-spacing: 0.03em;
		text-decoration: none;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-create {
		background: #00adb5;
		color: #000;
		border: 1px solid #00adb5;
	}
	.btn-create:hover {
		background: #00c2cb;
		box-shadow: 0 0 15px rgba(0, 173, 181, 0.4);
	}

	.btn-import {
		background: rgba(168, 85, 247, 0.15);
		color: #d8b4fe;
		border: 1px solid rgba(168, 85, 247, 0.4);
	}
	.btn-import:hover {
		background: rgba(168, 85, 247, 0.25);
		color: #fff;
	}

	.btn-catalog {
		background: rgba(255, 255, 255, 0.05);
		color: var(--text);
		border: 1px solid var(--border-dim);
	}
	.btn-catalog:hover {
		background: rgba(255, 255, 255, 0.1);
	}

	/* Tabs */
	.gallery-tabs {
		display: flex;
		gap: 8px;
		border-bottom: 2px solid rgba(255, 255, 255, 0.06);
		padding-bottom: 2px;
	}

	.tab-btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 10px 18px;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--text-dim);
		font-family: var(--font-display);
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		margin-bottom: -4px;
	}
	.tab-btn:hover {
		color: var(--text-bright);
	}
	.tab-btn.active {
		color: var(--text-bright);
		border-bottom-color: #a855f7;
	}

	.tab-count {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		background: rgba(255, 255, 255, 0.08);
		padding: 2px 7px;
		border-radius: 9999px;
		color: var(--text-bright);
	}
	.tab-btn.active .tab-count {
		background: #a855f7;
		color: #fff;
	}

	/* Controls */
	.gallery-controls {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
	}

	.search-box {
		flex: 1;
		min-width: 260px;
		position: relative;
		display: flex;
		align-items: center;
	}

	.search-icon {
		position: absolute;
		left: 12px;
		color: var(--text-dim);
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding: 9px 34px 9px 38px;
		background: #0d1222;
		border: 1px solid var(--border-dim);
		border-radius: var(--radius);
		color: var(--text-bright);
		font-size: 0.88rem;
		transition: border-color 0.2s;
	}
	.search-input:focus {
		outline: none;
		border-color: #a855f7;
	}

	.clear-btn {
		position: absolute;
		right: 10px;
		background: transparent;
		border: none;
		color: var(--text-dim);
		font-size: 0.85rem;
		cursor: pointer;
	}

	.filter-group {
		display: flex;
		gap: 10px;
		align-items: center;
	}

	.select-control {
		padding: 9px 12px;
		background: #0d1222;
		border: 1px solid var(--border-dim);
		border-radius: var(--radius);
		color: var(--text-bright);
		font-size: 0.85rem;
		cursor: pointer;
		font-family: var(--font-body);
	}
	.select-control:focus {
		outline: none;
		border-color: #a855f7;
	}

	/* Tags Bar */
	.tags-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
		padding: 8px 12px;
		background: rgba(13, 18, 34, 0.5);
		border-radius: var(--radius);
		border: 1px solid rgba(255, 255, 255, 0.04);
	}

	.tags-label {
		font-size: 0.75rem;
		color: var(--text-dim);
		font-family: var(--font-mono);
		margin-right: 4px;
	}

	.tag-pill {
		padding: 3px 10px;
		border-radius: 9999px;
		font-size: 0.72rem;
		font-family: var(--font-mono);
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--text);
		cursor: pointer;
		transition: all 0.2s;
	}
	.tag-pill:hover {
		background: rgba(168, 85, 247, 0.15);
		color: #d8b4fe;
		border-color: rgba(168, 85, 247, 0.3);
	}
	.tag-pill.active {
		background: #a855f7;
		color: #fff;
		border-color: #a855f7;
	}

	/* Grid */
	.gallery-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 20px;
	}

	.shuttle-card {
		background: #0d1326;
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: var(--radius);
		overflow: hidden;
		display: flex;
		flex-direction: column;
		transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
	}
	.shuttle-card:hover {
		transform: translateY(-2px);
		border-color: rgba(168, 85, 247, 0.4);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}
	.shuttle-card.featured-card {
		border-color: rgba(168, 85, 247, 0.35);
		background: linear-gradient(180deg, #121026 0%, #0d1326 100%);
	}

	/* Card Image */
	.card-image-box {
		position: relative;
		width: 100%;
		height: 200px;
		background: #060914;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		cursor: pointer;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	}

	.card-img {
		max-width: 90%;
		max-height: 90%;
		object-fit: contain;
		image-rendering: pixelated;
		transition: transform 0.25s ease;
	}
	.card-image-box:hover .card-img {
		transform: scale(1.05);
	}

	.card-top-badges {
		position: absolute;
		top: 10px;
		left: 10px;
		display: flex;
		gap: 6px;
	}

	.size-badge {
		font-family: var(--font-mono);
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		padding: 2px 7px;
		border-radius: var(--radius-sm);
		background: rgba(0, 0, 0, 0.7);
		border: 1px solid rgba(255, 255, 255, 0.2);
		color: #e2e8f0;
	}
	.size-badge.size-micro { border-color: #38bdf8; color: #38bdf8; }
	.size-badge.size-small { border-color: #4ade80; color: #4ade80; }
	.size-badge.size-medium { border-color: #facc15; color: #facc15; }
	.size-badge.size-large { border-color: #fb923c; color: #fb923c; }

	.dim-badge {
		font-family: var(--font-mono);
		font-size: 0.68rem;
		padding: 2px 7px;
		border-radius: var(--radius-sm);
		background: rgba(0, 0, 0, 0.7);
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: #cbd5e1;
	}

	/* Like Button */
	.like-btn {
		position: absolute;
		top: 10px;
		right: 10px;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 9px;
		background: rgba(0, 0, 0, 0.75);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 9999px;
		color: #fff;
		font-size: 0.75rem;
		font-family: var(--font-mono);
		cursor: pointer;
		transition: all 0.2s;
		z-index: 2;
	}
	.like-btn:hover {
		background: rgba(239, 68, 68, 0.2);
		border-color: #ef4444;
	}
	.like-btn.liked {
		background: rgba(239, 68, 68, 0.25);
		border-color: #ef4444;
		color: #fca5a5;
	}

	.img-hover-hint {
		position: absolute;
		bottom: 8px;
		right: 8px;
		color: var(--text-dim);
		background: rgba(0, 0, 0, 0.6);
		padding: 4px;
		border-radius: var(--radius-sm);
		opacity: 0;
		transition: opacity 0.2s;
	}
	.card-image-box:hover .img-hover-hint {
		opacity: 1;
	}

	/* Card Body */
	.card-body {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		flex: 1;
	}

	.card-author-row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.card-author {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: #c084fc;
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.my-badge {
		font-family: var(--font-mono);
		font-size: 0.65rem;
		padding: 1px 6px;
		background: rgba(34, 197, 94, 0.15);
		border: 1px solid rgba(34, 197, 94, 0.4);
		color: #86efac;
		border-radius: var(--radius-sm);
	}

	.featured-badge {
		font-family: var(--font-mono);
		font-size: 0.65rem;
		padding: 1px 6px;
		background: rgba(250, 204, 21, 0.15);
		border: 1px solid rgba(250, 204, 21, 0.4);
		color: #fef08a;
		border-radius: var(--radius-sm);
	}

	.card-title {
		font-family: var(--font-display);
		font-size: 1.15rem;
		font-weight: 700;
		color: var(--text-bright);
		margin: 0;
		line-height: 1.3;
	}

	.card-desc {
		font-size: 0.82rem;
		color: var(--text-dim);
		line-height: 1.45;
		margin: 0;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.card-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.card-tag {
		font-family: var(--font-mono);
		font-size: 0.68rem;
		padding: 1px 6px;
		border-radius: 9999px;
		background: rgba(56, 189, 248, 0.08);
		border: 1px solid rgba(56, 189, 248, 0.25);
		color: #7dd3fc;
	}

	.card-stats {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		font-family: var(--font-mono);
		color: var(--text-dim);
		padding-top: 6px;
		border-top: 1px solid rgba(255, 255, 255, 0.05);
	}

	.stat-val {
		color: var(--text-bright);
		margin-left: 4px;
	}

	/* Card Actions */
	.card-actions {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: auto;
		padding-top: 12px;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		padding: 6px 12px;
		border-radius: var(--radius-sm);
		font-size: 0.78rem;
		font-family: var(--font-display);
		font-weight: 600;
		cursor: pointer;
		text-decoration: none;
		transition: all 0.2s;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid var(--border-dim);
		color: var(--text);
	}
	.action-btn:hover {
		background: rgba(255, 255, 255, 0.09);
		color: #fff;
	}

	.btn-view {
		flex: 1;
		background: rgba(168, 85, 247, 0.15);
		border-color: rgba(168, 85, 247, 0.4);
		color: #e9d5ff;
	}
	.btn-view:hover {
		background: rgba(168, 85, 247, 0.3);
		color: #fff;
	}

	.btn-edit {
		flex: 1;
		background: rgba(0, 173, 181, 0.15);
		border-color: rgba(0, 173, 181, 0.4);
		color: #6ee7b7;
	}
	.btn-edit:hover {
		background: rgba(0, 173, 181, 0.3);
		color: #fff;
	}

	.btn-publish {
		flex: 1;
		background: rgba(147, 51, 234, 0.18);
		border-color: rgba(147, 51, 234, 0.5);
		color: #d8b4fe;
	}
	.btn-publish:hover {
		background: rgba(147, 51, 234, 0.35);
		color: #fff;
	}

	.btn-icon {
		padding: 6px 9px;
	}

	.btn-del:hover {
		background: rgba(239, 68, 68, 0.2);
		border-color: #ef4444;
		color: #fca5a5;
	}

	/* Empty States */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 60px 20px;
		background: rgba(13, 18, 34, 0.4);
		border: 1px dashed rgba(255, 255, 255, 0.1);
		border-radius: var(--radius);
		gap: 16px;
		max-width: 600px;
		margin: 40px auto;
	}

	.empty-icon {
		font-size: 3rem;
	}

	.empty-title {
		font-family: var(--font-display);
		font-size: 1.3rem;
		color: var(--text-bright);
		margin: 0;
	}

	.empty-desc {
		font-size: 0.88rem;
		color: var(--text-dim);
		line-height: 1.5;
		margin: 0;
	}

	.empty-actions {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		justify-content: center;
		margin-top: 8px;
	}

	.btn-primary-lg,
	.btn-secondary-lg {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 10px 20px;
		border-radius: var(--radius);
		font-family: var(--font-display);
		font-size: 0.9rem;
		font-weight: 600;
		text-decoration: none;
		transition: all 0.2s;
	}
	.btn-primary-lg {
		background: #00adb5;
		color: #000;
	}
	.btn-secondary-lg {
		background: rgba(255, 255, 255, 0.06);
		color: var(--text-bright);
		border: 1px solid var(--border-dim);
	}

	.no-results {
		text-align: center;
		padding: 50px 20px;
		color: var(--text-dim);
	}

	.btn-reset {
		margin-top: 10px;
		padding: 8px 16px;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid var(--border-dim);
		border-radius: var(--radius);
		color: var(--text-bright);
		cursor: pointer;
	}

	/* Modals */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.8);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 9999;
		padding: 16px;
	}

	.modal-dialog {
		background: #0d1222;
		border: 1px solid #2d2350;
		border-radius: 12px;
		width: 100%;
		max-width: 480px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 24px;
		box-shadow: 0 16px 36px rgba(0, 0, 0, 0.6);
		color: #e2e8f0;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.modal-title-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.modal-title-row h3 {
		font-family: var(--font-display);
		font-size: 1.15rem;
		margin: 0;
		color: #fff;
	}

	.modal-close-btn {
		background: transparent;
		border: none;
		color: var(--text-dim);
		font-size: 1.2rem;
		cursor: pointer;
	}

	.modal-body {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.publish-preview {
		display: flex;
		gap: 12px;
		align-items: center;
		padding: 10px;
		background: rgba(0, 0, 0, 0.4);
		border-radius: var(--radius);
		border: 1px solid rgba(255, 255, 255, 0.08);
	}

	.publish-thumb {
		width: 64px;
		height: 64px;
		object-fit: contain;
		image-rendering: pixelated;
	}

	.publish-info h4 {
		margin: 0 0 4px 0;
		color: #fff;
	}
	.publish-info p {
		margin: 0;
		font-size: 0.78rem;
		font-family: var(--font-mono);
		color: var(--text-dim);
	}

	.form-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.form-field label {
		font-size: 0.78rem;
		font-family: var(--font-mono);
		color: #c084fc;
		text-transform: uppercase;
	}

	.form-input {
		width: 100%;
		padding: 8px 12px;
		background: #070914;
		border: 1px solid #3b2a60;
		border-radius: var(--radius-sm);
		color: #fff;
		font-size: 0.88rem;
	}
	.form-input:focus {
		outline: none;
		border-color: #a855f7;
	}

	.form-error {
		padding: 8px 12px;
		background: rgba(239, 68, 68, 0.15);
		border: 1px solid rgba(239, 68, 68, 0.4);
		border-radius: var(--radius-sm);
		font-size: 0.8rem;
		color: #fca5a5;
	}

	.modal-hint {
		font-size: 0.8rem;
		color: var(--text-dim);
		line-height: 1.4;
		margin: 0;
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		padding-top: 8px;
	}

	.btn-cancel {
		padding: 8px 16px;
		background: transparent;
		border: 1px solid var(--border-dim);
		border-radius: var(--radius);
		color: var(--text);
		cursor: pointer;
	}

	.btn-confirm-pub {
		padding: 8px 18px;
		background: #a855f7;
		border: 1px solid #a855f7;
		border-radius: var(--radius);
		color: #fff;
		font-weight: 600;
		cursor: pointer;
	}
	.btn-confirm-pub:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Toast */
	.toast-popup {
		position: fixed;
		bottom: 24px;
		right: 24px;
		padding: 12px 20px;
		background: #18112c;
		border: 1px solid #a855f7;
		border-radius: var(--radius);
		color: #fff;
		font-size: 0.88rem;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
		z-index: 10000;
		animation: toastSlide 0.3s ease-out;
	}

	@keyframes toastSlide {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
