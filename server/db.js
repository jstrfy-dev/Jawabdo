const { Pool } = require('pg');

function createPool(config) {
  return new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: true } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
    application_name: 'jawabdo-api',
  });
}

async function withTransaction(pool, callback, options = {}) {
  const client = await pool.connect();
  try {
    await client.query(options.readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
    if (options.userId) {
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [options.userId]);
    }
    if (options.businessId) {
      await client.query("SELECT set_config('app.current_business_id', $1, true)", [options.businessId]);
    }
    if (options.worker) {
      await client.query("SELECT set_config('app.is_worker', 'true', true)");
    }
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function resolveMembership(pool, userId, businessId) {
  return withTransaction(pool, async (client) => {
    const result = await client.query(
      `SELECT role FROM business_memberships
       WHERE business_id = $1 AND user_id = $2`,
      [businessId, userId],
    );
    return result.rows[0]?.role || null;
  }, { userId, businessId });
}

module.exports = { createPool, withTransaction, resolveMembership };
