import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import galleryApiHandler from './api/gallery.js';

function localGalleryApiPlugin() {
	return {
		name: 'local-gallery-api',
		configureServer(server: any) {
			server.middlewares.use('/api/gallery', async (req: any, res: any, next: any) => {
				try {
					await galleryApiHandler(req, res);
				} catch (err) {
					next(err);
				}
			});
		}
	};
}

export default defineConfig({
	plugins: [localGalleryApiPlugin(), tailwindcss(), sveltekit()]
});
