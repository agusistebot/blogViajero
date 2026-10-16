#!/usr/bin/env node
/** Servidor local para ver dist/ en http://localhost:8080 (simula la carpeta del repositorio de GitHub Pages). */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { p, readJson } from './lib/util.mjs';

const site = await readJson(p('config/site.json'));
const BASE = new URL((process.env.SITE_URL || site.url).replace(/\/+$/, '') + '/').pathname.replace(/\/+$/, '');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const PORT = process.env.PORT || 8080;

createServer(async (req, res) => {
  let ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (BASE && ruta.startsWith(BASE)) ruta = ruta.slice(BASE.length) || '/';
  let archivo = join(p('dist'), ruta);
  try {
    if ((await stat(archivo)).isDirectory()) archivo = join(archivo, 'index.html');
    res.writeHead(200, { 'content-type': TIPOS[extname(archivo)] || 'application/octet-stream' });
    res.end(await readFile(archivo));
  } catch {
    res.writeHead(404, { 'content-type': TIPOS['.html'] });
    res.end(await readFile(join(p('dist'), '404.html')).catch(() => 'No encontrado'));
  }
}).listen(PORT, () => console.log(`Sitio en http://localhost:${PORT}${BASE}/`));
