#!/usr/bin/env node
/**
 * Robot de guías (posts de blog).
 * Cada lunes escribe guías de destinos ("Las mejores playas de México…") y guías de requisitos
 * ("¿Necesito visa para ir a Tailandia?"). Las de requisitos SOLO se publican si Gemini pudo
 * verificarlas con la búsqueda de Google; si no, quedan para la semana siguiente.
 *
 * Uso:  GEMINI_API_KEY=... node scripts/write-guides.mjs
 */
import { p, readJson, writeJson, slugify, titleSimilarity, log } from './lib/util.mjs';
import { gemini, modelosDisponibles, resolverFuentes } from './lib/gemini.mjs';
import { buscarFotoLibre } from './lib/commons.mjs';

const site = await readJson(p('config/site.json'));
const cfg = site.ia || {};
const g = cfg.guias || {};
const noticias = await readJson(p('data/news.json'), []);
const editorial = (await readJson(p('data/editorial.json'), { notas: [] })).notas;
const imagenes = await readJson(p('data/imagenes.json'));
const INICIO = Date.now();
const LIMITE_MS = (g.minutosMaximos || 12) * 60_000;

const nDestinos = g.destinosPorSemana ?? 2;
const nRequisitos = g.requisitosPorSemana ?? 2;
if (!nDestinos && !nRequisitos) process.exit(0);
if (!process.env.GEMINI_API_KEY) {
  log('⚠ No hay GEMINI_API_KEY: no se escriben guías.');
  process.exit(0);
}

const hoy = new Date();
const fechaHoy = new Intl.DateTimeFormat('es-UY', { timeZone: site.zonaHoraria, dateStyle: 'full' }).format(hoy);
const anteriores = [...editorial, ...noticias];
const guiasPrevias = anteriores.filter((n) => n.tipo === 'guia' || n.categoria === 'guias' || n.categoria === 'requisitos').map((n) => n.titulo);

const MODELOS = await modelosDisponibles({ preferidos: cfg.modelos || [] });
log(`Modelos de Gemini disponibles: ${MODELOS.join(', ')}`);

// ---------- 1. Elegir temas ----------
const schemaTemas = {
  type: 'OBJECT',
  properties: {
    destinos: { type: 'ARRAY', items: { type: 'OBJECT', properties: { titulo: { type: 'STRING' }, enfoque: { type: 'STRING' } }, required: ['titulo', 'enfoque'] } },
    requisitos: { type: 'ARRAY', items: { type: 'OBJECT', properties: { titulo: { type: 'STRING' }, enfoque: { type: 'STRING' } }, required: ['titulo', 'enfoque'] } },
  },
  required: ['destinos', 'requisitos'],
};

const promptTemas = `Hoy es ${fechaHoy}. Sos el editor de "${site.nombre}", un blog para uruguayos que viajan como turistas.
Elegí los temas de esta semana:
- ${nDestinos} guías de DESTINOS (playas, ciudades, itinerarios, cuándo ir, consejos). Pensá en la temporada: en Uruguay es ${['verano', 'verano', 'otoño', 'otoño', 'otoño', 'invierno', 'invierno', 'invierno', 'primavera', 'primavera', 'primavera', 'verano'][hoy.getMonth()]}, y la gente planifica con 1 a 3 meses de anticipación (vacaciones de julio, Semana de Turismo, verano, fiestas).
- ${nRequisitos} guías de REQUISITOS para pasar migraciones: visas, vacunas, documentos, autorizaciones electrónicas, menores, seguros obligatorios, aduana. Escribí el título como la pregunta que haría un uruguayo en Google o a un asistente de IA (ej: "¿Necesito visa para ir a Tailandia siendo uruguayo?").

Ideas sugeridas (podés usarlas o proponer otras mejores):
DESTINOS: ${(g.ideasDestinos || []).join(' | ')}
REQUISITOS: ${(g.ideasRequisitos || []).join(' | ')}

Ya publicamos estas guías; NO repitas el mismo tema ni uno casi igual:
${guiasPrevias.map((t) => '- ' + t).join('\n') || '- (ninguna todavía)'}

En "enfoque" escribí en una oración qué tiene que cubrir la guía.`;

let temas;
try {
  temas = (await gemini({ prompt: promptTemas, schema: schemaTemas, temperatura: 0.8, modelos: MODELOS })).json;
} catch (err) {
  log(`⚠ No se pudieron elegir temas: ${err.message}. Se intenta el lunes que viene.`);
  process.exit(0);
}
const yaExiste = (t) => anteriores.some((n) => titleSimilarity(n.titulo, t) > 0.5);
const colaReq = (temas?.requisitos || []).filter((t) => !yaExiste(t.titulo)).slice(0, nRequisitos);
const colaDest = (temas?.destinos || []).filter((t) => !yaExiste(t.titulo)).slice(0, nDestinos);
log(`Temas: ${[...colaReq, ...colaDest].map((t) => t.titulo).join(' | ')}`);

// ---------- 2. Redactar ----------
const clavesImagen = imagenes.lista.map((i) => `${i.clave} (${i.descripcion})`).join('; ');
const evitar = (cfg.evitar?.temas || []).join('; ');
const recos = (cfg.recomendaciones?.lista || []).map((r) => `- Si la guía trata de ${r.tema}, mencioná una sola vez y de forma natural a [${r.marca}](${r.url}), ${r.texto}.`).join('\n');

const SISTEMA = `Sos redactor de "${site.nombre}", un blog para personas que viven en Uruguay y viajan como turistas.
- Español rioplatense con voseo, cálido, claro y con ganas de viajar. Tono positivo: nada de alarmismo ni de historias negativas (${evitar}).
- Todo pensado para quien sale desde Uruguay: cómo llegar desde Montevideo, conexiones habituales, moneda, temporada, documentos.
- Nunca inventes datos. Precios siempre como referencia aproximada y con moneda.
${recos}`;

function promptGuia(tema, tipo) {
  const esReq = tipo === 'requisitos';
  return `Fecha de hoy: ${hoy.toISOString().slice(0, 10)}.
Escribí una guía para el blog.
Tema: ${tema.titulo}
Qué tiene que cubrir: ${tema.enfoque}
${
  esReq
    ? `Es una guía de REQUISITOS LEGALES Y MIGRATORIOS para ciudadanos uruguayos con pasaporte uruguayo. Buscá en Google y basate SOLO en fuentes oficiales y actuales: cancillerías, embajadas y consulados, sitios de migraciones o de visas del país de destino, Ministerio de Relaciones Exteriores y Ministerio de Salud Pública de Uruguay, OMS, CDC. Respondé la pregunta del título en la primera oración (sí/no y en qué condiciones). Detallá: documento necesario y vigencia mínima del pasaporte, si hace falta visa o autorización electrónica y cómo se pide, días de estadía permitidos, vacunas obligatorias y recomendadas, pasaje de salida, solvencia económica, seguro y lo que suelen preguntar en migraciones. Si algún dato no lo podés confirmar en una fuente oficial, no lo pongas.`
    : 'Es una guía de DESTINO: inspirá y a la vez dá información práctica (cómo llegar desde Uruguay, mejor época, cuántos días, qué ver, consejos de dinero y documentos).'
}

Respondé SOLO con un objeto JSON válido, sin texto antes ni después:
{
  "titulo": "título de máximo 95 caracteres${esReq ? ', en forma de pregunta' : ''}",
  "bajada": "resumen de 120 a 160 caracteres para buscadores",
  "etiquetas": ["3 a 6 etiquetas: países, ciudades, temas"],
  "destino": "país o ciudad principal",
  "puntosClave": ["4 o 5 oraciones completas y autosuficientes con lo más importante"],
  "cuerpo": "guía de 600 a 900 palabras en markdown simple (párrafos, **negritas**, listas con '- ' y subtítulos '## '). Terminá con '## Consejos para viajar desde Uruguay'.",
  "faq": [{"pregunta": "pregunta como la buscaría la gente", "respuesta": "1 o 2 oraciones"}],
  ${esReq ? '"fuentes_oficiales": [{"nombre": "organismo", "url": "dirección exacta de la página oficial consultada"}],' : ''}
  "imagen_clave": "una clave de esta lista si encaja bien, o vacío: ${clavesImagen}",
  "imagen_busqueda": "si ninguna clave encaja, 2 a 4 palabras EN INGLÉS para buscar una foto libre del lugar; si no, vacío"
}
Incluí 3 o 4 preguntas en "faq".`;
}

async function urlResponde(url) {
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'Mozilla/5.0 BlogViajeroUruguayo' } });
    return res.status < 400;
  } catch {
    return false;
  }
}

async function elegirImagen(n, categoria) {
  if (n.imagen_clave && imagenes.lista.some((i) => i.clave === n.imagen_clave)) return { clave: n.imagen_clave };
  if (n.imagen_busqueda) {
    const clave = slugify(n.imagen_busqueda);
    if (imagenes.lista.some((i) => i.clave === clave)) return { clave };
    const foto = await buscarFotoLibre(n.imagen_busqueda);
    if (foto) {
      imagenes.lista.push({ clave, descripcion: n.imagen_busqueda, alt: foto.alt, archivo: foto.archivo, autor: foto.autor, licencia: foto.licencia, temas: [n.destino || ''].filter(Boolean), auto: true });
      return { clave };
    }
  }
  return { clave: imagenes.porCategoria[categoria] || 'carrasco' };
}

const nuevas = [];
let busquedaDisponible = cfg.usarBusquedaGoogle !== false;

async function escribir(tema, tipo) {
  const esReq = tipo === 'requisitos';
  if (Date.now() - INICIO > LIMITE_MS) return log('Se alcanzó el tiempo máximo de guías; el resto queda para el lunes que viene.');
  if (esReq && !busquedaDisponible) return log(`  "${tema.titulo}": queda para el lunes que viene (las guías de requisitos solo se publican verificadas con Google).`);
  log(`Escribiendo guía: ${tema.titulo}`);

  let r;
  if (busquedaDisponible) {
    try {
      r = await gemini({ prompt: promptGuia(tema, tipo), sistema: SISTEMA, buscar: true, temperatura: 0.6, modelos: MODELOS });
    } catch (err) {
      if (!err.cupo) return log(`  ✗ ${err.message}`);
      busquedaDisponible = false;
      log(`  ${err.message}`);
      if (esReq) return log('  queda para el lunes que viene (sin verificación no se publican requisitos).');
    }
  }
  if (!r) {
    try {
      r = await gemini({ prompt: promptGuia(tema, tipo), sistema: SISTEMA, temperatura: 0.6, modelos: MODELOS });
    } catch (err) {
      return log(`  ✗ ${err.message}`);
    }
  }
  const n = r.json;
  if (!n?.titulo || !n?.cuerpo) return log('  ✗ la respuesta no era un JSON válido');
  if ([...anteriores, ...nuevas].some((x) => titleSimilarity(x.titulo, n.titulo) > 0.5)) return log('  descartada: ya hay una guía parecida');

  let fuentes = await resolverFuentes(r.fuentesWeb || []);
  if (esReq) {
    for (const f of n.fuentes_oficiales || []) {
      if (fuentes.length >= 6 || !/^https?:\/\//.test(f?.url || '')) continue;
      if (fuentes.some((x) => x.url === f.url)) continue;
      if (await urlResponde(f.url)) fuentes.push({ nombre: f.nombre || new URL(f.url).hostname, url: f.url });
    }
    if (!fuentes.length) return log('  descartada: no se pudo confirmar ninguna fuente oficial (se reintenta otro lunes)');
  }

  const categoria = esReq ? 'requisitos' : 'guias';
  let slug = slugify(n.titulo);
  if ([...anteriores, ...nuevas].some((x) => x.slug === slug)) slug = `${slug}-${hoy.toISOString().slice(0, 10)}`;
  nuevas.push({
    id: `${hoy.toISOString().slice(0, 10)}-${slug.slice(0, 40)}`,
    slug,
    tipo: 'guia',
    titulo: n.titulo.trim().slice(0, 140),
    bajada: (n.bajada || '').trim().slice(0, 200),
    categoria,
    etiquetas: (n.etiquetas || []).slice(0, 6),
    destino: n.destino || '',
    fecha: new Date().toISOString(),
    puntosClave: (n.puntosClave || []).slice(0, 5),
    cuerpo: n.cuerpo,
    faq: (n.faq || []).filter((f) => f?.pregunta && f?.respuesta).slice(0, 5),
    imagen: await elegirImagen(n, categoria),
    fuentes,
    verificadaConBusqueda: !!r.conBusqueda,
    origen: 'ia',
    modelo: r.modelo,
  });
  await guardar();
  log(`  ✓ ${n.titulo}`);
}

async function guardar() {
  const todas = [...nuevas, ...noticias].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 2000);
  await writeJson(p('data/news.json'), todas);
  await writeJson(p('data/imagenes.json'), imagenes);
}

// Requisitos primero: necesitan la búsqueda de Google, que tiene cupo limitado.
for (const t of colaReq) await escribir(t, 'requisitos');
for (const t of colaDest) await escribir(t, 'destinos');
log(`Listo: ${nuevas.length} guías nuevas.`);
