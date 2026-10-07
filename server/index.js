import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const port = Number(process.env.PORT || 3000);
const app = await createApp({
  root,
  dataDirectory: path.resolve(process.env.DATA_DIR || path.join(root, 'data')),
  basePath: process.env.BASE_PATH || '',
  publicOrigin: process.env.PUBLIC_ORIGIN || `http://localhost:${port}`,
  passwordHash: process.env.ADMIN_PASSWORD_HASH,
  sessionSecret: process.env.SESSION_SECRET,
  version: pkg.version,
  commit: process.env.GIT_SHA || 'development',
});
app.server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Mosaic ${pkg.version} listening on port ${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { app.server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 8000).unref(); });
