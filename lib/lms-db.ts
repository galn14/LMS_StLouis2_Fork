
import { Pool } from 'pg';

// Use LMS_POSTGRES_URL if available (for separate DB architecture), 
// otherwise fall back to DATABASE_URL (monolith architecture)
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('Missing LMS_POSTGRES_URL or DATABASE_URL environment variable');
}

const lmsPool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

/**
 * Executes a read-only SELECT query against the LMS database.
 * Throws an error if the query attempts to modify data.
 * 
 * @param sql The SQL query string
 * @param params Optional parameters for the query
 * @returns Array of rows
 */
export async function queryLMS<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const cleanSql = sql.trim().toUpperCase();
  
  // Basic security check to prevent write operations
  if (
    cleanSql.startsWith('INSERT') || 
    cleanSql.startsWith('UPDATE') || 
    cleanSql.startsWith('DELETE') ||
    cleanSql.startsWith('DROP') ||
    cleanSql.startsWith('ALTER') ||
    cleanSql.startsWith('TRUNCATE')
  ) {
    throw new Error('Only SELECT queries are allowed on the LMS database via this client.');
  }

  const client = await lmsPool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}
