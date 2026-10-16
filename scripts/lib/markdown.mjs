/** Markdown mínimo y seguro: párrafos, ## y ### subtítulos, listas, **negrita**, *itálica* y [links](https://...). */
export function esc(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t, u) => `<a href="${u.replace(/"/g, '%22')}" rel="noopener nofollow" target="_blank">${t}</a>`);
}

export function markdown(md = '') {
  const lines = String(md).replace(/\r/g, '').split('\n');
  const out = [];
  let lista = null;
  let parrafo = [];
  const cerrarParrafo = () => {
    if (parrafo.length) out.push(`<p>${inline(parrafo.join(' '))}</p>`);
    parrafo = [];
  };
  const cerrarLista = () => {
    if (lista) out.push(`<${lista.tipo}>${lista.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${lista.tipo}>`);
    lista = null;
  };
  for (const raw of lines) {
    const l = raw.trim();
    let m;
    if (!l) {
      cerrarParrafo();
      cerrarLista();
    } else if ((m = l.match(/^(#{2,4})\s+(.*)$/))) {
      cerrarParrafo();
      cerrarLista();
      const nivel = Math.min(3, m[1].length);
      out.push(`<h${nivel}>${inline(m[2])}</h${nivel}>`);
    } else if ((m = l.match(/^[-*•]\s+(.*)$/)) || (m = l.match(/^\d+[.)]\s+(.*)$/))) {
      cerrarParrafo();
      const tipo = /^\d/.test(l) ? 'ol' : 'ul';
      if (lista && lista.tipo !== tipo) cerrarLista();
      if (!lista) lista = { tipo, items: [] };
      lista.items.push(m[1]);
    } else {
      cerrarLista();
      parrafo.push(l);
    }
  }
  cerrarParrafo();
  cerrarLista();
  return out.join('\n');
}

/** Texto plano (para llms-full.txt y descripciones). */
export function textoPlano(md = '') {
  return String(md).replace(/\*\*|__|\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}
