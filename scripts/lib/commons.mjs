import { fetchText, stripHtml, log } from './util.mjs';

const LICENCIAS_OK = /^(cc0|cc[- ]by(?:[- ]sa)?(?:[- ][\d.]+)?|public domain|pd|attribution)/i;

/** URL estable de un archivo de Wikimedia Commons, con ancho máximo. */
export function commonsUrl(archivo, ancho = 1280) {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(archivo.replace(/ /g, '_'))}?width=${ancho}`;
}

export function commonsPagina(archivo) {
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(archivo.replace(/ /g, '_'))}`;
}

/**
 * Busca una foto con licencia libre en Wikimedia Commons.
 * Devuelve { archivo, alt, autor, licencia } o null.
 */
export async function buscarFotoLibre(consulta) {
  if (!consulta) return null;
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=15' +
    `&gsrsearch=${encodeURIComponent(consulta + ' filetype:bitmap')}` +
    '&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiextmetadatafilter=LicenseShortName|Artist|ImageDescription';
  try {
    const { text } = await fetchText(url, { timeout: 15000 });
    const pages = Object.values(JSON.parse(text)?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    for (const pg of pages) {
      const info = pg.imageinfo?.[0];
      if (!info || !/image\/(jpeg|png|webp)/.test(info.mime)) continue;
      if (info.width < 900 || info.width < info.height) continue; // horizontales y grandes
      const lic = info.extmetadata?.LicenseShortName?.value || '';
      if (!LICENCIAS_OK.test(lic)) continue;
      const archivo = pg.title.replace(/^File:/, '');
      return {
        archivo,
        alt: stripHtml(info.extmetadata?.ImageDescription?.value || '').slice(0, 140) || consulta,
        autor: stripHtml(info.extmetadata?.Artist?.value || '').slice(0, 80),
        licencia: lic,
      };
    }
  } catch (err) {
    log(`  Commons: no pude buscar "${consulta}": ${err.message}`);
  }
  return null;
}
