const { createApiHandler } = require('./api');
const { createWhatsAppServer } = require('./app');
const { createPool } = require('./db');
const { readProductionConfig } = require('./config');
const { enqueueWebhookPayload } = require('./webhook');
const { startWorker } = require('./worker');
const { assertProductionDatabaseReady } = require('./production-readiness');

async function main() {
  const config = readProductionConfig();
  const pool = createPool(config);
  try {
    await pool.query('SELECT 1');
    await assertProductionDatabaseReady(pool);
    const schema = await pool.query(
      `SELECT to_regclass('businesses') AS businesses,
        to_regclass('whatsapp_delivery_statuses') AS delivery_statuses`,
    );
    if (!schema.rows[0]?.businesses || !schema.rows[0]?.delivery_statuses) {
      throw new Error('Database schema is missing. Run npm run db:migrate before starting the API.');
    }
  } catch (error) {
    try {
      await pool.end();
    } catch (shutdownError) {
      throw new AggregateError(
        [error, shutdownError],
        'PostgreSQL startup checks failed and the connection pool could not close.',
      );
    }
    throw error;
  }

  const logger = {
    info: (event) => console.info(JSON.stringify(event)),
    error: (event) => console.error(JSON.stringify(event)),
  };
  const apiHandler = createApiHandler(config, pool, { logger });
  const stopWorker = startWorker(pool, config, { logger });
  const server = createWhatsAppServer(config, {
    apiHandler,
    logger,
    health: async () => {
      await pool.query('SELECT 1');
      return { database: 'ok' };
    },
    processWebhook: (payload) => enqueueWebhookPayload(pool, payload, logger),
  });

  server.listen(config.port, '0.0.0.0', () => {
    logger.info({ event: 'jawabdo_api_listening', port: config.port });
  });

  const shutdown = () => {
    stopWorker();
    server.close((error) => {
      if (error) {
        logger.error({ event: 'server_shutdown_failed' });
        process.exitCode = 1;
      }
      void pool.end();
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'server_startup_failed', message: error.message }));
  process.exitCode = 1;
});
