import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

/** Version reported by the health endpoint; read from package.json. */
export const APP_VERSION: string = pkg.version;
