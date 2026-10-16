import { sleep, log } from './util.mjs';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const TIEMPO_MAXIMO_MS = 90_000; // ningún pedido puede quedar colgado más de 90 s

export class CupoAgotado extends Error {
  constructor(msg, { conBusqueda = false } = {}) {
    super(msg);
    this.cupo = true;
    this.conBusqueda = conBusqueda;
  }
}

/**
 * Pregunta a Google qué modelos puede usar esta clave y arma la lista en orden de preferencia:
 * primero los que pide config (si existen), después el alias "flash-latest" y los Flash estables más nuevos.
 * Así, cuando Google retira un modelo, el robot sigue funcionando sin tocar el código.
 */
export async function modelosDisponibles({ preferidos = [], apiKey = process.env.GEMINI_API_KEY } = {}) {
  const nombres = [];
  try {
    let token = '';
    do {
      const res = await fetch(`${API}/models?pageSize=200${token ? `&pageToken=${token}` : ''}`, {
        headers: { 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(20_000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      for (const m of data.models || []) {
        if ((m.supportedGenerationMethods || []).includes('generateContent')) nombres.push(m.name.replace(/^models\//, ''));
      }
      token = data.nextPageToken || '';
    } while (token);
  } catch (err) {
    log(`  no pude listar los modelos (${err.message}); uso la lista de config`);
    return preferidos.length ? preferidos : ['gemini-flash-latest'];
  }

  const version = (n) => parseFloat(n.match(/^gemini-(\d+(?:\.\d+)?)-flash$/)?.[1] || '0');
  const flashEstables = nombres.filter((n) => /^gemini-\d+(\.\d+)?-flash$/.test(n)).sort((a, b) => version(b) - version(a));
  const orden = [...preferidos.filter((n) => nombres.includes(n)), ...(nombres.includes('gemini-flash-latest') ? ['gemini-flash-latest'] : []), ...flashEstables];
  const lista = [...new Set(orden)].slice(0, 4);
  if (!lista.length) lista.push(...nombres.filter((n) => /flash/.test(n) && !/lite|image|tts|live|audio|embedding/.test(n)).slice(0, 3));
  return lista;
}

/** Lee un error 429 de Google: ¿es un límite por minuto (esperar) o un cupo diario/mensual (no tiene sentido esperar)? */
function analizar429(data) {
  const detalles = data?.error?.details || [];
  const ids = detalles.flatMap((d) => (d.violations || []).map((v) => v.quotaId || v.quotaMetric || '')).join(' ');
  const retry = detalles.find((d) => String(d['@type']).includes('RetryInfo'))?.retryDelay;
  const segundos = retry ? parseFloat(retry) : null;
  const largo = /PerDay|PerMonth|daily|monthly/i.test(ids + ' ' + (data?.error?.message || '')) || (segundos != null && segundos > 60);
  return { largo, segundos };
}

/**
 * Llama a Gemini. Prueba los modelos en orden, con pocos reintentos y tiempo máximo.
 * - schema: pide JSON estructurado (no se combina con la búsqueda).
 * - buscar: activa la búsqueda de Google. Si su cupo se agota, lanza CupoAgotado({conBusqueda:true})
 *   enseguida para que quien llama siga sin búsqueda en vez de insistir.
 */
export async function gemini({ prompt, sistema, schema, buscar = false, temperatura = 0.4, modelos, apiKey = process.env.GEMINI_API_KEY }) {
  if (!apiKey) throw new Error('Falta GEMINI_API_KEY');
  const lista = modelos?.length ? modelos : ['gemini-flash-latest'];

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: temperatura },
  };
  if (sistema) body.systemInstruction = { parts: [{ text: sistema }] };
  if (buscar) body.tools = [{ google_search: {} }];
  if (schema && !buscar) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = schema;
  }

  let ultimoError;
  let cuposAgotados = 0;
  for (const modelo of lista) {
    for (let intento = 1; intento <= 3; intento++) {
      let res, data;
      try {
        res = await fetch(`${API}/models/${modelo}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
        });
        data = await res.json().catch(() => ({}));
      } catch (err) {
        ultimoError = new Error(err.name === 'TimeoutError' ? `sin respuesta en ${TIEMPO_MAXIMO_MS / 1000}s` : err.message);
        log(`  ${modelo}: ${ultimoError.message}${intento < 3 ? ', reintento' : ''}`);
        if (intento < 3) await sleep(5000 * intento);
        continue;
      }

      const msg = data?.error?.message || `HTTP ${res.status}`;

      if (res.status === 404 || (res.status === 400 && /not found|no longer available|not supported|deprecated/i.test(msg))) {
        log(`  ${modelo} no está disponible para esta clave, sigo con el siguiente`);
        ultimoError = new Error(msg);
        break;
      }
      if (res.status === 429) {
        const { largo, segundos } = analizar429(data);
        if (buscar) throw new CupoAgotado(`cupo de la búsqueda de Google agotado (${modelo})`, { conBusqueda: true });
        if (largo || intento === 3) {
          log(`  ${modelo}: cupo agotado${largo ? ' por hoy' : ''}, sigo con el siguiente`);
          ultimoError = new CupoAgotado(msg);
          cuposAgotados++;
          break;
        }
        const espera = Math.min(60, segundos ?? 10 * intento);
        log(`  ${modelo}: límite por minuto, espero ${espera}s`);
        await sleep(espera * 1000);
        continue;
      }
      if (res.status >= 500) {
        ultimoError = new Error(msg);
        log(`  ${modelo}: Google respondió ${res.status} (servicio saturado)${intento < 3 ? ', reintento' : ''}`);
        if (intento < 3) await sleep(6000 * intento);
        continue;
      }
      if (!res.ok) throw new Error(msg);

      const cand = data.candidates?.[0];
      const texto = (cand?.content?.parts || []).map((x) => x.text || '').join('').trim();
      if (!texto) {
        ultimoError = new Error(`respuesta vacía (${cand?.finishReason || data?.promptFeedback?.blockReason || 'sin candidatos'})`);
        if (intento < 3) await sleep(2000);
        continue;
      }
      return { texto, json: extraerJson(texto), modelo };
    }
  }
  if (cuposAgotados > 0) throw new CupoAgotado('el cupo gratuito de Gemini está agotado por ahora en todos los modelos disponibles');
  throw ultimoError || new Error('Gemini no respondió');
}

export function extraerJson(texto) {
  if (!texto) return null;
  const t = texto.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(t);
  } catch {}
  const ini = Math.min(...['{', '['].map((c) => (t.indexOf(c) === -1 ? Infinity : t.indexOf(c))));
  const fin = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (ini === Infinity || fin <= ini) return null;
  try {
    return JSON.parse(t.slice(ini, fin + 1));
  } catch {
    return null;
  }
}
