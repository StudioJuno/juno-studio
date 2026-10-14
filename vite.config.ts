import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
// La version affichée par l'application est celle de package.json, jamais un texte recopié à la main.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
export default defineConfig({base:'./',define:{__JUNO_VERSION__:JSON.stringify(version)},server:{port:5173,strictPort:true},preview:{port:4173,strictPort:true}});
