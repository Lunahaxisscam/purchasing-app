// Probe: apakah mock .single() mengembalikan data?
const m = await import('/tmp/lean-admin-c-flow/dist/lib/supabaseClient.mjs')
m.__reset({ tables: { purchase_requests: [{ id: 'r1', pr_number: 'PR-1', title: 'T', status: 'DRAFT', notes: '', project_id: 'p1' }] } })
const b = m.supabase.from('purchase_requests').select('id, pr_number, title, status, notes, project_id').eq('id', 'r1').single()
b.then(r => {
  console.log('RESULT:', JSON.stringify(r))
  process.exit(0)
})
