import { Client } from 'pg'

export default async function handler(req, res) {
  const connectionString = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING
  if (!connectionString) {
    return res.status(500).json({ error: 'No POSTGRES_URL' })
  }
  try {
    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false }
    })
    await client.connect()
    const { rows } = await client.query(`
      select table_name, column_name, data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public'
      order by table_name, ordinal_position;
    `)
    await client.end()
    return res.status(200).json({ columns: rows })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
