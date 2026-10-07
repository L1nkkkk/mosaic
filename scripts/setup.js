import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { passwordHash } from '../server/auth.js';

const password = randomBytes(18).toString('base64url');
const environment = `HOST=127.0.0.1\nPORT=3000\nPUBLIC_ORIGIN=http://localhost:3000\nADMIN_PASSWORD_HASH=${await passwordHash(password)}\nSESSION_SECRET=${randomBytes(32).toString('hex')}\n`;
await writeFile('.env', environment, { flag: 'wx', mode: 0o600 });
console.log(`Local configuration created in .env.\nEditor password: ${password}\nStart with: node --env-file=.env server/index.js`);
