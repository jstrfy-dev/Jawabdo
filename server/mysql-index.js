const { createMysqlServer } = require('./mysql-api');
const { createMysqlPool } = require('./mysql-db');
const { readMysqlConfig } = require('./config');

async function main() {
  const config = readMysqlConfig();
  const pool = createMysqlPool(config);
  try {
    await pool.query('SELECT 1');
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS table_count FROM information_schema.tables
       WHERE table_schema=? AND table_name IN
       ('app_users','businesses','business_memberships','services','service_prices','business_hours',
        'business_faqs','whatsapp_connections','customers','conversations','messages','appointments',
        'reminder_jobs','webhook_events','whatsapp_delivery_statuses','signup_sessions')`,
      [config.databaseName],
    );
    if (Number(rows[0]?.table_count) !== 16) {
      throw new Error('JawabDo MySQL schema is incomplete. Import database/jawabdo.sql before starting the API.');
    }
  } catch (error) {
    await pool.end();
    throw error;
  }

  const logger = {
    error: (event) => console.error(JSON.stringify(event)),
  };
  const server = createMysqlServer(config, pool, { logger });
  server.listen(config.port, '0.0.0.0', () => {
    console.info(JSON.stringify({ event: 'jawabdo_mysql_api_listening', port: config.port }));
  });

  const shutdown = () => {
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
  console.error(JSON.stringify({
    event: 'mysql_server_startup_failed',
    message: error.message,
    errorCode: error.code || null,
  }));
  process.exitCode = 1;
});
