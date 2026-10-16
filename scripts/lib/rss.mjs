import { decodeEntities, stripHtml, fetchText } from './util.mjs';

function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
}

function attr(block, name, attribute) {
  const re = new RegExp(`<${name}\\b[^>]*\\b${attribute}=["']([^"']+)["'][^>]*>`, 'i');
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : '';
}

/** Parser liviano de RSS 2.0 y Atom. Devuelve [{titulo, link, fecha, resumen, medio}] */
export function parseFeed(xml, medioPorDefecto = '') {
  const items = [];
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];

  for (const b of blocks) {
    let titulo = stripHtml(tag(b, 'title'));
    let link = isAtom ? attr(b, 'link', 'href') : decodeEntities(tag(b, 'link'));
    if (!link) link = attr(b, 'link', 'href');
    const fechaRaw = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const resumen = stripHtml(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content') || tag(b, 'content:encoded')).slice(0, 500);
    let medio = stripHtml(tag(b, 'source')) || medioPorDefecto;
    const medioUrl = attr(b, 'source', 'url');

    // Google Noticias agrega " - Medio" al final del título
    if (medio && titulo.endsWith(` - ${medio}`)) titulo = titulo.slice(0, -(medio.length + 3)).trim();

    const fecha = fechaRaw ? new Date(fechaRaw) : null;
    if (!titulo || !link) continue;
    items.push({
      titulo,
      link: link.trim(),
      fecha: fecha && !isNaN(fecha) ? fecha.toISOString() : null,
      resumen: resumen && resumen !== titulo ? resumen : '',
      medio,
      medioUrl,
    });
  }
  return items;
}

export function googleNewsUrl({ q, region = 'UY', idioma = 'es' }) {
  const hl = idioma === 'en' ? 'en-US' : 'es-419';
  const gl = region;
  const ceid = `${gl}:${idioma === 'en' ? 'en' : 'es-419'}`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:3d')}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

export async function leerFeed(url, medio) {
  const { text } = await fetchText(url, { timeout: 20000, headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } });
  return parseFeed(text, medio);
}
