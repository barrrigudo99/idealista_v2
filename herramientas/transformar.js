import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Archivos
const INPUT_FILE = path.join(__dirname, 'data', 'enlaces.json');
const OUTPUT_FILE = path.join(__dirname, 'data', 'enlaces_t.json');

// Leer JSON original
const raw = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));

// Transformar formato
const transformado = raw
  .filter(p => p.id && p.url) // seguridad
  .map(p => ({
    id: p.id,
    url: p.url,
    estado: false
  }));

// Guardar JSON final
fs.writeFileSync(
  OUTPUT_FILE,
  JSON.stringify(transformado, null, 2),
  'utf-8'
);

console.log(`✅ Transformación completada`);
console.log(`📦 Entradas originales: ${raw.length}`);
console.log(`📦 Entradas finales: ${transformado.length}`);
console.log(`💾 Archivo generado: ${OUTPUT_FILE}`);
