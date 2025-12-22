/*
  SCRAPER IDEALISTA – PROCESO DIRECTO DESDE enlaces.json
  -----------------------------------------------------
  - NO scrapea listados
  - Lee links desde data/enlaces.json
  - Recovery por estado
*/

import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';

puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===================== CONFIG =====================
const LINKS_FILE = path.join(__dirname, 'data', 'enlaces.json');
const DETALLE_DIR = path.join(__dirname, 'pisos');
const DETALLE_FILE = path.join(DETALLE_DIR, 'pisos_detalle.json');

const SELECTORS = {
  cookiesReject: '#didomi-notice-disagree-button',
  h1: 'h1',
  detalleBox:
    '#main > div > main > section.detail-info.ide-box-detail-first-picture.ide-box-detail--reset.overlay-box'
};

// ===================== UTILS ======================
const esperar = (min, max) =>
  new Promise(r =>
    setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min)
  );

const readJsonSafe = (file, fallback = []) => {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
};

const writeJson = (file, data) =>
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');

// ===================== PERSISTENCIA =====================
function guardarDetalle({ id, detalle }) {
  if (!id || !detalle) return;

  fs.mkdirSync(DETALLE_DIR, { recursive: true });
  const data = readJsonSafe(DETALLE_FILE, []);

  if (data.some(p => p.id === id)) {
    console.log(`⏭️ Piso ${id} ya guardado`);
    return;
  }

  data.push({ id, detalle });
  writeJson(DETALLE_FILE, data);
  console.log(`💾 Detalle guardado para piso ${id}`);
}

function marcarProcesado(id) {
  const data = readJsonSafe(LINKS_FILE, []);
  const piso = data.find(p => p.id === id);
  if (!piso) return;

  piso.estado = true;
  writeJson(LINKS_FILE, data);
}

// ===================== MAIN =====================
(async () => {
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

  // Cookies
  page.on('console', msg => console.log('📢 NAV:', msg.text()));

  const enlaces = readJsonSafe(LINKS_FILE, []);
  const pendientes = enlaces.filter(p => p.estado === false);

  console.log(`🔗 Pisos pendientes: ${pendientes.length}`);

  for (const piso of pendientes) {
    try {
      console.log(`➡️ Visitando piso ${piso.id}`);
      await page.goto(piso.url, { waitUntil: 'networkidle2', timeout: 60000 });

      // Cookies (una vez o varias, no importa)
      try {
        await page.waitForSelector(SELECTORS.cookiesReject, { timeout: 5000 });
        await page.click(SELECTORS.cookiesReject);
      } catch {}

      await page.waitForSelector(SELECTORS.h1, { timeout: 10000 });
      const detalle = await page.$eval(
        SELECTORS.detalleBox,
        el => el.innerText.trim()
      );

      guardarDetalle({ id: piso.id, detalle });
      marcarProcesado(piso.id);

      await esperar(2000, 4000);
    } catch (err) {
      console.log(`❌ Error en piso ${piso.id}`, err.message);
      await esperar(5000, 8000);
    }
  }

  console.log('🏁 Proceso finalizado');
  console.log('Proceso de transformación de datos iniciado...');
  // Aquí iría la llamada a la función de transformación
  const { transformRawListings } = await import('./transformador.js');
  const rawJson = JSON.parse(
    fs.readFileSync("src/pisos/pisos_detalle.json", "utf8")
  );
  const structuredListings = transformRawListings(rawJson);
  console.log(JSON.stringify(structuredListings, null, 2));
  // Guardar en json
  fs.writeFileSync("src/pisos/pisos_estructurados.json", JSON.stringify(structuredListings, null, 2));

  // await browser.close();
})();
