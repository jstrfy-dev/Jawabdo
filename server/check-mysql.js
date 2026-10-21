const { createMysqlPool } = require('./mysql-db');
const { readMysqlConfig } = require('./config');

async function main() {
  const pool = createMysqlPool(readMysqlConfig());
  try {
    await pool.query('SELECT 1');
    console.info('MySQL connection is ready.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`MySQL connection failed (${error.code || 'connection_error'}). Check that XAMPP MySQL is running and MYSQL_* settings match your local account.`);
  process.exitCode = 1;
});
