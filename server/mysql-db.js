const mysql = require('mysql2/promise');

function createMysqlPool(config) {
  return mysql.createPool({
    host: config.databaseHost,
    port: config.databasePort,
    database: config.databaseName,
    user: config.databaseUser,
    password: config.databasePassword,
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0,
    connectTimeout: 5000,
    timezone: 'Z',
    dateStrings: true,
    charset: 'utf8mb4',
  });
}

async function withMysqlTransaction(pool, callback) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { createMysqlPool, withMysqlTransaction };
