import { buildApp } from './app';
import { EnvValidationError, loadEnv, type Env } from './config/env';

let env: Env;
try {
  env = loadEnv();
} catch (err) {
  // O logger ainda não existe: escreve direto no stderr e sai.
  process.stderr.write(`${err instanceof EnvValidationError ? err.message : String(err)}\n`);
  process.exit(1);
}

const app = await buildApp({ env });

let closing = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'encerrando');
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'falha ao encerrar');
    process.exit(1);
  }
}

process.once('SIGINT', (signal) => void shutdown(signal));
process.once('SIGTERM', (signal) => void shutdown(signal));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (err) {
  app.log.fatal({ err }, 'falha ao iniciar o servidor');
  process.exit(1);
}
