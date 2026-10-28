import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
 root: fileURLToPath(new URL('.',import.meta.url)),
 base: '/noir-invoice/',
 resolve: { alias: {
   'pdf-lib': fileURLToPath(new URL('./node_modules/pdf-lib',import.meta.url)),
   '@pdf-lib/fontkit': fileURLToPath(new URL('./node_modules/@pdf-lib/fontkit',import.meta.url)),
 } },
 build: {outDir:'../public/noir-invoice',emptyOutDir:true},
});
