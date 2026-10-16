#!/usr/bin/env node
/** Descarga a static/img las fotos de la biblioteca que todavía no estén guardadas. */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { p, readJson, log, sleep } from './lib/util.mjs';
import { commonsUrl } from './lib/commons.mjs';

const imagenes = await readJson(p('data/imagenes.json'));
await mkdir(p('static/img'), { recursive: true });

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
let bajadas = 0;

for (const img of imagenes.lista) {
  if (['jpg', 'png', 'webp'].some((e) => existsSync(p('static/img', `${img.clave}.${e}`)))) continue;
  try {
    const res = await fetch(commonsUrl(img.archivo, 1280), {
      headers: { 'user-agent': 'BlogViajeroUruguayo/1.0 (sitio de noticias de viajes; contacto vía GitHub)' },
      redirect: 'follow',
    });
    const tipo = (res.headers.get('content-type') || '').split(';')[0];
    if (!res.ok || !EXT[tipo]) throw new Error(`HTTP ${res.status} ${tipo}`);
    await writeFile(p('static/img', `${img.clave}.${EXT[tipo]}`), Buffer.from(await res.arrayBuffer()));
    bajadas++;
    log(`  ✓ ${img.clave}`);
    await sleep(500);
  } catch (err) {
    log(`  ✗ ${img.clave}: ${err.message} (se usará el enlace remoto)`);
  }
}
log(`Imágenes nuevas descargadas: ${bajadas}`);
