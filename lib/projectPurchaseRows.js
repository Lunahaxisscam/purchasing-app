import { isPurchasedNota } from './purchaseNote'
import { receivingItemActualPrice } from '../modules/materials/acuan'

// Read-only allocation. Never infer projects by a matching display name.
export function resolvePurchaseProjects({ projects = [], requests = [], prItems = [], receivings = [], receivingItems = [] } = {}) {
  const projectIds = new Set(projects.map(p => p.id))
  const requestById = new Map(requests.map(p => [p.id, p]))
  const itemById = new Map(prItems.map(p => [p.id, p]))
  const headerById = new Map(receivings.map(p => [p.id, p]))
  const known = new Map()
  const issues = new Map()
  for (const line of receivingItems) {
    const item = line.pr_item_id ? itemById.get(line.pr_item_id) : null
    const request = item ? requestById.get(item.pr_id) : null
    const linkedProject = item?.project_id || request?.project_id || null
    let issue = line.pr_item_id && (!item || !request) ? 'Relasi PR tidak tersedia' : null
    if (item?.project_id && request?.project_id && item.project_id !== request.project_id) issue = 'Proyek item PR bertentangan dengan header PR'
    if (line.project_id && linkedProject && line.project_id !== linkedProject) issue = 'Proyek baris bertentangan dengan PR'
    const projectId = line.project_id || linkedProject
    if (projectId && !projectIds.has(projectId)) issue = 'Proyek tidak tersedia'
    if (issue) issues.set(line, issue)
    else if (projectId) known.set(line, projectId)
  }
  const allocations = new Map()
  for (const line of receivingItems) {
    if (issues.has(line)) continue
    if (known.has(line)) { allocations.set(line, known.get(line)); continue }
    const header = headerById.get(line.receiving_id)
    if (!header?.project_id) { issues.set(line, 'Belum teralokasi ke proyek'); continue }
    const siblings = receivingItems.filter(x => x.receiving_id === line.receiving_id)
    const ambiguous = siblings.some(x => issues.has(x) || (known.has(x) && known.get(x) !== header.project_id))
    if (!projectIds.has(header.project_id) || ambiguous) { issues.set(line, 'Proyek header ambigu atau tidak tersedia'); continue }
    allocations.set(line, header.project_id)
  }
  return { allocations, issues, itemById, requestById, headerById }
}

export function buildProjectPurchaseRows(input = {}) {
  const { receivingItems = [] } = input
  const resolved = resolvePurchaseProjects(input)
  const groups = new Map(), diagnostics = [], seen = new Set()
  for (const line of receivingItems) {
    const header = resolved.headerById.get(line.receiving_id)
    if (!isPurchasedNota(header)) continue
    if (line.id && seen.has(line.id)) continue
    if (line.id) seen.add(line.id)
    const projectId = resolved.allocations.get(line)
    const quantity = Number(line.quantity_received)
    const price = receivingItemActualPrice(line)
    const issue = resolved.issues.get(line) || (!Number.isFinite(quantity) || quantity <= 0 ? 'Jumlah aktual tidak valid' : price === null ? 'Harga aktual belum tersedia' : null)
    if (issue) diagnostics.push({ id: line.id, projectId, message: issue, itemName: line.item_name || '—' })
    if (!projectId || !Number.isFinite(quantity) || quantity <= 0) continue
    const item = resolved.itemById.get(line.pr_item_id)
    const request = item && resolved.requestById.get(item.pr_id)
    const key = `${projectId}:${line.pr_item_id || `direct:${line.id || receivingItems.indexOf(line)}`}`
    const row = groups.get(key) || { id: key, projectId, prNumber: request?.pr_number || '—', itemName: item?.item_name || line.item_name || '—', total: 0, incomplete: false, lineCount: 0 }
    row.lineCount++
    if (price === null) row.incomplete = true
    else row.total += quantity * price
    groups.set(key, row)
  }
  const rows = [...groups.values()].map(row => ({ ...row, total: Math.round(row.total) }))
  return { rows, diagnostics, forProject: id => rows.filter(row => row.projectId === id) }
}
