import { sleep, log } from './util.mjs';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Llama a Gemini con reintentos y modelos de respaldo.
 * - schema: si se pasa, pide JSON estructurado (no se combina con búsqueda).
 * - buscar: activa "Grounding with Google Search" para verificar datos en la web.
 * Devuelve { texto, json, modelo, fuentesWeb }.
 */
export async function gemini({ prompt, sistema, schema, buscar = false, temperatura = 0.4, modelos, apiKey = process.env.GEMINI_API_KEY }) {
  if (!apiKey) throw new Error('Falta GEMINI_API_KEY');
  const lista = modelos?.length ? modelos : ['gemini-flash-latest', 'gemini-2.5-flash'];

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
  for (const modelo of lista) {
    for (let intento = 1; intento <= 4; intento++) {
      try {
        const res = await fetch(`${API}/${modelo}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));

        if (res.status === 404 || res.status === 400 && /not found|not supported/i.test(data?.error?.message || '')) {
          log(`  modelo ${modelo} no disponible, pruebo el siguiente`);
          ultimoError = new Error(data?.error?.message || `HTTP ${res.status}`);
          break; // siguiente modelo
        }
        if (res.status === 429 || res.status >= 500) {
          const espera = Math.min(60000, 4000 * 2 ** (intento - 1));
          log(`  Gemini ${res.status} (${modelo}), reintento en ${espera / 1000}s`);
          ultimoError = new Error(data?.error?.message || `HTTP ${res.status}`);
          await sleep(espera);
          continue;
        }
        if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);

        const cand = data.candidates?.[0];
        const texto = (cand?.content?.parts || []).map((x) => x.text || '').join('').trim();
        if (!texto) {
          ultimoError = new Error(`Respuesta vacía (${cand?.finishReason || 'sin candidatos'})`);
          await sleep(2000);
          continue;
        }
        const fuentesWeb = (cand?.groundingMetadata?.groundingChunks || [])
          .map((c) => c.web)
          .filter(Boolean)
          .map((w) => ({ titulo: w.title, url: w.uri }));
        return { texto, json: extraerJson(texto), modelo, fuentesWeb };
      } catch (err) {
        ultimoError = err;
        if (intento < 4) await sleep(3000 * intento);
      }
    }
  }
  throw ultimoError || new Error('Gemini no respondió');
}

export function extraerJson(texto) {
  if (!texto) return null;
  let t = texto.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
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
