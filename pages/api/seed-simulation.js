import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  // KEAMANAN: endpoint maintenance ini dapat mengubah/menghapus data produksi.
  // Wajibkan token admin lewat header (x-maintenance-token) atau query ?token=.
  const MAINT_TOKEN = process.env.MAINTENANCE_TOKEN
  if (!MAINT_TOKEN) {
    return res.status(403).json({ error: 'Endpoint maintenance dinonaktifkan (MAINTENANCE_TOKEN belum diset).' })
  }
  const provided = req.headers['x-maintenance-token'] || req.query.token
  if (provided !== MAINT_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' })
  }


  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Missing supabase credentials' })
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    // 1. Ensure profile for amaravalerie32@gmail.com
    await supabase.from('profiles').upsert({
      id: '6c27d677-1687-4145-b33e-55eb1a3f3e25',
      full_name: 'Amara Valerie (Admin)',
      role: 'admin'
    })

    // 2. Fetch projects and vendors
    const { data: projects } = await supabase.from('projects').select('id, name')
    const { data: vendors } = await supabase.from('vendors').select('id, name')

    const findProj = (namePart) => projects?.find(p => p.name.toLowerCase().includes(namePart.toLowerCase()))?.id || null
    const findVend = (namePart) => vendors?.find(v => v.name.toLowerCase().includes(namePart.toLowerCase()))?.id || null

    const projSunter = findProj('Sunter') || projects?.[0]?.id
    const projMabes = findProj('Mabes') || projects?.[1]?.id
    const projBSD = findProj('BSD') || projects?.[2]?.id
    const projBaroni = findProj('Baroni') || projects?.[3]?.id
    const projPIK = findProj('PIK') || projects?.[4]?.id

    const vendA = findVend('a') || vendors?.[0]?.id
    const vendB = findVend('B') || vendors?.[1]?.id

    // 3. Clear previous simulation workflow tables
    await supabase.from('attachments').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('handovers').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('receiving_items').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('receivings').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('approval_steps').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('pr_items').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('purchase_requests').delete().neq('id', '00000000-0000-0000-0000-000000000000')

    // 4. Create 5 Purchase Requests with 5 distinct processes
    const prs = [
      {
        pr_number: 'PR-2026-0001',
        project_id: projSunter,
        priority: 'NORMAL',
        status: 'DRAFT',
        notes: 'Kebutuhan material dasar kabinet kitchen set (Draft Pengajuan Baru)'
      },
      {
        pr_number: 'PR-2026-0002',
        project_id: projMabes,
        priority: 'URGENT',
        status: 'SUBMITTED',
        notes: 'Plafon HMR & partisi studio (Menunggu Approval Direksi/PM)'
      },
      {
        pr_number: 'PR-2026-0003',
        project_id: projBSD,
        priority: 'NORMAL',
        status: 'APPROVED',
        notes: 'Sekat area basah & toilet PVC Board (PO Disetujui, OTW Kirim)'
      },
      {
        pr_number: 'PR-2026-0004',
        project_id: projBaroni,
        priority: 'NORMAL',
        status: 'APPROVED',
        notes: 'Backdrop kamar utama Triplek SF (Diterima Lengkap di Gudang Workshop)'
      },
      {
        pr_number: 'PR-2026-0005',
        project_id: projPIK,
        priority: 'NORMAL',
        status: 'APPROVED',
        notes: 'Finishing Taco HPL & lem (Selesai Serah Terima ke Mandor Lapangan)'
      }
    ]

    const { data: insertedPRs, error: prErr } = await supabase.from('purchase_requests').insert(prs).select()
    if (prErr) throw prErr

    const prMap = {}
    insertedPRs.forEach(p => { prMap[p.pr_number] = p.id })

    // 5. Approval Steps
    const approvals = [
      {
        purchase_request_id: prMap['PR-2026-0002'],
        approver_id: '6c27d677-1687-4145-b33e-55eb1a3f3e25',
        step_number: 1,
        status: 'PENDING',
        note: 'Menunggu review alokasi anggaran proyek Josh Mabes'
      },
      {
        purchase_request_id: prMap['PR-2026-0003'],
        approver_id: '6c27d677-1687-4145-b33e-55eb1a3f3e25',
        step_number: 1,
        status: 'APPROVED',
        note: 'Disetujui. Silakan PO diterbitkan ke vendor a',
        decided_at: new Date().toISOString()
      },
      {
        purchase_request_id: prMap['PR-2026-0004'],
        approver_id: '6c27d677-1687-4145-b33e-55eb1a3f3e25',
        step_number: 1,
        status: 'APPROVED',
        note: 'Disetujui sesuai kuota proyek Baroni',
        decided_at: new Date().toISOString()
      },
      {
        purchase_request_id: prMap['PR-2026-0005'],
        approver_id: '6c27d677-1687-4145-b33e-55eb1a3f3e25',
        step_number: 1,
        status: 'APPROVED',
        note: 'Disetujui untuk serah terima lapangan',
        decided_at: new Date().toISOString()
      }
    ]
    await supabase.from('approval_steps').insert(approvals)

    // 6. Receivings
    const receivings = [
      {
        purchase_request_id: prMap['PR-2026-0003'],
        vendor_id: vendA,
        delivery_note: 'PO-2026-0003',
        invoice_no: 'INV/AAN/003',
        status: 'OTW',
        note: 'Barang sedang dalam perjalanan pengiriman dari supplier',
        received_date: new Date().toISOString().split('T')[0]
      },
      {
        purchase_request_id: prMap['PR-2026-0004'],
        vendor_id: vendB,
        delivery_note: 'SJ/VB/2026/108',
        invoice_no: 'INV-2026-042',
        status: 'SELESAI',
        note: 'Barang telah tiba dan diperiksa fisik di Workshop Noir Living',
        received_date: new Date().toISOString().split('T')[0]
      },
      {
        purchase_request_id: prMap['PR-2026-0005'],
        vendor_id: vendA,
        delivery_note: 'SJ/VA/2026/099',
        invoice_no: 'INV-2026-039',
        status: 'SELESAI',
        note: 'Material telah diterima lengkap dan diteruskan ke lokasi proyek',
        received_date: new Date().toISOString().split('T')[0]
      }
    ]
    const { data: insertedRec, error: recErr } = await supabase.from('receivings').insert(receivings).select()
    if (recErr) throw recErr

    const recMap = {}
    insertedRec.forEach(r => { recMap[r.delivery_note] = r.id })

    // 7. Handovers
    const handovers = [
      {
        receiving_id: recMap['SJ/VA/2026/099'],
        project_id: projPIK,
        received_by: 'Mandor Slamet (Tim Interior PIK)',
        status: 'CONFIRMED',
        handover_date: new Date().toISOString().split('T')[0],
        note: 'Serah terima material selesai di lokasi proyek Rudy PIK tanpa cacat'
      }
    ]
    const { data: insertedHo, error: hoErr } = await supabase.from('handovers').insert(handovers).select()
    if (hoErr) throw hoErr

    // 8. Attachments (5 Dummy Files across the 5 processes)
    const attachments = [
      {
        purchase_request_id: prMap['PR-2026-0001'],
        file_name: 'PR-2026-0001_Draft_Sunter_Hijau.pdf',
        file_path: '/dummy_files/PR-2026-0001_Draft_Sunter_Hijau.pdf'
      },
      {
        purchase_request_id: prMap['PR-2026-0002'],
        file_name: 'PR-2026-0002_SPK_Approval_Mabes.pdf',
        file_path: '/dummy_files/PR-2026-0002_SPK_Approval_Mabes.pdf'
      },
      {
        purchase_request_id: prMap['PR-2026-0003'],
        receiving_id: recMap['PO-2026-0003'],
        file_name: 'PO-2026-0003_Approved_Aan_BSD.pdf',
        file_path: '/dummy_files/PO-2026-0003_Approved_Aan_BSD.pdf'
      },
      {
        purchase_request_id: prMap['PR-2026-0004'],
        receiving_id: recMap['SJ/VB/2026/108'],
        file_name: 'SJ-2026-0004_Surat_Jalan_Receiving_Baroni.pdf',
        file_path: '/dummy_files/SJ-2026-0004_Surat_Jalan_Receiving_Baroni.pdf'
      },
      {
        purchase_request_id: prMap['PR-2026-0005'],
        receiving_id: recMap['SJ/VA/2026/099'],
        handover_id: insertedHo[0]?.id,
        file_name: 'BAST-2026-0005_Handover_Rudy_PIK.pdf',
        file_path: '/dummy_files/BAST-2026-0005_Handover_Rudy_PIK.pdf'
      }
    ]
    await supabase.from('attachments').insert(attachments)

    return res.status(200).json({
      success: true,
      message: '5 Dummy files with 5 distinct processes seeded successfully!',
      processes: [
        '1. DRAFT: PR-2026-0001 (Sunter Hijau)',
        '2. MENUNGGU APPROVAL: PR-2026-0002 (Mabes)',
        '3. APPROVED / OTW: PR-2026-0003 (Aan BSD)',
        '4. RECEIVING GUDANG: PR-2026-0004 (Baroni)',
        '5. HANDOVER CONFIRMED: PR-2026-0005 (Rudy PIK)'
      ]
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
