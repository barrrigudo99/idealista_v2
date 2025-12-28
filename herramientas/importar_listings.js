import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';

const { Pool } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 🔌 conexión a PostgreSQL
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'inmobiliaria',
  user: 'admin',
  password: 'admin123'
});

// 📄 leer JSON
const rutaJson = path.join(__dirname, 'anuncios-fotocasa.json');
const anuncios = JSON.parse(fs.readFileSync(rutaJson, 'utf-8'));

console.log(`📦 Importando ${anuncios.length} anuncios...`);

for (const anuncio of anuncios) {
  const query = `
    INSERT INTO listings (id, url, estado, timestamp)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id) DO NOTHING;
  `;

  await pool.query(query, [
    anuncio.id,
    anuncio.url,
    anuncio.estado,
    anuncio.timestamp
  ]);
}

await pool.end();
console.log('✅ Importación finalizada');
