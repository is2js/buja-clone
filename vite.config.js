import { defineConfig } from 'vite';
import { vworldDevProxy } from './scripts/vworld-dev-proxy.mjs';
export default defineConfig({ base:'./', plugins:[vworldDevProxy()] });
