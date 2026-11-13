<script lang="ts">
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import configJson from '$root/config.json' with { type: 'json' };

	let editorUrl = $state(`${base}/editor/index.html`);

	onMount(() => {
		const shuttleId = new URLSearchParams(window.location.search).get('shuttle');
		if (shuttleId) {
			editorUrl = `${base}/editor/index.html?shuttle=${encodeURIComponent(shuttleId)}`;
		}
	});
</script>

<svelte:head>
	<title>Редактор шаттлов (Маппинг) — {configJson.name}</title>
	<meta
		name="description"
		content="Интерактивный редактор и маппинг шаттлов Space Station 14 с поддержкой билда Monolith и экспортом в формате Grid YAML."
	/>
</svelte:head>

<div class="editor-container">
	<iframe
		src={editorUrl}
		title="SS14 Shuttle Map Editor"
		class="editor-frame"
		allow="clipboard-read; clipboard-write; fullscreen"
	></iframe>
</div>

<style>
	.editor-container {
		width: 100%;
		height: calc(100vh - 58px);
		min-height: 600px;
		display: flex;
		flex-direction: column;
		background: #080c16;
		overflow: hidden;
	}

	.editor-frame {
		width: 100%;
		height: 100%;
		border: none;
		outline: none;
		background: #080c16;
	}
</style>
