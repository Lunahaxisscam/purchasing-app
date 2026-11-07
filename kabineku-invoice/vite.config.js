import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
 root: fileURLToPath(new URL('.',import.meta.url)),
 base: '/kabineku-invoice/',
 resolve: { alias: {
   'pdf-lib': fileURLToPath(new URL('./node_modules/pdf-lib',import.meta.url)),
   '@pdf-lib/fontkit': fileURLToPath(new URL('./node_modules/@pdf-lib/fontkit',import.meta.url)),
 } },
 build: {assetsInlineLimit: 2000000,outDir:'../public/kabineku-invoice',emptyOutDir:true},
});
