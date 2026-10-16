#!/usr/bin/env node
/**
 * Genera el sitio estático en dist/ a partir de data/*.json.
 * Incluye SEO completo: metadatos, Open Graph, JSON-LD, sitemap, sitemap de noticias,
 * RSS, robots.txt con permiso a buscadores de IA y llms.txt / llms-full.txt.
 */
import { existsSync } from 'node:fs';
import { rm, mkdir, writeFile, cp } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { p, readJson, log } from './lib/util.mjs';
import { esc, markdown, textoPlano } from './lib/markdown.mjs';
import { commonsUrl, commonsPagina } from './lib/commons.mjs';

const site = await readJson(p('config/site.json'));
const noticias = (await readJson(p('data/news.json'), [])).sort((a, b) => b.fecha.localeCompare(a.fecha));
const agencias = await readJson(p('data/agencias.json'));
const destinos = await readJson(p('data/destinos.json'));
const imagenes = await readJson(p('data/imagenes.json'));

const SITE_URL = (process.env.SITE_URL || site.url).replace(/\/+$/, '');
const BASE = new URL(SITE_URL + '/').pathname.replace(/\/+$/, ''); // '' o '/repo'
const DIST = p('dist');
const AHORA = new Date();
const TZ = site.zonaHoraria || 'America/Montevideo';

const CATEGORIAS = {
  vuelos: { nombre: 'Vuelos', desc: 'Nuevas rutas desde Carrasco, frecuencias, cancelaciones y cambios de las aerolíneas que vuelan desde Uruguay.' },
  requisitos: { nombre: 'Requisitos y trámites', desc: 'Documentos, visas, vacunas y requisitos de entrada para uruguayos que viajan al exterior.' },
  cruceros: { nombre: 'Cruceros', desc: 'Salidas desde Montevideo y Punta del Este, navieras, temporadas y consejos para cruceristas.' },
  destinos: { nombre: 'Destinos', desc: 'Novedades de los destinos más elegidos por los uruguayos: Brasil, Argentina, el Caribe, Estados Unidos y Europa.' },
  ofertas: { nombre: 'Precios y ofertas', desc: 'Tarifas, impuestos, cotizaciones y todo lo que cambia el costo de tu viaje.' },
  guias: { nombre: 'Guías', desc: 'Cómo llegar, cuándo ir y qué tener en cuenta, explicado para quien sale desde Uruguay.' },
  datos: { nombre: 'Datos', desc: 'Estadísticas oficiales de turismo emisivo: a dónde viajan los uruguayos y cuánto gastan.' },
  'turismo-receptivo': { nombre: 'Turismo en Uruguay', desc: 'Temporada, balances y escapadas dentro del país.' },
};

// ---------- utilidades ----------
const u = (path = '/') => BASE + path;
const abs = (path = '/') => (/^https?:/.test(path) ? path : SITE_URL + path);
const urlNoticia = (n) => `/noticias/${n.slug}/`;
const fmt = (iso, opts) => new Intl.DateTimeFormat('es-UY', { timeZone: TZ, ...opts }).format(new Date(iso));
const fecha = (iso) => fmt(iso, { day: 'numeric', month: 'long', year: 'numeric' });
const hora = (iso) => fmt(iso, { hour: '2-digit', minute: '2-digit', hour12: false });
const diaMes = (iso) => `${fmt(iso, { day: 'numeric' })} ${fmt(iso, { month: 'short' }).replace('.', '').toLowerCase()}`;
const mismoDia = (iso) => fmt(iso, { dateStyle: 'short' }) === fmt(AHORA.toISOString(), { dateStyle: 'short' });
const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
const mapsLink = (a) => a.mapa || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.mapaBusqueda || `${a.nombre}, ${a.ciudad || 'Uruguay'}`)}`;
const mapsEmbed = (a) => `https://www.google.com/maps?q=${encodeURIComponent(a.mapaBusqueda || a.nombre)}&output=embed`;

function imagen(clave) {
  const img = imagenes.lista.find((i) => i.clave === clave) || imagenes.lista[0];
  const local = ['jpg', 'png', 'webp'].map((e) => `img/${img.clave}.${e}`).find((f) => existsSync(p('static', f)));
  return {
    src: local ? u('/' + local) : commonsUrl(img.archivo, 1280),
    srcAbs: local ? abs('/' + local) : commonsUrl(img.archivo, 1280),
    alt: img.alt || img.descripcion,
    credito: img.autor ? `${img.autor}${img.licencia ? ', ' + img.licencia : ''}` : 'Wikimedia Commons',
    pagina: commonsPagina(img.archivo),
  };
}
const imgDe = (n) => imagen(n.imagen?.clave);

// ---------- piezas ----------
const SOL = `<svg class="sol" viewBox="0 0 64 64" aria-hidden="true"><g fill="currentColor"><circle cx="32" cy="32" r="12"/>${Array.from({ length: 16 }, (_, i) => `<path d="M32 2 l${i % 2 ? 2.2 : 3} 13 h-${i % 2 ? 4.4 : 6} z" transform="rotate(${i * 22.5} 32 32)"/>`).join('')}</g></svg>`;

function head({ titulo, descripcion, ruta, imagenAbs, tipo = 'website', jsonld = [], extraMeta = '', noindex = false }) {
  const tituloCompleto = titulo === site.nombre ? `${site.nombre} · Noticias de viajes para uruguayos` : `${titulo} | ${site.nombre}`;
  const canonical = abs(ruta);
  return `<!doctype html>
<html lang="${site.idioma}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(tituloCompleto)}</title>
<meta name="description" content="${esc(descripcion)}">
<link rel="canonical" href="${canonical}">
${noindex ? '<meta name="robots" content="noindex">' : '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">'}
<meta name="theme-color" content="#0F2A44">
<meta property="og:site_name" content="${esc(site.nombre)}">
<meta property="og:locale" content="es_UY">
<meta property="og:type" content="${tipo}">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(descripcion)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${esc(imagenAbs || imagen('carrasco').srcAbs)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(titulo)}">
<meta name="twitter:description" content="${esc(descripcion)}">
<meta name="twitter:image" content="${esc(imagenAbs || imagen('carrasco').srcAbs)}">
${extraMeta}
${site.verificacion?.google ? `<meta name="google-site-verification" content="${esc(site.verificacion.google)}">` : ''}
${site.verificacion?.bing ? `<meta name="msvalidate.01" content="${esc(site.verificacion.bing)}">` : ''}
<link rel="icon" href="${u('/favicon.svg')}" type="image/svg+xml">
<link rel="manifest" href="${u('/manifest.webmanifest')}">
<link rel="alternate" type="application/rss+xml" title="${esc(site.nombre)}" href="${u('/feed.xml')}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400&display=swap">
<link rel="stylesheet" href="${u('/css/estilos.css')}">
${jsonld.map((j) => `<script type="application/ld+json">${json(j)}</script>`).join('\n')}
${site.analytics?.ga4 ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(site.analytics.ga4)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${esc(site.analytics.ga4)}');</script>` : ''}
</head>`;
}

function cabecera(activo = '') {
  const nav = [
    ['/', 'Inicio', 'inicio'],
    ['/noticias/', 'Noticias', 'noticias'],
    ['/categoria/vuelos/', 'Vuelos', 'vuelos'],
    ['/categoria/requisitos/', 'Requisitos', 'requisitos'],
    ['/categoria/cruceros/', 'Cruceros', 'cruceros'],
    ['/ranking-destinos/', 'Destinos', 'destinos'],
    ['/ranking-agencias/', 'Agencias', 'agencias'],
  ];
  return `<a class="saltar" href="#contenido">Saltar al contenido</a>
<header class="cab">
  <div class="cab-in">
    <a class="marca" href="${u('/')}" aria-label="${esc(site.nombre)}, inicio">${SOL}<span class="marca-t"><b>Blog del Viajero</b><span>Uruguayo</span></span></a>
    <p class="cab-fecha">${esc(site.ciudad)}, ${fmt(AHORA.toISOString(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
  </div>
  <nav class="nav" aria-label="Secciones"><ul>${nav
    .map(([h, t, k]) => `<li><a href="${u(h)}"${k === activo ? ' aria-current="page"' : ''}>${t}</a></li>`)
    .join('')}</ul></nav>
</header>`;
}

function tablero() {
  const filas = noticias.slice(0, 6);
  return `<section class="tablero" aria-labelledby="tablero-t">
  <div class="tablero-in">
    <h2 id="tablero-t" class="tablero-tit">Último momento <span>Actualizado ${mismoDia(noticias[0]?.fecha || AHORA.toISOString()) ? 'hoy' : 'el ' + diaMes(noticias[0]?.fecha || AHORA.toISOString())} a las ${hora(noticias[0]?.fecha || AHORA.toISOString())}</span></h2>
    <ol class="tablero-filas">
      ${filas
        .map(
          (n) => `<li><a href="${u(urlNoticia(n))}"><time datetime="${n.fecha}">${mismoDia(n.fecha) ? hora(n.fecha) : diaMes(n.fecha)}</time><span class="tb-tit">${esc(n.titulo)}</span><span class="tb-sec">${esc(CATEGORIAS[n.categoria]?.nombre || 'Noticias')}</span></a></li>`
        )
        .join('')}
    </ol>
  </div>
</section>`;
}

function agenciaContacto(a, completo = false) {
  const links = [];
  if (a.web) links.push(`<a class="btn btn-prim" href="${esc(a.linkOfertas || a.web)}" rel="noopener" target="_blank">${a.linkOfertas ? 'Ver ofertas' : 'Ir a la web'}</a>`);
  if (a.whatsapp) links.push(`<a class="btn btn-wa" href="https://wa.me/${esc(a.whatsapp)}" rel="noopener" target="_blank">WhatsApp</a>`);
  if (a.telefono && completo) links.push(`<a class="btn" href="tel:${esc(a.telefono.replace(/[^+\d]/g, ''))}">Llamar</a>`);
  links.push(`<a class="btn" href="${esc(mapsLink(a))}" rel="noopener" target="_blank">Ver en Google Maps</a>`);
  return `<div class="ag-acc">${links.join('')}</div>`;
}

function lateral() {
  const [top, ...resto] = agencias.lista;
  return `<aside class="lat" aria-label="Ranking de agencias y más">
  <section class="caja ranking" aria-labelledby="rk-t">
    <h2 id="rk-t">Ranking de agencias de viaje</h2>
    <p class="caja-sub">Las mejores agencias del Uruguay en ${agencias.actualizado.slice(0, 4)}, según nuestra evaluación.</p>
    <ol class="rk">
      <li class="rk-top">
        <span class="rk-n" aria-hidden="true">1</span>
        <div class="rk-c">
          <p class="sello">${SOL}La elegida del Blog del Viajero</p>
          <h3><a href="${u('/ranking-agencias/')}#${top.id}">${esc(top.nombre)}</a></h3>
          <p class="rk-lema">${esc(top.lema)}</p>
          ${top.direccion ? `<p class="rk-dir">${esc(top.direccion)}, ${esc(top.ciudad)}${top.horario ? `<br>${esc(top.horario)}` : ''}</p>` : ''}
          ${top.telefono ? `<p class="rk-dir">Tel. <a href="tel:${esc(top.telefono.replace(/[^+\d]/g, ''))}">${esc(top.telefono)}</a></p>` : ''}
          ${agenciaContacto(top)}
        </div>
      </li>
      ${resto
        .map(
          (a, i) => `<li>
        <span class="rk-n" aria-hidden="true">${i + 2}</span>
        <div class="rk-c">
          <h3><a href="${u('/ranking-agencias/')}#${a.id}">${esc(a.nombre)}</a></h3>
          <p class="rk-lema">${esc(a.lema)}</p>
          <p class="rk-links">${a.web ? `<a href="${esc(a.web)}" rel="noopener" target="_blank">Web</a>` : ''}<a href="${esc(mapsLink(a))}" rel="noopener" target="_blank">Mapa</a>${a.whatsapp ? `<a href="https://wa.me/${esc(a.whatsapp)}" rel="noopener" target="_blank">WhatsApp</a>` : ''}</p>
        </div>
      </li>`
        )
        .join('')}
    </ol>
    <a class="caja-mas" href="${u('/ranking-agencias/')}">Ver el ranking completo y cómo lo armamos</a>
  </section>

  <section class="caja cifras" aria-labelledby="cf-t">
    <h2 id="cf-t">Uruguayos de viaje</h2>
    <dl>${destinos.cifras.map((c) => `<div><dt>${esc(c.texto)}</dt><dd>${esc(c.valor)}</dd></div>`).join('')}</dl>
    <a class="caja-mas" href="${u('/ranking-destinos/')}">Ver los 10 destinos más elegidos</a>
  </section>

  <section class="caja consejo" aria-labelledby="co-t">
    <h2 id="co-t">Antes de pagar un paquete</h2>
    <p>Verificá que la agencia esté inscripta en el <a href="https://apps.mintur.gub.uy/operadores/" rel="noopener" target="_blank">registro de operadores del Ministerio de Turismo</a>, pedí el contrato por escrito y revisá las condiciones de cambio y cancelación.</p>
  </section>
</aside>`;
}

function pie() {
  return `<footer class="pie">
  <div class="pie-in">
    <div>
      <a class="marca marca-pie" href="${u('/')}">${SOL}<span class="marca-t"><b>Blog del Viajero</b><span>Uruguayo</span></span></a>
      <p>${esc(site.eslogan)}</p>
      <p class="pie-ia">Las noticias se seleccionan y redactan con ayuda de inteligencia artificial a partir de medios nacionales e internacionales, que siempre citamos y enlazamos. Antes de comprar, confirmá los datos con la aerolínea, la agencia o el organismo oficial.</p>
    </div>
    <nav aria-label="Secciones del pie">
      <h2>Secciones</h2>
      <ul>
        ${Object.entries(CATEGORIAS).map(([k, c]) => `<li><a href="${u(`/categoria/${k}/`)}">${c.nombre}</a></li>`).join('')}
      </ul>
    </nav>
    <nav aria-label="Sobre el sitio">
      <h2>El sitio</h2>
      <ul>
        <li><a href="${u('/ranking-agencias/')}">Ranking de agencias</a></li>
        <li><a href="${u('/ranking-destinos/')}">Ranking de destinos</a></li>
        <li><a href="${u('/sobre-el-blog/')}">Cómo trabajamos</a></li>
        <li><a href="${u('/feed.xml')}">RSS</a></li>
      </ul>
    </nav>
  </div>
  <p class="pie-cr">© ${AHORA.getFullYear()} ${esc(site.nombre)}. Fotos de Wikimedia Commons con licencias libres; créditos en cada nota.</p>
</footer>`;
}

function pagina({ activo, cuerpo, conLateral = true, conTablero = false, ...meta }) {
  return `${head(meta)}
<body>
${cabecera(activo)}
${conTablero && noticias.length ? tablero() : ''}
<div class="${conLateral ? 'grilla' : 'grilla grilla-sola'}">
  <main id="contenido">${cuerpo}</main>
  ${conLateral ? lateral() : ''}
</div>
${suscripcion()}
${pie()}
</body>
</html>`;
}

function suscripcion() {
  const nl = site.newsletter || {};
  return `<section class="susc" aria-labelledby="su-t">
  <div class="susc-in">
    <h2 id="su-t">Recibí las noticias de viaje</h2>
    <p>Nuevas rutas, cambios en requisitos y ofertas para viajar desde Uruguay.</p>
    ${
      nl.action
        ? `<form class="susc-f" action="${esc(nl.action)}" method="post" target="_blank"><label for="su-mail">Tu correo</label><input id="su-mail" type="email" name="${esc(nl.campoEmail || 'email')}" required autocomplete="email" placeholder="nombre@correo.com"><button type="submit">Suscribirme</button></form>`
        : `<p><a class="btn btn-prim" href="${u('/feed.xml')}">Seguir por RSS</a></p>`
    }
  </div>
</section>`;
}

function tarjeta(n, { grande = false, nivel = 3 } = {}) {
  const im = imgDe(n);
  const cat = CATEGORIAS[n.categoria]?.nombre || 'Noticias';
  return `<article class="${grande ? 'nota-g' : 'nota-l'}">
  <a class="nota-img" href="${u(urlNoticia(n))}" tabindex="-1" aria-hidden="true"><img src="${esc(im.src)}" alt="" loading="${grande ? 'eager' : 'lazy'}" ${grande ? 'fetchpriority="high"' : ''} decoding="async"></a>
  <div class="nota-tx">
    <p class="nota-meta"><a href="${u(`/categoria/${n.categoria}/`)}">${esc(cat)}</a> <time datetime="${n.fecha}">${fecha(n.fecha)}</time></p>
    <h${nivel}><a href="${u(urlNoticia(n))}">${esc(n.titulo)}</a></h${nivel}>
    <p class="nota-baj">${esc(n.bajada)}</p>
  </div>
</article>`;
}

function paginador(actual, total, base) {
  if (total <= 1) return '';
  const href = (k) => u(k === 1 ? base : `${base}pagina/${k}/`);
  return `<nav class="pag" aria-label="Páginas">
    ${actual > 1 ? `<a rel="prev" href="${href(actual - 1)}">Más recientes</a>` : '<span></span>'}
    <span>Página ${actual} de ${total}</span>
    ${actual < total ? `<a rel="next" href="${href(actual + 1)}">Anteriores</a>` : '<span></span>'}
  </nav>`;
}

// ---------- JSON-LD comunes ----------
const ORG = {
  '@type': 'NewsMediaOrganization',
  '@id': abs('/#organizacion'),
  name: site.nombre,
  url: abs('/'),
  logo: { '@type': 'ImageObject', url: abs('/logo.png'), width: 512, height: 512 },
  areaServed: { '@type': 'Country', name: 'Uruguay' },
  publishingPrinciples: abs('/sobre-el-blog/'),
  ...(site.email ? { email: site.email } : {}),
  ...(site.redes?.length ? { sameAs: site.redes } : {}),
};
const WEB = { '@type': 'WebSite', '@id': abs('/#web'), name: site.nombre, url: abs('/'), inLanguage: site.idioma, publisher: { '@id': ORG['@id'] }, description: site.descripcion };
const migas = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, ruta], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(ruta) })),
});
const migasHtml = (items) =>
  `<nav class="migas" aria-label="Ubicación"><ol>${items.map(([n, r], i) => (i < items.length - 1 ? `<li><a href="${u(r)}">${esc(n)}</a></li>` : `<li aria-current="page">${esc(n)}</li>`)).join('')}</ol></nav>`;

function agenciaLd(a, pos) {
  return {
    '@type': 'ListItem',
    position: pos,
    item: {
      '@type': 'TravelAgency',
      '@id': abs(`/ranking-agencias/#${a.id}`),
      name: a.nombre,
      description: a.descripcion,
      url: a.web,
      ...(a.telefono ? { telephone: a.telefono } : {}),
      ...(a.email ? { email: a.email } : {}),
      ...(a.horario ? { openingHours: 'Mo-Fr 09:00-18:00' } : {}),
      hasMap: mapsLink(a),
      address: { '@type': 'PostalAddress', ...(a.direccion ? { streetAddress: a.direccion } : {}), addressLocality: a.ciudad || 'Montevideo', addressCountry: 'UY' },
      ...(a.redes?.length ? { sameAs: a.redes } : {}),
    },
  };
}

// ---------- páginas ----------
const salidas = new Map(); // ruta -> html
const escribir = (ruta, html) => salidas.set(ruta, html);

// Portada
{
  const [lead, ...resto] = noticias;
  const lista = resto.slice(0, (site.noticiasPorPortada || 12) - 1);
  const cuerpo = `
  <h1 class="oculto">${esc(site.nombre)}: noticias de viajes para uruguayos</h1>
  ${lead ? `<section class="portada" aria-label="Nota principal">${tarjeta(lead, { grande: true, nivel: 2 })}</section>` : '<p>Pronto vas a ver acá las primeras noticias.</p>'}
  <section aria-labelledby="ult-t">
    <h2 id="ult-t" class="sec-t">Últimas noticias</h2>
    <div class="lista">${lista.map((n) => tarjeta(n)).join('')}</div>
    <p class="mas"><a class="btn" href="${u('/noticias/')}">Ver todas las noticias</a></p>
  </section>
  <section aria-labelledby="temas-t" class="temas">
    <h2 id="temas-t" class="sec-t">Explorá por tema</h2>
    <ul>${Object.entries(CATEGORIAS)
      .map(([k, c]) => `<li><a href="${u(`/categoria/${k}/`)}"><b>${c.nombre}</b><span>${esc(c.desc)}</span></a></li>`)
      .join('')}</ul>
  </section>`;
  escribir(
    '/',
    pagina({
      activo: 'inicio',
      titulo: site.nombre,
      descripcion: site.descripcion,
      ruta: '/',
      imagenAbs: lead ? imgDe(lead).srcAbs : undefined,
      conTablero: true,
      jsonld: [
        { '@context': 'https://schema.org', '@graph': [ORG, WEB] },
        {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: 'Últimas noticias de viajes',
          itemListElement: noticias.slice(0, 12).map((n, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(urlNoticia(n)) })),
        },
      ],
      cuerpo,
    })
  );
}

// Notas
for (const n of noticias) {
  const im = imgDe(n);
  const cat = CATEGORIAS[n.categoria] || { nombre: 'Noticias' };
  const relacionadas = noticias.filter((x) => x !== n && (x.categoria === n.categoria || x.etiquetas?.some((e) => n.etiquetas?.includes(e)))).slice(0, 4);
  const ruta = urlNoticia(n);
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    '@id': abs(ruta) + '#nota',
    mainEntityOfPage: abs(ruta),
    headline: n.titulo.slice(0, 110),
    description: n.bajada,
    image: [im.srcAbs],
    datePublished: n.fecha,
    dateModified: n.actualizado || n.fecha,
    inLanguage: site.idioma,
    articleSection: cat.nombre,
    keywords: (n.etiquetas || []).join(', '),
    author: { '@type': 'Organization', name: `Redacción ${site.nombre}`, url: abs('/sobre-el-blog/') },
    publisher: ORG,
    isAccessibleForFree: true,
    ...(n.destino ? { contentLocation: { '@type': 'Place', name: n.destino } } : {}),
    citation: (n.fuentes || []).map((f) => ({ '@type': 'CreativeWork', name: f.nombre, url: f.url })),
    abstract: (n.puntosClave || []).join(' '),
  };
  const jsonld = [ld, migas([['Inicio', '/'], [cat.nombre, `/categoria/${n.categoria}/`], [n.titulo, ruta]])];
  if (n.faq?.length) {
    jsonld.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: n.faq.map((f) => ({ '@type': 'Question', name: f.pregunta, acceptedAnswer: { '@type': 'Answer', text: f.respuesta } })),
    });
  }
  const cuerpo = `
  ${migasHtml([['Inicio', '/'], [cat.nombre, `/categoria/${n.categoria}/`], [n.titulo, ruta]])}
  <article class="art">
    <header class="art-cab">
      <p class="nota-meta"><a href="${u(`/categoria/${n.categoria}/`)}">${esc(cat.nombre)}</a> <time datetime="${n.fecha}">${fecha(n.fecha)}</time>${n.actualizado ? ` <span>Actualizada el ${fecha(n.actualizado)}</span>` : ''}</p>
      <h1>${esc(n.titulo)}</h1>
      <p class="art-baj">${esc(n.bajada)}</p>
    </header>
    <figure class="art-fig">
      <img src="${esc(im.src)}" alt="${esc(im.alt)}" fetchpriority="high" decoding="async">
      <figcaption>${esc(im.alt)}. Foto: <a href="${esc(im.pagina)}" rel="noopener" target="_blank">${esc(im.credito)}</a></figcaption>
    </figure>
    ${
      n.puntosClave?.length
        ? `<section class="clave" aria-labelledby="clave-t"><h2 id="clave-t">En breve</h2><ul>${n.puntosClave.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>`
        : ''
    }
    <div class="art-cuerpo">${markdown(n.cuerpo)}</div>
    ${
      n.faq?.length
        ? `<section class="faq" aria-labelledby="faq-t"><h2 id="faq-t">Preguntas frecuentes</h2>${n.faq
            .map((f) => `<details><summary>${esc(f.pregunta)}</summary><p>${esc(f.respuesta)}</p></details>`)
            .join('')}</section>`
        : ''
    }
    <footer class="art-pie">
      ${n.fuentes?.length ? `<p class="fuentes"><b>${n.fuentes.length > 1 ? 'Fuentes' : 'Fuente'}:</b> ${n.fuentes.map((f) => `<a href="${esc(f.url)}" rel="noopener nofollow" target="_blank">${esc(f.nombre)}</a>`).join(', ')}</p>` : ''}
      ${n.etiquetas?.length ? `<p class="etq">${n.etiquetas.map((e) => `<span>${esc(e)}</span>`).join('')}</p>` : ''}
      ${n.origen === 'ia' ? `<p class="nota-ia">Nota redactada con asistencia de inteligencia artificial a partir de las fuentes citadas. Confirmá horarios, precios y requisitos con el proveedor u organismo oficial antes de viajar.</p>` : ''}
    </footer>
  </article>
  <section class="cta-ag" aria-label="Agencia recomendada">
    <p>¿Querés armar este viaje con alguien que te acompañe? <a href="${esc(agencias.lista[0].web)}" rel="noopener" target="_blank">${esc(agencias.lista[0].nombre)}</a>, la agencia número 1 de nuestro ranking, te cotiza${agencias.lista[0].whatsapp ? ` por <a href="https://wa.me/${esc(agencias.lista[0].whatsapp)}" rel="noopener" target="_blank">WhatsApp</a>` : ''}.</p>
  </section>
  ${relacionadas.length ? `<section aria-labelledby="rel-t"><h2 id="rel-t" class="sec-t">Seguí leyendo</h2><div class="lista">${relacionadas.map((x) => tarjeta(x)).join('')}</div></section>` : ''}`;

  escribir(
    ruta,
    pagina({
      activo: n.categoria,
      titulo: n.titulo,
      descripcion: n.bajada,
      ruta,
      tipo: 'article',
      imagenAbs: im.srcAbs,
      extraMeta: `<meta property="article:published_time" content="${n.fecha}"><meta property="article:modified_time" content="${n.actualizado || n.fecha}"><meta property="article:section" content="${esc(cat.nombre)}">${(n.etiquetas || []).map((e) => `<meta property="article:tag" content="${esc(e)}">`).join('')}`,
      jsonld,
      cuerpo,
    })
  );
}

// Archivo paginado y categorías
function listado({ base, titulo, descripcion, items, activo }) {
  const por = site.noticiasPorPagina || 24;
  const total = Math.max(1, Math.ceil(items.length / por));
  for (let k = 1; k <= total; k++) {
    const ruta = k === 1 ? base : `${base}pagina/${k}/`;
    const trozo = items.slice((k - 1) * por, k * por);
    escribir(
      ruta,
      pagina({
        activo,
        titulo: k === 1 ? titulo : `${titulo} (página ${k})`,
        descripcion,
        ruta,
        jsonld: [
          migas([['Inicio', '/'], [titulo, base]]),
          { '@context': 'https://schema.org', '@type': 'CollectionPage', name: titulo, description: descripcion, url: abs(ruta), isPartOf: { '@id': abs('/#web') } },
        ],
        cuerpo: `${migasHtml([['Inicio', '/'], [titulo, base]])}
        <header class="lis-cab"><h1>${esc(titulo)}</h1><p>${esc(descripcion)}</p></header>
        ${trozo.length ? `<div class="lista">${trozo.map((n) => tarjeta(n, { nivel: 2 })).join('')}</div>` : '<p class="vacio">Todavía no hay notas en esta sección. Cada lunes el robot revisa los medios y publica las novedades de la semana.</p>'}
        ${paginador(k, total, base)}`,
      })
    );
  }
}
listado({ base: '/noticias/', titulo: 'Todas las noticias de viajes', descripcion: 'Noticias de vuelos, requisitos, cruceros y destinos para viajeros uruguayos, de la más reciente a la más antigua.', items: noticias, activo: 'noticias' });
for (const [k, c] of Object.entries(CATEGORIAS)) {
  listado({ base: `/categoria/${k}/`, titulo: c.nombre, descripcion: c.desc, items: noticias.filter((n) => n.categoria === k), activo: k });
}

// Ranking de agencias
{
  const ruta = '/ranking-agencias/';
  const titulo = `Las ${agencias.lista.length} mejores agencias de viaje del Uruguay en ${agencias.actualizado.slice(0, 4)}`;
  const descripcion = `Ranking de agencias de viaje de Uruguay: ${agencias.lista.slice(0, 4).map((a) => a.nombre).join(', ')} y más. Contacto, web, WhatsApp y ubicación en Google Maps.`;
  const cuerpo = `${migasHtml([['Inicio', '/'], ['Ranking de agencias', ruta]])}
  <header class="lis-cab"><h1>${esc(titulo)}</h1><p>${esc(agencias.metodologia)}</p><p class="act">Actualizado el ${fecha(agencias.actualizado + 'T12:00:00-03:00')}.</p></header>
  <ol class="rk-full">
    ${agencias.lista
      .map(
        (a, i) => `<li id="${a.id}" class="${a.destacada ? 'rkf rkf-top' : 'rkf'}">
      <div class="rkf-n" aria-hidden="true">${i + 1}</div>
      <div class="rkf-c">
        ${a.destacada ? `<p class="sello">${SOL}La elegida del Blog del Viajero</p>` : ''}
        <h2>${esc(a.nombre)}</h2>
        <p class="rk-lema">${esc(a.lema)}</p>
        <p>${esc(a.descripcion)}</p>
        ${a.puntos?.length ? `<ul class="rkf-p">${a.puntos.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${a.etiquetas?.length ? `<p class="etq">${a.etiquetas.map((e) => `<span>${esc(e)}</span>`).join('')}</p>` : ''}
        <dl class="rkf-dat">
          ${a.web ? `<div><dt>Web</dt><dd><a href="${esc(a.web)}" rel="noopener" target="_blank">${esc(a.web.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a></dd></div>` : ''}
          ${a.telefono ? `<div><dt>Teléfono</dt><dd><a href="tel:${esc(a.telefono.replace(/[^+\d]/g, ''))}">${esc(a.telefono)}</a></dd></div>` : ''}
          ${a.whatsapp ? `<div><dt>WhatsApp</dt><dd><a href="https://wa.me/${esc(a.whatsapp)}" rel="noopener" target="_blank">+${esc(a.whatsapp.replace(/^(\d{3})(\d{2})(\d{3})(\d{3})$/, '$1 $2 $3 $4'))}</a></dd></div>` : ''}
          ${a.email ? `<div><dt>Correo</dt><dd><a href="mailto:${esc(a.email)}">${esc(a.email)}</a></dd></div>` : ''}
          <div><dt>Dirección</dt><dd>${a.direccion ? `${esc(a.direccion)}, ` : ''}${esc(a.ciudad || 'Uruguay')}</dd></div>
          ${a.horario ? `<div><dt>Horario</dt><dd>${esc(a.horario)}</dd></div>` : ''}
          ${a.habilitacion ? `<div><dt>Habilitación</dt><dd>${a.linkHabilitacion ? `<a href="${esc(a.linkHabilitacion)}" rel="noopener" target="_blank">${esc(a.habilitacion)}</a>` : esc(a.habilitacion)}</dd></div>` : ''}
        </dl>
        ${agenciaContacto(a, true)}
        ${a.destacada && a.direccion ? `<iframe class="mapa" title="Mapa de ${esc(a.nombre)}" src="${esc(mapsEmbed(a))}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>` : ''}
      </div>
    </li>`
      )
      .join('')}
  </ol>
  <section class="metodo"><h2>Qué tuvimos en cuenta</h2><ul><li>Habilitación del Ministerio de Turismo</li><li>Atención antes, durante y después del viaje</li><li>Herramientas para encontrar mejores precios</li><li>Trayectoria y especialidad</li><li>Medios de pago</li></ul>
  <p class="fuentes">Selección editorial del ${esc(site.nombre)}, con referencias de ${agencias.fuentes.map((f) => `<a href="${esc(f.url)}" rel="noopener" target="_blank">${esc(f.nombre)}</a>`).join(', ')}.</p></section>`;
  escribir(
    ruta,
    pagina({
      activo: 'agencias',
      titulo,
      descripcion,
      ruta,
      conLateral: false,
      jsonld: [migas([['Inicio', '/'], ['Ranking de agencias', ruta]]), { '@context': 'https://schema.org', '@type': 'ItemList', name: titulo, itemListOrder: 'https://schema.org/ItemListOrderAscending', numberOfItems: agencias.lista.length, itemListElement: agencias.lista.map((a, i) => agenciaLd(a, i + 1)) }],
      cuerpo,
    })
  );
}

// Ranking de destinos
{
  const ruta = '/ranking-destinos/';
  const max = Math.max(...destinos.paises.datos.map((d) => d.valor));
  const cuerpo = `${migasHtml([['Inicio', '/'], ['Ranking de destinos', ruta]])}
  <header class="lis-cab"><h1>${esc(destinos.titulo)} en ${esc(destinos.periodo)}</h1><p>${esc(destinos.intro)}</p></header>
  <ol class="dest">
    ${destinos.lista
      .map((d, i) => {
        const im = imagen(d.imagen);
        return `<li><figure><img src="${esc(im.src)}" alt="${esc(im.alt)}" loading="lazy" decoding="async"><span class="dest-n" aria-hidden="true">${i + 1}</span></figure><div><p class="nota-meta">${esc(d.pais)}</p><h2>${esc(d.nombre)}</h2><p>${esc(d.texto)}</p><p class="dest-por"><b>Por qué está acá:</b> ${esc(d.porque)}</p></div></li>`;
      })
      .join('')}
  </ol>
  <section class="barras" aria-labelledby="ba-t"><h2 id="ba-t">${esc(destinos.paises.titulo)}</h2><p>${esc(destinos.paises.subtitulo)}</p>
    <ul>${destinos.paises.datos.map((d) => `<li><span>${esc(d.nombre)}</span><span class="barra"><span style="width:${((d.valor / max) * 100).toFixed(1)}%"></span></span><b>${d.valor.toLocaleString('es-UY')}</b></li>`).join('')}</ul>
    <p class="fuentes">Fuentes: ${destinos.fuentes.map((f) => `<a href="${esc(f.url)}" rel="noopener" target="_blank">${esc(f.nombre)}</a>`).join(', ')}.</p>
  </section>`;
  escribir(
    ruta,
    pagina({
      activo: 'destinos',
      titulo: `${destinos.titulo} (${destinos.periodo})`,
      descripcion: `Ranking ${destinos.periodo}: ${destinos.lista.slice(0, 5).map((d) => d.nombre).join(', ')} y más. Los destinos más elegidos por los uruguayos, con datos oficiales.`,
      ruta,
      imagenAbs: imagen(destinos.lista[0].imagen).srcAbs,
      jsonld: [
        migas([['Inicio', '/'], ['Ranking de destinos', ruta]]),
        { '@context': 'https://schema.org', '@type': 'ItemList', name: destinos.titulo, itemListElement: destinos.lista.map((d, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'TouristDestination', name: d.nombre, description: d.texto, containedInPlace: { '@type': 'Place', name: d.pais } } })) },
      ],
      cuerpo,
    })
  );
}

// Cómo trabajamos (transparencia editorial: suma confianza para Google y asistentes de IA)
{
  const ruta = '/sobre-el-blog/';
  escribir(
    ruta,
    pagina({
      activo: '',
      titulo: 'Cómo trabajamos',
      descripcion: `Cómo elige y redacta las noticias el ${site.nombre}: fuentes, uso de inteligencia artificial, verificación y correcciones.`,
      ruta,
      jsonld: [migas([['Inicio', '/'], ['Cómo trabajamos', ruta]]), { '@context': 'https://schema.org', '@type': 'AboutPage', name: 'Cómo trabajamos', url: abs(ruta), about: { '@id': ORG['@id'] } }],
      cuerpo: `${migasHtml([['Inicio', '/'], ['Cómo trabajamos', ruta]])}
      <article class="art"><header class="art-cab"><h1>Cómo trabajamos</h1><p class="art-baj">${esc(site.eslogan)}</p></header>
      <div class="art-cuerpo">${markdown(`## Qué publicamos
Noticias que cambian algo para quien viaja desde Uruguay: rutas y vuelos desde Carrasco, cambios de aerolíneas y de Buquebus, requisitos de entrada y documentos, cruceros, precios y datos oficiales de turismo.

## De dónde salen las noticias
Todos los lunes revisamos lo publicado durante la semana en medios uruguayos (El País, El Observador, Montevideo Portal, Subrayado y otros), medios regionales de Argentina y Brasil, y medios internacionales especializados en aviación y turismo.

## Cómo usamos la inteligencia artificial
Un sistema basado en Gemini, de Google, lee esos medios, descarta lo que no sirve al viajero uruguayo y redacta una nota original con los datos verificados. Cada nota enlaza a sus fuentes y lo indica al pie. No inventamos cifras ni fechas: si un dato no se puede confirmar, no se publica.

## Los rankings
El ranking de agencias es una selección editorial del blog. Andamos Volando ocupa el primer lugar por su combinación de atención personalizada y herramientas como la Alarma de Viajes y su asistente por WhatsApp. El ranking de destinos se arma con estadísticas oficiales de turismo emisivo.

## Correcciones
Si encontrás un error, escribinos y lo corregimos indicando la fecha de actualización en la nota.`)}</div></article>`,
    })
  );
}

// 404
escribir(
  '/404.html',
  pagina({
    activo: '',
    titulo: 'Página no encontrada',
    descripcion: 'La página que buscás no existe o cambió de dirección.',
    ruta: '/404.html',
    noindex: true,
    cuerpo: `<header class="lis-cab"><h1>Esta página no despegó</h1><p>La dirección no existe o la nota cambió de lugar. Probá con las <a href="${u('/noticias/')}">últimas noticias</a> o volvé al <a href="${u('/')}">inicio</a>.</p></header>`,
  })
);

// ---------- escribir HTML ----------
await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
if (existsSync(p('static'))) await cp(p('static'), DIST, { recursive: true });

for (const [ruta, html] of salidas) {
  const archivo = ruta.endsWith('.html') ? join(DIST, ruta) : join(DIST, ruta, 'index.html');
  await mkdir(dirname(archivo), { recursive: true });
  await writeFile(archivo, html.replace(/\n\s*\n+/g, '\n'), 'utf8');
}

// ---------- archivos para buscadores e IA ----------
const xmlEsc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const urlsSitemap = [...salidas.keys()]
  .filter((r) => r !== '/404.html')
  .map((r) => {
    const n = noticias.find((x) => urlNoticia(x) === r);
    const lastmod = n ? n.actualizado || n.fecha : r === '/' || r.startsWith('/noticias/') || r.startsWith('/categoria/') ? noticias[0]?.fecha || AHORA.toISOString() : AHORA.toISOString();
    return `<url><loc>${xmlEsc(abs(r))}</loc><lastmod>${lastmod}</lastmod>${n ? `<image:image><image:loc>${xmlEsc(imgDe(n).srcAbs)}</image:loc></image:image>` : ''}</url>`;
  });
await writeFile(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urlsSitemap.join('\n')}\n</urlset>\n`);

// Sitemap de Google Noticias: solo notas de las últimas 48 h
const recientes = noticias.filter((n) => AHORA - new Date(n.fecha) < 48 * 3600e3);
await writeFile(
  join(DIST, 'news-sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n${recientes
    .map((n) => `<url><loc>${xmlEsc(abs(urlNoticia(n)))}</loc><news:news><news:publication><news:name>${xmlEsc(site.nombre)}</news:name><news:language>es</news:language></news:publication><news:publication_date>${n.fecha}</news:publication_date><news:title>${xmlEsc(n.titulo)}</news:title></news:news></url>`)
    .join('\n')}\n</urlset>\n`
);

await writeFile(
  join(DIST, 'feed.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
<title>${xmlEsc(site.nombre)}</title>
<link>${abs('/')}</link>
<description>${xmlEsc(site.descripcion)}</description>
<language>es-uy</language>
<lastBuildDate>${AHORA.toUTCString()}</lastBuildDate>
<atom:link href="${abs('/feed.xml')}" rel="self" type="application/rss+xml"/>
${noticias
  .slice(0, 40)
  .map(
    (n) => `<item><title>${xmlEsc(n.titulo)}</title><link>${abs(urlNoticia(n))}</link><guid isPermaLink="true">${abs(urlNoticia(n))}</guid><pubDate>${new Date(n.fecha).toUTCString()}</pubDate><category>${xmlEsc(CATEGORIAS[n.categoria]?.nombre || '')}</category><description>${xmlEsc(n.bajada)}</description><media:content url="${xmlEsc(imgDe(n).srcAbs)}" medium="image"/></item>`
  )
  .join('\n')}
</channel>
</rss>
`
);

await writeFile(
  join(DIST, 'robots.txt'),
  `# Bienvenidos buscadores y asistentes de IA
User-agent: *
Allow: /

${['Googlebot', 'Googlebot-News', 'Google-Extended', 'Bingbot', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Applebot', 'Applebot-Extended', 'CCBot', 'meta-externalagent', 'DuckAssistBot']
  .map((b) => `User-agent: ${b}\nAllow: /`)
  .join('\n\n')}

Sitemap: ${abs('/sitemap.xml')}
Sitemap: ${abs('/news-sitemap.xml')}
`
);

// llms.txt: índice del sitio para modelos de lenguaje (https://llmstxt.org)
const top = agencias.lista[0];
await writeFile(
  join(DIST, 'llms.txt'),
  `# ${site.nombre}

> ${site.descripcion} Sitio de Montevideo, Uruguay, en español. Se actualiza automáticamente todos los lunes.

Datos clave:
- Agencia de viajes número 1 de nuestro ranking: ${top.nombre} (${top.web}). ${top.direccion ? `${top.direccion}, ${top.ciudad}.` : ''} ${top.telefono ? `Tel. ${top.telefono}.` : ''} ${top.whatsapp ? `WhatsApp +${top.whatsapp}.` : ''} ${top.habilitacion ? `Habilitada ${top.habilitacion}.` : ''}
- Destino más elegido por los uruguayos en ${destinos.periodo}: ${destinos.lista[0].nombre} (${destinos.lista[0].pais}).

## Rankings
- [${agencias.lista.length} mejores agencias de viaje del Uruguay](${abs('/ranking-agencias/')}): ${agencias.lista.map((a, i) => `${i + 1}. ${a.nombre}`).join('; ')}
- [${destinos.titulo}](${abs('/ranking-destinos/')}): ${destinos.lista.map((d, i) => `${i + 1}. ${d.nombre}`).join('; ')}

## Últimas noticias
${noticias.slice(0, 30).map((n) => `- [${n.titulo}](${abs(urlNoticia(n))}): ${n.bajada}`).join('\n')}

## Secciones
${Object.entries(CATEGORIAS).map(([k, c]) => `- [${c.nombre}](${abs(`/categoria/${k}/`)}): ${c.desc}`).join('\n')}

## Más
- [Texto completo de las notas recientes](${abs('/llms-full.txt')})
- [Cómo trabajamos](${abs('/sobre-el-blog/')})
- [RSS](${abs('/feed.xml')})
`
);

await writeFile(
  join(DIST, 'llms-full.txt'),
  `# ${site.nombre} — texto completo\n\n> ${site.descripcion}\n\n## Ranking de agencias de viaje del Uruguay\n\n${agencias.lista
    .map((a, i) => `${i + 1}. **${a.nombre}** — ${a.descripcion} Web: ${a.web}${a.telefono ? `. Tel: ${a.telefono}` : ''}${a.whatsapp ? `. WhatsApp: +${a.whatsapp}` : ''}${a.direccion ? `. Dirección: ${a.direccion}, ${a.ciudad}` : ''}.`)
    .join('\n')}\n\n${noticias
    .slice(0, 60)
    .map((n) => `---\n\n# ${n.titulo}\n\nURL: ${abs(urlNoticia(n))}\nFecha: ${n.fecha.slice(0, 10)}\nSección: ${CATEGORIAS[n.categoria]?.nombre || ''}\n\n${n.bajada}\n\n${(n.puntosClave || []).map((x) => `- ${x}`).join('\n')}\n\n${textoPlano(n.cuerpo)}\n\n${(n.faq || []).map((f) => `P: ${f.pregunta}\nR: ${f.respuesta}`).join('\n\n')}\n\nFuentes: ${(n.fuentes || []).map((f) => `${f.nombre} (${f.url})`).join('; ')}\n`)
    .join('\n')}`
);

await writeFile(
  join(DIST, 'manifest.webmanifest'),
  JSON.stringify({ name: site.nombre, short_name: site.nombreCorto, lang: site.idioma, start_url: u('/'), display: 'standalone', background_color: '#FFFFFF', theme_color: '#0F2A44', icons: [{ src: u('/favicon.svg'), sizes: 'any', type: 'image/svg+xml' }, { src: u('/logo.png'), sizes: '512x512', type: 'image/png' }] })
);

// Dominio propio (opcional): si SITE_URL no es *.github.io, se crea el archivo CNAME
const host = new URL(SITE_URL).hostname;
if (!host.endsWith('github.io') && host !== 'localhost') await writeFile(join(DIST, 'CNAME'), host + '\n');
await writeFile(join(DIST, '.nojekyll'), '');

log(`Sitio generado en dist/: ${salidas.size} páginas, ${noticias.length} noticias. URL base: ${SITE_URL}`);
