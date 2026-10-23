// PR workflow boundary. Status is read fresh before existing edit paths write.
export function canEditRequest(pr) {
  return ['DRAFT', 'REVISI'].includes(String(pr?.status || '').toUpperCase())
}
export function isActiveRequest(pr) {
  return ['DRAFT', 'REVISI', 'SUBMITTED', 'APPROVED'].includes(String(pr?.status || '').toUpperCase()) && !/\[\s*Tutup\s*:/i.test(String(pr?.notes || ''))
}
export async function verifyRequestEditable(client, id) {
  if (!id) return {ok:false,error:'PR tidak dikenal.'}
  const {data,error}=await client.from('purchase_requests').select('id,status,notes').eq('id',id).single()
  if(error || !data) return {ok:false,error:error?.message || 'PR tidak ditemukan.'}
  if(!canEditRequest(data)) return {ok:false,error:'PR terkunci. Kembalikan ke PR dari modul Pembelian sebelum mengedit.'}
  return {ok:true,request:data}
}
// The RPC serializes return vs purchase and never deletes previously bought lines.
export async function returnRequestToPr(client,pr,{reason='',confirmFn}={}) {
  if(!client || !pr?.id) return {ok:false,error:'PR tidak dikenal.'}
  const text=String(reason).trim()
  if(!text) return {ok:false,error:'Alasan pengembalian wajib diisi.'}
  if(confirmFn && !confirmFn(`Kembalikan ${pr.pr_number || 'PR'} untuk revisi? Riwayat pembelian tetap disimpan.`)) return {ok:false,cancelled:true}
  const {data,error}=await client.rpc('pr_return_for_revision',{p_pr_id:pr.id,p_reason:text})
  if(error || !data?.ok) return {ok:false,error:error?.message || data?.error || 'Pengembalian PR ditolak.'}
  const {data:check,error:readError}=await client.from('purchase_requests').select('id,status').eq('id',pr.id).single()
  if(readError || check?.status!=='REVISI') return {ok:false,error:'Status pengembalian belum dapat diverifikasi. Muat ulang sebelum mencoba lagi.'}
  return {ok:true,already:!!data.already}
}
