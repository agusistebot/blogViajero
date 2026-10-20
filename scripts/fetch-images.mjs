#!/usr/bin/env node
/** Descarga a static/img las fotos de la biblioteca que todavía no estén guardadas. */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { p, readJson, log, sleep } from './lib/util.mjs';
import { commonsUrl, buscarFotoLibre } from './lib/commons.mjs';
import { writeJson } from './lib/util.mjs';

const imagenes = await readJson(p('data/imagenes.json'));

// Notas escritas a mano (data/editorial.json) pueden pedir una foto con "imagen": {"clave": "...", "busqueda": "palabras en inglés"}
const editorial = (await readJson(p('data/editorial.json'), { notas: [] })).notas;
let agregadas = 0;
for (const n of editorial) {
  const { clave, busqueda } = n.imagen || {};
  if (!clave || !busqueda || imagenes.lista.some((i) => i.clave === clave)) continue;
  const foto = await buscarFotoLibre(busqueda);
  if (!foto) continue;
  imagenes.lista.push({ clave, descripcion: busqueda, alt: n.imagen.alt || foto.alt, archivo: foto.archivo, autor: foto.autor, licencia: foto.licencia, temas: [], auto: true });
  agregadas++;
  log(`  + foto para "${n.titulo}": ${foto.archivo}`);
}
if (agregadas) await writeJson(p('data/imagenes.json'), imagenes);
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
