#!/usr/bin/env node
/**
 * Robot de noticias.
 * 1) Lee medios nacionales e internacionales (Google Noticias + RSS directos).
 * 2) Gemini elige lo relevante para quien viaja desde Uruguay.
 * 3) Gemini redacta cada nota original (con verificación en Google si está activada).
 * 4) Guarda en data/news.json. El sitio se regenera con scripts/build.mjs.
 *
 * Uso:  GEMINI_API_KEY=... node scripts/update-news.mjs
 *       node scripts/update-news.mjs --simular   (solo lee los medios, no llama a Gemini)
 */
import { p, readJson, writeJson, slugify, titleSimilarity, fetchText, stripHtml, log } from './lib/util.mjs';
import { leerFeed, googleNewsUrl } from './lib/rss.mjs';
import { gemini, modelosDisponibles } from './lib/gemini.mjs';
import { buscarFotoLibre } from './lib/commons.mjs';

const SIMULAR = process.argv.includes('--simular');
const CATEGORIAS = ['vuelos', 'cruceros', 'requisitos', 'destinos', 'ofertas', 'datos', 'turismo-receptivo', 'guias'];

const site = await readJson(p('config/site.json'));
const fuentes = await readJson(p('config/fuentes.json'));
const noticias = await readJson(p('data/news.json'), []);
const editorial = (await readJson(p('data/editorial.json'), { notas: [] })).notas;
const procesadas = await readJson(p('data/procesadas.json'), { links: [], titulos: [] });
procesadas.fallidas ||= {}; // link -> intentos fallidos (se reintenta hasta 3 veces en corridas siguientes)
const imagenes = await readJson(p('data/imagenes.json'));
const cfg = site.ia || {};
const INICIO = Date.now();
const LIMITE_MS = (cfg.minutosMaximos || 15) * 60_000; // después de esto se guarda lo hecho y se termina

// ---------- 1. Leer medios ----------
log('Leyendo medios…');
const tareas = [
  ...fuentes.google_news.map((g) => ({ url: googleNewsUrl(g, Math.ceil((cfg.horasHaciaAtras || 192) / 24)), medio: '', etiqueta: `Google Noticias: ${g.q}` })),
  ...fuentes.rss.map((r) => ({ url: r.url, medio: r.nombre, etiqueta: r.nombre })),
];
const resultados = await Promise.allSettled(tareas.map((t) => leerFeed(t.url, t.medio)));
let items = [];
resultados.forEach((r, i) => {
  if (r.status === 'fulfilled') {
    items.push(...r.value);
    log(`  ✓ ${tareas[i].etiqueta}: ${r.value.length}`);
  } else {
    log(`  ✗ ${tareas[i].etiqueta}: ${r.reason?.message}`);
  }
});

// ---------- 2. Filtrar: recientes, no vistas, sin duplicados ----------
const limite = Date.now() - (cfg.horasHaciaAtras || 192) * 3600e3;
const vistosLinks = new Set(procesadas.links);
const titulosPublicados = [...editorial, ...noticias].slice(0, 220).map((n) => n.titulo).concat(procesadas.titulos.slice(-400));

const candidatos = [];
for (const it of items.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))) {
  if (it.fecha && Date.parse(it.fecha) < limite) continue;
  if (vistosLinks.has(it.link) && !(procesadas.fallidas[it.link] < 3)) continue;
  if (titulosPublicados.some((t) => titleSimilarity(t, it.titulo) > 0.55)) continue;
  if (candidatos.some((c) => c.link === it.link || titleSimilarity(c.titulo, it.titulo) > 0.7)) continue;
  candidatos.push(it);
  if (candidatos.length >= (cfg.maxCandidatos || 120)) break;
}
candidatos.forEach((c, i) => (c.id = i + 1));
log(`${items.length} notas leídas, ${candidatos.length} candidatas nuevas.`);

if (SIMULAR) {
  for (const c of candidatos.slice(0, 40)) log(`  [${c.id}] ${c.medio} · ${c.titulo}`);
  log('Modo simulación: no se llamó a Gemini ni se guardó nada.');
  process.exit(0);
}
if (!process.env.GEMINI_API_KEY) {
  log('⚠ No hay GEMINI_API_KEY: no se generan noticias nuevas (el sitio se publica igual con lo que ya hay).');
  process.exit(0);
}
if (!candidatos.length) {
  log('No hay noticias nuevas en este momento.');
  process.exit(0);
}

// ---------- 3. Gemini elige lo relevante ----------
const MODELOS = await modelosDisponibles({ preferidos: cfg.modelos || [] });
log(`Modelos de Gemini disponibles: ${MODELOS.join(', ')}`);
let buscarActivo = cfg.usarBusquedaGoogle !== false;
const SISTEMA_EDITOR = `Sos el editor de "${site.nombre}", un medio de noticias de viajes para personas que viven en Uruguay y viajan como turistas: salen por el Aeropuerto de Carrasco, por Buquebus o en ómnibus, y sus destinos más comunes son Argentina, Brasil, Chile, el Caribe, Estados Unidos y Europa. Priorizás lo que cambia la decisión o la experiencia de ese viajero.`;

const listado = candidatos
  .map((c) => `[${c.id}] (${c.medio || 'medio desconocido'}, ${c.fecha ? c.fecha.slice(0, 10) : 's/f'}) ${c.titulo}${c.resumen ? ' — ' + c.resumen.slice(0, 220) : ''}`)
  .join('\n');

const promptSeleccion = `Estas son notas recientes de medios uruguayos, regionales e internacionales.

Puntuá de 1 a 10 qué tan útil es cada HISTORIA para un turista que viaja desde Uruguay.
El sitio tiene un tono POSITIVO: queremos que la gente tenga ganas de viajar y confíe en hacerlo.

Puntúan alto (8-10): rutas y frecuencias NUEVAS o ampliadas desde/hacia Montevideo o Punta del Este; cambios en visas, requisitos de entrada, políticas migratorias, documentos, vacunas o tasas que afecten a uruguayos (Brasil, Argentina, EE. UU., Europa/ETIAS/EES, Asia, etc.), incluidas exenciones de visa y nuevos trámites; cruceros que salen o paran en Uruguay; bajas de precios, tasas o impuestos y beneficios para el viajero; datos oficiales de turismo emisivo uruguayo.
Puntúan medio (6-7): novedades atractivas de destinos muy elegidos por uruguayos (aperturas, eventos, temporadas), rankings internacionales, tendencias con impacto práctico.
Puntúan bajo (1-5): noticias corporativas o financieras sin efecto en el pasajero, turismo receptivo sin interés para quien viaja al exterior, publirreportajes, temas ya publicados.

PUNTAJE 1 OBLIGATORIO (no publicar nunca), aunque afecten a uruguayos:
${(cfg.evitar?.temas || []).map((t) => '- ' + t).join('\n')}
Un cambio migratorio que endurece requisitos SÍ se puede publicar: es información útil, no una mala noticia.

Ya publicamos (no repetir):
${titulosPublicados.slice(0, 40).map((t) => '- ' + t).join('\n')}

Si varias notas cuentan la misma historia, agrupalas en un solo elemento con todos sus ids.
Devolvé solo historias con puntaje >= 6, ordenadas de mayor a menor.

NOTAS:
${listado}`;

const schemaSeleccion = {
  type: 'OBJECT',
  properties: {
    seleccion: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          ids: { type: 'ARRAY', items: { type: 'INTEGER' } },
          puntaje: { type: 'INTEGER' },
          tema: { type: 'STRING' },
          motivo: { type: 'STRING' },
        },
        required: ['ids', 'puntaje', 'tema'],
      },
    },
  },
  required: ['seleccion'],
};

log('Gemini elige las noticias relevantes…');
let sel;
try {
  sel = await gemini({ prompt: promptSeleccion, sistema: SISTEMA_EDITOR, schema: schemaSeleccion, temperatura: 0.2, modelos: MODELOS });
} catch (err) {
  log(`⚠ No se pudo elegir noticias: ${err.message}. Se reintenta en la próxima corrida; el sitio se publica igual.`);
  process.exit(0);
}
const elegidas = (sel.json?.seleccion || [])
  .filter((s) => s.puntaje >= (cfg.puntajeMinimo || 7))
  .sort((a, b) => b.puntaje - a.puntaje)
  .slice(0, cfg.maxNoticiasPorEjecucion || 4);
log(`  ${elegidas.length} historias elegidas (modelo ${sel.modelo}).`);

// Lo que Gemini descartó se marca como procesado para no volver a evaluarlo.
// Las elegidas se marcan recién cuando se publican (o después de 3 intentos fallidos).
const idsElegidos = new Set(elegidas.flatMap((s) => s.ids));
for (const c of candidatos) if (!idsElegidos.has(c.id) && !procesadas.links.includes(c.link)) procesadas.links.push(c.link);

async function guardar() {
  procesadas.links = procesadas.links.slice(-4000);
  procesadas.titulos = procesadas.titulos.slice(-1000);
  const todas = [...nuevas, ...noticias].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 2000);
  await writeJson(p('data/news.json'), todas);
  await writeJson(p('data/procesadas.json'), procesadas);
  await writeJson(p('data/imagenes.json'), imagenes);
  return todas.length;
}
function marcarFallida(grupo) {
  for (const c of grupo) {
    procesadas.fallidas[c.link] = (procesadas.fallidas[c.link] || 0) + 1;
    if (procesadas.fallidas[c.link] >= 3) procesadas.links.push(c.link);
  }
}

// ---------- 4. Redactar cada nota ----------
const clavesImagen = imagenes.lista.map((i) => `${i.clave} (${i.descripcion})`).join('; ');

async function textoDelArticulo(link) {
  if (/news\.google\.com/.test(link)) return '';
  try {
    const { text } = await fetchText(link, { timeout: 15000 });
    const art = text.match(/<article[\s\S]*?<\/article>/i)?.[0] || text;
    const parrafos = [...art.matchAll(/<p[\s>][\s\S]*?<\/p>/gi)].map((m) => stripHtml(m[0])).filter((x) => x.length > 60);
    return parrafos.join('\n').slice(0, 7000);
  } catch {
    return '';
  }
}

const SISTEMA_REDACTOR = `${SISTEMA_EDITOR}
Reglas de redacción:
- Español rioplatense con voseo ("tenés", "conviene que revises"), claro y sin sensacionalismo.
- Escribí con tus propias palabras: no copies oraciones de las fuentes. Como mucho una cita textual breve (menos de 15 palabras) si es imprescindible.
- Usá solo datos que estén en las fuentes o que confirmes con la búsqueda. Nunca inventes cifras, fechas, precios ni nombres. Si algo no está confirmado, decilo o no lo pongas.
- Fechas completas (día, mes y año). Precios con moneda y aclarando que son de referencia.
- Pensá siempre: ¿qué cambia para alguien que sale desde Uruguay?
- Tono positivo y tranquilizador: contá las novedades como oportunidades o datos útiles. Nada de alarmismo.
- Si la historia trata de alguno de estos temas, devolvé {"es_relevante": false}: ${(cfg.evitar?.temas || []).join('; ')}.
${(cfg.recomendaciones?.lista || []).map((r) => `- Si la nota trata de ${r.tema}, mencioná una sola vez y de forma natural a [${r.marca}](${r.url}), ${r.texto}.`).join('\n')}`;

function promptRedaccion(grupo, textos) {
  const fuentesTxt = grupo
    .map((c, i) => `FUENTE ${i + 1}: ${c.medio || 'medio'} (${c.fecha?.slice(0, 10) || 's/f'})\nTítulo: ${c.titulo}\nResumen: ${c.resumen || '-'}\n${textos[i] ? 'Texto:\n' + textos[i] : ''}`)
    .join('\n\n');
  return `Fecha de hoy: ${new Date().toISOString().slice(0, 10)}.
Escribí una nota para el sitio sobre esta historia. ${buscarActivo ? 'Buscá en Google para confirmar y completar los datos clave (fechas, frecuencias, precios, requisitos oficiales).' : ''}

${fuentesTxt}

Respondé SOLO con un objeto JSON válido, sin texto antes ni después, con esta forma:
{
  "es_relevante": true,
  "titulo": "título informativo de máximo 95 caracteres, con el nombre del destino, aerolínea o trámite",
  "bajada": "resumen de 120 a 160 caracteres para buscadores",
  "categoria": "una de: ${CATEGORIAS.join(', ')}",
  "etiquetas": ["3 a 6 etiquetas cortas: países, ciudades, aerolíneas, temas"],
  "destino": "ciudad o país principal",
  "puntosClave": ["3 o 4 oraciones completas y autosuficientes con los datos más importantes"],
  "cuerpo": "nota de 250 a 450 palabras en markdown simple (párrafos, **negritas**, listas con '- ' y subtítulos '## '). Debe terminar con la sección '## Qué significa para vos' con consejos prácticos para el viajero uruguayo.",
  "faq": [{"pregunta": "pregunta como la buscaría la gente en Google o en un asistente de IA", "respuesta": "respuesta directa de 1 o 2 oraciones"}],
  "imagen_clave": "una clave de esta lista si encaja bien, o vacío: ${clavesImagen}",
  "imagen_busqueda": "si ninguna clave encaja, 2 a 4 palabras EN INGLÉS para buscar una foto libre del lugar (ej: 'Cancun beach', 'Lisbon tram'); si no, vacío"
}
Incluí 2 o 3 preguntas en "faq". Si al investigar ves que la historia no es útil o no se puede confirmar, devolvé {"es_relevante": false}.`;
}

const nuevas = [];
for (const s of elegidas) {
  const grupo = s.ids.map((id) => candidatos.find((c) => c.id === id)).filter(Boolean).slice(0, 4);
  if (!grupo.length) continue;
  if (Date.now() - INICIO > LIMITE_MS) {
    log(`Se alcanzó el tiempo máximo (${cfg.minutosMaximos || 15} min). Lo que falta queda para la próxima corrida.`);
    break;
  }
  log(`Redactando: ${s.tema} (${s.puntaje}/10)`);
  try {
    const textos = await Promise.all(grupo.map((c) => textoDelArticulo(c.link)));
    let r;
    if (buscarActivo) {
      try {
        r = await gemini({ prompt: promptRedaccion(grupo, textos), sistema: SISTEMA_REDACTOR, buscar: true, temperatura: 0.5, modelos: MODELOS });
      } catch (err) {
        if (!err.cupo) throw err;
        buscarActivo = false; // no se vuelve a intentar en esta corrida
        log(`  ${err.message}: sigo sin búsqueda, solo con el texto de los medios`);
      }
    }
    if (!r) r = await gemini({ prompt: promptRedaccion(grupo, textos), sistema: SISTEMA_REDACTOR, temperatura: 0.5, modelos: MODELOS });
    const n = r.json;
    if (!n || n.es_relevante === false || !n.titulo || !n.cuerpo) {
      log(n ? '  descartada por el redactor' : '  la respuesta no era un JSON válido');
      if (n) for (const c of grupo) procesadas.links.push(c.link);
      else marcarFallida(grupo);
      continue;
    }
    if ([...noticias, ...nuevas].some((x) => titleSimilarity(x.titulo, n.titulo) > 0.6)) {
      log('  descartada: ya existe una nota parecida');
      for (const c of grupo) procesadas.links.push(c.link);
      continue;
    }

    // Imagen: de la biblioteca o una foto libre nueva de Wikimedia Commons
    let imagen = null;
    if (n.imagen_clave && imagenes.lista.some((i) => i.clave === n.imagen_clave)) {
      imagen = { clave: n.imagen_clave };
    } else if (n.imagen_busqueda) {
      const foto = await buscarFotoLibre(n.imagen_busqueda);
      if (foto) {
        const clave = slugify(n.imagen_busqueda);
        if (!imagenes.lista.some((i) => i.clave === clave)) {
          imagenes.lista.push({ clave, descripcion: n.imagen_busqueda, alt: foto.alt, archivo: foto.archivo, autor: foto.autor, licencia: foto.licencia, temas: [n.destino || ''].filter(Boolean), auto: true });
        }
        imagen = { clave };
      }
    }
    if (!imagen) imagen = { clave: imagenes.porCategoria[n.categoria] || 'carrasco' };

    const ahora = new Date();
    let slug = slugify(n.titulo);
    if ([...noticias, ...nuevas].some((x) => x.slug === slug)) slug = `${slug}-${ahora.toISOString().slice(0, 10)}`;

    nuevas.push({
      id: `${ahora.toISOString().slice(0, 10)}-${slug.slice(0, 40)}`,
      slug,
      titulo: n.titulo.trim().slice(0, 140),
      bajada: (n.bajada || '').trim().slice(0, 200),
      categoria: CATEGORIAS.includes(n.categoria) ? n.categoria : 'destinos',
      etiquetas: (n.etiquetas || []).slice(0, 6),
      destino: n.destino || '',
      fecha: ahora.toISOString(),
      puntosClave: (n.puntosClave || []).slice(0, 5),
      cuerpo: n.cuerpo,
      faq: (n.faq || []).filter((f) => f?.pregunta && f?.respuesta).slice(0, 4),
      imagen,
      fuentes: grupo.map((c) => ({ nombre: c.medio || 'Fuente', url: c.link })),
      origen: 'ia',
      modelo: r.modelo,
    });
    procesadas.titulos.push(n.titulo);
    for (const c of grupo) {
      procesadas.links.push(c.link);
      delete procesadas.fallidas[c.link];
    }
    await guardar(); // se guarda nota por nota: si algo corta la corrida, lo publicado no se pierde
    log(`  ✓ ${n.titulo}`);
  } catch (err) {
    marcarFallida(grupo);
    log(`  ✗ no se pudo redactar: ${err.message}. Se reintenta en la próxima corrida.`);
    if (err.cupo && !err.conBusqueda) {
      log('  El cupo de Gemini está agotado: corto acá para no gastar más tiempo.');
      break;
    }
  }
}

// ---------- 5. Guardar ----------
for (const [link, n] of Object.entries(procesadas.fallidas)) if (n >= 3) delete procesadas.fallidas[link];
const total = await guardar();
log(`Listo: ${nuevas.length} noticias nuevas publicadas en ${Math.round((Date.now() - INICIO) / 60000)} min. Total: ${total}.`)
