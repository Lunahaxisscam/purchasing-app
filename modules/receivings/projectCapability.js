// Read-only admin preflight. No cache: permission/schema changes fail closed.
export async function detectItemProjectCapability(client) {
  try {
    const { error } = await client.from('receiving_items').select('project_id').limit(0)
    if (!error) return { state: 'supported' }
    const missing = ['42703', 'PGRST204'].includes(String(error.code))
      && /project_id/i.test(String(error.message || ''))
    return { state: missing ? 'unsupported' : 'unknown' }
  } catch (_) {
    return { state: 'unknown' }
  }
}
