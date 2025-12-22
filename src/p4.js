/*
  SCRAPER IDEALISTA – FLUJO HUMANO, ROBUSTO Y OPTIMIZADO
  Modo:
  Página 1 -> generar links_pagina_1.json -> procesar pendientes -> SOLO cuando esté limpia -> página 2
  Recovery:
  Si cierras el programa, retoma desde la primera página con pendientes.
*/

import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';
import readline from 'readline';

puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ======================================================
// ===================== CONFIG =========================
// ======================================================

const BASE_URL =
  'https://www.idealista.com/alquiler-viviendas/madrid/centro/malasana-universidad/';

const SELECTORS = {
  article: '#main-content section article',
  linkInArticle: 'div.item-info-container > a',
  cookiesReject: '#didomi-notice-disagree-button',
  h1: 'h1',
  detalleBox:
    '#main > div > main > section.detail-info.ide-box-detail-first-picture.ide-box-detail--reset.overlay-box'
};

// ======================================================
// ===================== UTILIDADES =====================
// ======================================================

const esperar = (min, max) =>
  new Promise(resolve =>
    setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min)
  );

const esperarTecla = (mensaje = '➡️ Pulsa ENTER para continuar...') =>
  new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(`\n${mensaje}\n`, () => {
      rl.close();
      resolve();
    });
  });

async function getTextSafe(page, selector, type = 'css') {
  try {
    if (type === 'xpath') {
      const el = await page.waitForXPath(selector, { timeout: 5000 });
      return await page.evaluate(el => el.innerText.trim(), el);
    } else {
      await page.waitForSelector(selector, { timeout: 5000 });
      return await page.$eval(selector, el => el.innerText.trim());
    }
  } catch {
    return null;
  }
}

function extraerIdDesdeHref(href) {
  if (!href) return null;
  const match = href.match(/inmueble\/(\d+)/);
  return match ? match[1] : null;
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ======================================================
// =================== PERSISTENCIA =====================
// ======================================================

function guardarDetallePisoEnArchivo({ id, detalle }) {
  if (!id || !detalle) return;

  const dirPath = path.join(__dirname, 'pisos');
  const filePath = path.join(dirPath, 'pisos_detalle.json');
  fs.mkdirSync(dirPath, { recursive: true });

  const data = readJsonSafe(filePath, []);

  // Evitar duplicados por ID
  if (data.some(p => p.id === id)) {
    console.log(`⏭️ Piso ${id} ya guardado, se omite`);
    return;
  }

  data.push({ id, detalle });
  writeJson(filePath, data);

  console.log(`💾 Piso ${id} añadido a pisos_detalle.json`);
}

function marcarPisoComoProcesado({ id, pagina }) {
  const filePath = path.join(__dirname, `links_pagina_${pagina}.json`);
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️ No existe ${filePath}`);
    return;
  }

  const data = readJsonSafe(filePath, []);
  const piso = data.find(p => p.id === id);

  if (!piso) {
    console.log(`⚠️ Piso ${id} no encontrado en links (página ${pagina})`);
    return;
  }

  piso.estado = true;
  writeJson(filePath, data);

  console.log(`✅ Estado actualizado a true para piso ${id} (página ${pagina})`);
}

function obtenerIdsPendientesPagina(pagina) {
  const filePath = path.join(__dirname, `links_pagina_${pagina}.json`);
  const data = readJsonSafe(filePath, []);
  return new Set(data.filter(p => p.estado === false).map(p => p.id));
}

function paginaEstaCompleta(pagina) {
  const filePath = path.join(__dirname, `links_pagina_${pagina}.json`);
  const data = readJsonSafe(filePath, null);
  if (!data) return false;
  return data.length > 0 && data.every(p => p.estado === true);
}

function obtenerPaginaPendienteInicial() {
  let pagina = 1;
  while (true) {
    const filePath = path.join(__dirname, `links_pagina_${pagina}.json`);

    if (!fs.existsSync(filePath)) return pagina; // no existe -> empezar aquí
    if (!paginaEstaCompleta(pagina)) return pagina; // existe pero incompleta -> retomar aquí

    pagina++;
  }
}

/**
 * Genera/actualiza links_pagina_N.json sin perder estados:
 * - Si ya existe: preserva estado=true/false
 * - Añade IDs nuevos si aparecen en el listado
 */
function guardarLinksPaginaMerge(pagina, linksPagina) {
  const filePath = path.join(__dirname, `links_pagina_${pagina}.json`);

  const existente = readJsonSafe(filePath, []);
  const mapExistente = new Map(existente.map(x => [x.id, x]));

  const nuevos = linksPagina
    .map(link => {
      const id = extraerIdDesdeHref(link.href);
      if (!id) return null;

      const prev = mapExistente.get(id);
      if (prev) return prev; // preserva estado anterior

      return { id, pagina, links: [link], estado: false };
    })
    .filter(Boolean);

  // También conservar los existentes que no han salido hoy (por si el listado varía)
  const idsNuevos = new Set(nuevos.map(x => x.id));
  const arrFinal = [
    ...nuevos,
    ...existente.filter(x => !idsNuevos.has(x.id))
  ];

  writeJson(filePath, arrFinal);
  console.log(`💾 links_pagina_${pagina}.json actualizado (merge)`);
}

// ======================================================
// ===================== SETUP PAGE =====================
// ======================================================

async function setupBrowser() {
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--incognito',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const [page] = await browser.pages();
  return { browser, page };
}

async function setupRequestInterception(page) {
  await page.setRequestInterception(true);

  page.on('request', req => {
    const type = req.resourceType();
    if (['font', 'media'].includes(type)) req.abort();
    else req.continue();
  });

  page.on('console', msg => console.log('📢 NAV:', msg.text()));
}

// ======================================================
// =============== DETECTOR about:blank =================
// ======================================================

function setupAboutBlankDetector(page) {
  let aboutBlankDetected = false;

  page.on('framenavigated', frame => {
    if (frame === page.mainFrame() && frame.url() === 'about:blank') {
      aboutBlankDetected = true;
      console.log('⚠️ about:blank detectado (framenavigated)');
    }
  });

  return {
    reset: () => (aboutBlankDetected = false),
    detected: () => aboutBlankDetected
  };
}

// ======================================================
// =================== ACCIONES PAGE ====================
// ======================================================

async function aceptarCookies(page) {
  try {
    await page.waitForSelector(SELECTORS.cookiesReject, { timeout: 10000 });
    await page.click(SELECTORS.cookiesReject);
    console.log('✅ Cookies rechazadas');
  } catch {
    console.log('⚠️ No apareció el banner de cookies');
  }
}

async function scrollListado(page) {
  await page.keyboard.press('End');
  await esperar(2000, 4500);
}

async function irAPagina(page, numeroPagina) {
  const url = numeroPagina === 1 ? BASE_URL : `${BASE_URL}pagina-${numeroPagina}.htm`;
  console.log(`➡️ Navegando a página ${numeroPagina}: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle2' });
}

// ======================================================
// ================= SCRAPING LISTADO ==================
// ======================================================

async function obtenerArticulos(page) {
  try {
    await page.waitForSelector(SELECTORS.article, { timeout: 15000 });
    return await page.$$(SELECTORS.article);
  } catch {
    return [];
  }
}

async function extraerLinksPagina(articles) {
  const links = [];

  for (let i = 0; i < articles.length; i++) {
    try {
      const data = await articles[i].$eval(SELECTORS.linkInArticle, el => ({
        texto: el.innerText.trim(),
        href: el.href
      }));

      links.push(data);
      console.log(`🔗 Link ${i + 1}`);
      console.log('   Texto:', data.texto);
      console.log('   Href:', data.href);
    } catch {
      console.log(`⚠️ Piso ${i + 1} sin link`);
    }
  }

  return links;
}

// ======================================================
// ================= SCRAPING PISO ======================
// ======================================================

async function procesarPiso({ page, article, detector, estado }) {
  try {
    await article.evaluate(el =>
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    );

    await esperar(600, 1400);
    // await esperarTecla('Pulsa ENTER para entrar');

    detector.reset();
    await article.click({ delay: 120 });
    await esperar(1200);

    if (detector.detected()) {
      estado.errores++;
      console.log('🚫 Navegación abortada (about:blank)');
      // Volver a la página correcta (no a la 1)
      await irAPagina(page, estado.pagina);
      return;
    }

    await page.waitForSelector(SELECTORS.h1, { timeout: 10000 });

    const detalleInfo = await getTextSafe(page, SELECTORS.detalleBox);
    const currentUrl = page.url();
    const id = extraerIdDesdeHref(currentUrl);

    console.log('📦 Detalle info (texto completo):');
    console.log(detalleInfo);

    // Si no hay id o detalle, NO marcar como procesado
    if (!id || !detalleInfo) {
      estado.errores++;
      console.log(`⚠️ Detalle/ID inválido (id=${id}), se reintentará luego`);
      try {
        await page.goBack({ waitUntil: 'networkidle2' });
      } catch {
        await irAPagina(page, estado.pagina);
      }
      return;
    }

    guardarDetallePisoEnArchivo({ id, detalle: detalleInfo });
    marcarPisoComoProcesado({ id, pagina: estado.pagina });

    estado.pisosVisitados++;
    console.log(`✅ Piso ${estado.pisosVisitados} | ID: ${id}`);

    await esperar(1800, 3200);

    try {
      await page.goBack({ waitUntil: 'networkidle2' });
    } catch {
      await irAPagina(page, estado.pagina);
    }
  } catch {
    estado.errores++;
    // Asegurar que volvemos a la página correcta
    await irAPagina(page, estado.pagina);
  }
}

async function procesarPaginaCompleta({ page, detector, estado }) {
  console.log(`🔄 Procesando página ${estado.pagina}`);

  while (true) {
    const idsPendientes = obtenerIdsPendientesPagina(estado.pagina);

    if (idsPendientes.size === 0) {
      console.log(`✅ Página ${estado.pagina} COMPLETA`);
      return;
    }

    console.log(`⏳ Pendientes en página ${estado.pagina}: ${idsPendientes.size}`);

    const articles = await obtenerArticulos(page);
    if (articles.length === 0) {
      console.log('⚠️ No se encontraron artículos; reintentando navegación a la página...');
      await irAPagina(page, estado.pagina);
      await scrollListado(page);
      continue;
    }

    for (const article of articles) {
      let href, id;

      try {
        href = await article.$eval(SELECTORS.linkInArticle, el => el.href);
        id = extraerIdDesdeHref(href);
      } catch {
        continue;
      }

      if (!id) continue;
      if (!idsPendientes.has(id)) continue;

      await procesarPiso({ page, article, detector, estado });
    }

    await scrollListado(page);
  }
}

// ======================================================
// ======================= MAIN =========================
// ======================================================

(async () => {
  const { browser, page } = await setupBrowser();
  await setupRequestInterception(page);

  const detector = setupAboutBlankDetector(page);

  const estado = {
    pagina: obtenerPaginaPendienteInicial(),
    pisosVisitados: 0,
    errores: 0
  };

  console.log(`🚀 Iniciando desde página ${estado.pagina}`);

  await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
  await aceptarCookies(page);

  while (true) {
    // 1) Ir explícitamente a la página N (recovery-friendly)
    await irAPagina(page, estado.pagina);
    await scrollListado(page);

    // 2) Extraer links + guardar/mergear JSON de la página
    const articles = await obtenerArticulos(page);
    if (articles.length === 0) {
      console.log(`🏁 No hay artículos en página ${estado.pagina}. Fin.`);
      break;
    }

    console.log(`🏠 Pisos encontrados (DOM): ${articles.length}`);
    const linksPagina = await extraerLinksPagina(articles);
    guardarLinksPaginaMerge(estado.pagina, linksPagina);

    // 3) Procesar SOLO los pendientes hasta dejar la página limpia
    await procesarPaginaCompleta({ page, detector, estado });

    // 4) SOLO cuando esté limpia -> pasar a la siguiente
    estado.pagina++;
  }

  console.log('\n📊 RESUMEN FINAL');
  console.log(`✔️ Pisos visitados: ${estado.pisosVisitados}`);
  console.log(`❌ Errores: ${estado.errores}`);

  // await browser.close();
})();
