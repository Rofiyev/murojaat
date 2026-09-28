import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const archive = path.join(__dirname, 'public.zip');
const publicDir = path.join(__dirname, 'public');

if (!fs.existsSync(archive)) {
  throw new Error('public.zip topilmadi');
}

fs.rmSync(publicDir, { recursive: true, force: true });
new AdmZip(archive).extractAllTo(__dirname, true);

if (!fs.existsSync(path.join(publicDir, 'index.html'))) {
  throw new Error('Frontend ochilmadi: public/index.html topilmadi');
}

console.log('Frontend public/ tayyorlandi.');
