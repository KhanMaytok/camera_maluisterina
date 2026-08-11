import { buildApp } from './app.js';
import { config } from './config.js';
import { startRetention } from './retention.js';

const { app, db } = await buildApp();
startRetention(db);

const shutdown = async (signal: string): Promise<void> => {
  console.log(`Recibido ${signal}, cerrando...`);
  await app.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`Backend Grabadora escuchando en http://${config.host}:${config.port}`);
} catch (err) {
  console.error(err);
  process.exit(1);
}
