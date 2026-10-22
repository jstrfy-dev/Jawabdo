const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { withTransaction } = require('./db');

function transactionPool({ failAt, failRollback = false } = {}) {
  const calls = [];
  const client = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql === failAt || (failRollback && sql === 'ROLLBACK')) {
        throw new Error(sql === 'ROLLBACK' ? 'simulated rollback failure' : 'simulated transaction failure');
      }
      return { rows: [], rowCount: 0 };
    },
    release() { calls.push({ sql: 'RELEASE' }); },
  };
  return {
    calls,
    async connect() { return client; },
  };
}

describe('PostgreSQL transaction handling', () => {
  it('sets authenticated tenant context and commits successful work', async () => {
    const pool = transactionPool();
    const result = await withTransaction(pool, async () => 'ok', {
      userId: 'user-id',
      businessId: 'business-id',
    });
    assert.equal(result, 'ok');
    assert.deepEqual(pool.calls.map((call) => call.sql), [
      'BEGIN',
      "SELECT set_config('app.current_user_id', $1, true)",
      "SELECT set_config('app.current_business_id', $1, true)",
      'COMMIT',
      'RELEASE',
    ]);
  });

  it('rolls back and releases the connection when work fails', async () => {
    const pool = transactionPool();
    await assert.rejects(
      withTransaction(pool, async () => { throw new Error('simulated transaction failure'); }),
      /simulated transaction failure/,
    );
    assert.deepEqual(pool.calls.map((call) => call.sql), ['BEGIN', 'ROLLBACK', 'RELEASE']);
  });

  it('surfaces rollback failure alongside the original transaction error', async () => {
    const pool = transactionPool({ failRollback: true });
    await assert.rejects(
      withTransaction(pool, async () => { throw new Error('simulated transaction failure'); }),
      (error) => error instanceof AggregateError
        && error.message.includes('rollback also failed')
        && error.errors.some((cause) => cause.message === 'simulated transaction failure')
        && error.errors.some((cause) => cause.message === 'simulated rollback failure'),
    );
    assert.equal(pool.calls.at(-1).sql, 'RELEASE');
  });
});
