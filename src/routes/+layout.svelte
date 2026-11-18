<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.png';
	import Header from '$lib/header.svelte';
	import configJson from '$root/config.json' with { type: 'json' };
	import Footer from '../lib/footer.svelte';
	import { fetchCatalogPublicState, type SiteSettings } from '$lib';
	import { onMount } from 'svelte';

	let { children } = $props();
	let siteSettings = $state<SiteSettings>({ bannerText: '', bannerType: 'info' });

	onMount(() => {
		const refresh = (force = false) => {
			fetchCatalogPublicState(force).then((st) => {
				if (st.siteSettings) siteSettings = st.siteSettings;
			});
		};
		refresh(false);
		const onUpdate = () => refresh(true);
		window.addEventListener('webmap:catalog_updated', onUpdate);
		return () => window.removeEventListener('webmap:catalog_updated', onUpdate);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>{configJson.name}</title>
</svelte:head>

<div class="flex h-full min-h-fit w-full flex-1 flex-col">
	<Header />
	{#if siteSettings.bannerText}
		<div
			class="w-full px-4 py-2 text-center text-xs font-medium tracking-wide border-b"
			style={siteSettings.bannerType === 'warning'
				? 'background: rgba(240, 165, 0, 0.14); border-color: rgba(240, 165, 0, 0.35); color: #ffd166;'
				: siteSettings.bannerType === 'success'
					? 'background: rgba(63, 185, 80, 0.14); border-color: rgba(63, 185, 80, 0.35); color: #8be29a;'
					: 'background: rgba(65, 182, 251, 0.12); border-color: rgba(65, 182, 251, 0.32); color: #82d3ff;'}
		>
			{siteSettings.bannerText}
		</div>
	{/if}
	<main class="flex flex-1 flex-col">
		{@render children()}
	</main>
	<Footer />
</div>
