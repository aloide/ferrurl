// Empaqueta FerrURL en formato portable (sin instalador ni permisos de admin).
import fs from 'node:fs';
import path from 'node:path';

const exeSrc = path.resolve('src-tauri/target/release/ferrurl.exe');
if (!fs.existsSync(exeSrc)) {
  console.error('Falta src-tauri/target/release/ferrurl.exe. Ejecutá "pnpm tauri build" primero.');
  process.exit(1);
}

const outDir = path.resolve('dist-portable/FerrURL-portable');
fs.mkdirSync(path.join(outDir, 'data'), { recursive: true });
fs.copyFileSync(exeSrc, path.join(outDir, 'FerrURL.exe'));
fs.writeFileSync(path.join(outDir, 'portable.flag'), 'portable\n');
fs.writeFileSync(
  path.join(outDir, 'LEEME.txt'),
  'FerrURL (Modo Portable)\r\n' +
    '=======================\r\n' +
    '1. Ejecuta "FerrURL.exe" (no requiere permisos de administrador).\r\n' +
    '2. Los datos, colecciones y configuracion se guardan en la carpeta .\\data\\.\r\n' +
    '3. Configura el proxy corporativo desde el boton "Proxy" arriba a la derecha.\r\n',
);

console.log(`[portable] Generado en ${outDir}`);
