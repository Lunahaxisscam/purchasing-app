// ============================================================
// modules/requests/field-form/templateData.js
// ============================================================
// Skema data statis Form Pengadaan Barang Lapangan (2 halaman A4)
// Dipetakan langsung dari form-pengadaan-lapangan-template.pdf:
// 4 Kelompok Besar: Kebutuhan Dasar, Finishing, Aksesoris, Produksi.
// Setiap baris memiliki stable unique row ID agar baris berulang
// (mis. Melamin SF 6mm, Taco, Edging) tidak saling menimpa.
// ============================================================

export const FIELD_FORM_SECTIONS = [
  {
    id: 'KEBUTUHAN_DASAR',
    title: 'Kebutuhan Dasar',
    icon: '🪵',
    page: 1,
    tables: [
      {
        id: 'kd_triplek',
        name: 'Triplek',
        unit: 'Lbr',
        categoryHint: 'Plywood & Board',
        columns: ['Triplek', 'Ukuran', 'Qty (Lbr)', 'Remarks'],
        rows: [
          { id: 'kd_triplek_polos_18mm', label: 'Triplek', spec: 'Polos', type: '18 mm', unit: 'Lbr' },
          { id: 'kd_triplek_polos_15mm', label: 'Triplek', spec: 'Polos', type: '15 mm', unit: 'Lbr' },
          { id: 'kd_triplek_polos_12mm', label: 'Triplek', spec: 'Polos', type: '12 mm', unit: 'Lbr' },
          { id: 'kd_triplek_polos_9mm', label: 'Triplek', spec: 'Polos', type: '9 mm', unit: 'Lbr' },
          { id: 'kd_triplek_polos_6mm', label: 'Triplek', spec: 'Polos', type: '6 mm', unit: 'Lbr' },
          { id: 'kd_triplek_polos_3mm', label: 'Triplek', spec: 'Polos', type: '3 mm', unit: 'Lbr' },
          { id: 'kd_triplek_melamin_df_18mm', label: 'Triplek', spec: 'Melamin DF', type: '18 mm', unit: 'Lbr' },
          { id: 'kd_triplek_melamin_df_15mm', label: 'Triplek', spec: 'Melamin DF', type: '15 mm', unit: 'Lbr' },
          { id: 'kd_triplek_melamin_sf_18mm', label: 'Triplek', spec: 'Melamin SF', type: '18 mm', unit: 'Lbr' },
          { id: 'kd_triplek_melamin_sf_15mm', label: 'Triplek', spec: 'Melamin SF', type: '15 mm', unit: 'Lbr' },
          { id: 'kd_triplek_melamin_sf_12mm', label: 'Triplek', spec: 'Melamin SF', type: '12 mm', unit: 'Lbr' },
          { id: 'kd_triplek_melamin_sf_9mm', label: 'Triplek', spec: 'Melamin SF', type: '9 mm', unit: 'Lbr' },
          { id: 'kd_triplek_melamin_sf_6mm_1', label: 'Triplek', spec: 'Melamin SF', type: '6 mm', unit: 'Lbr' },
          { id: 'kd_triplek_melamin_sf_6mm_2', label: 'Triplek', spec: 'Melamin SF', type: '6 mm', unit: 'Lbr' }
        ]
      },
      {
        id: 'kd_blockboard',
        name: 'Blockboard',
        unit: 'Lbr',
        categoryHint: 'Plywood & Board',
        columns: ['Blockboard', 'Ukuran', 'Qty (Lbr)', 'Remarks'],
        rows: [
          { id: 'kd_blockboard_polos_18mm', label: 'Blockboard', spec: 'Polos', type: '18 mm', unit: 'Lbr' },
          { id: 'kd_blockboard_polos_15mm', label: 'Blockboard', spec: 'Polos', type: '15 mm', unit: 'Lbr' },
          { id: 'kd_blockboard_custom_1', label: 'Blockboard', spec: '', type: '', unit: 'Lbr', isCustom: true },
          { id: 'kd_blockboard_melamin_df_18mm', label: 'Blockboard', spec: 'Melamin DF', type: '18 mm', unit: 'Lbr' },
          { id: 'kd_blockboard_melamin_df_15mm', label: 'Blockboard', spec: 'Melamin DF', type: '15 mm', unit: 'Lbr' },
          { id: 'kd_blockboard_melamin_sf_18mm', label: 'Blockboard', spec: 'Melamin SF', type: '18 mm', unit: 'Lbr' },
          { id: 'kd_blockboard_melamin_sf_15mm', label: 'Blockboard', spec: 'Melamin SF', type: '15 mm', unit: 'Lbr' }
        ]
      },
      {
        id: 'kd_mdf_hijau',
        name: 'MDF Hijau',
        unit: 'Lbr',
        categoryHint: 'Plywood & Board',
        columns: ['MDF Hijau', 'Ukuran', 'Qty (Lbr)', 'Remarks'],
        rows: [
          { id: 'kd_mdf_hijau_18mm', label: 'MDF Hijau', spec: 'MDF Hijau', type: '18 mm', unit: 'Lbr' },
          { id: 'kd_mdf_hijau_15mm', label: 'MDF Hijau', spec: 'MDF Hijau', type: '15 mm', unit: 'Lbr' },
          { id: 'kd_mdf_hijau_12mm', label: 'MDF Hijau', spec: 'MDF Hijau', type: '12 mm', unit: 'Lbr' },
          { id: 'kd_mdf_hijau_9mm', label: 'MDF Hijau', spec: 'MDF Hijau', type: '9 mm', unit: 'Lbr' },
          { id: 'kd_mdf_hijau_6mm', label: 'MDF Hijau', spec: 'MDF Hijau', type: '6 mm', unit: 'Lbr' },
          { id: 'kd_mdf_hijau_3mm', label: 'MDF Hijau', spec: 'MDF Hijau', type: '3 mm', unit: 'Lbr' },
          { id: 'kd_mdf_custom_1', label: 'MDF Hijau', spec: '', type: '', unit: 'Lbr', isCustom: true },
          { id: 'kd_mdf_bending_9mm', label: 'Bending', spec: 'Bending', type: '9 mm', unit: 'Lbr' },
          { id: 'kd_mdf_custom_2', label: 'MDF Hijau', spec: '', type: '', unit: 'Lbr', isCustom: true },
          { id: 'kd_mdf_custom_3', label: 'MDF Hijau', spec: '', type: '', unit: 'Lbr', isCustom: true }
        ]
      },
      {
        id: 'kd_hpl',
        name: 'HPL',
        unit: 'Lbr',
        categoryHint: 'HPL & Edging',
        columns: ['HPL', 'Kode', 'Qty (Lbr)', 'Remarks'],
        rows: [
          { id: 'kd_hpl_taco_1', label: 'HPL', brand: 'Taco', type: '', unit: 'Lbr', isHpl: true },
          { id: 'kd_hpl_taco_2', label: 'HPL', brand: 'Taco', type: '', unit: 'Lbr', isHpl: true },
          { id: 'kd_hpl_taco_3', label: 'HPL', brand: 'Taco', type: '', unit: 'Lbr', isHpl: true },
          { id: 'kd_hpl_custom_1', label: 'HPL', brand: '', type: '', unit: 'Lbr', isCustom: true },
          { id: 'kd_hpl_carta_1', label: 'HPL', brand: 'Carta', type: '', unit: 'Lbr', isHpl: true },
          { id: 'kd_hpl_custom_2', label: 'HPL', brand: '', type: '', unit: 'Lbr', isCustom: true },
          { id: 'kd_hpl_aica_1', label: 'HPL', brand: 'Aica', type: '', unit: 'Lbr', isHpl: true }
        ]
      },
      {
        id: 'kd_edging',
        name: 'Edging',
        unit: 'Mtr',
        categoryHint: 'HPL & Edging',
        columns: ['Edging', 'Type', 'Qty (Mtr)', 'Remarks'],
        rows: [
          { id: 'kd_edging_4cm_1', label: 'Edging', type: 'Uk. 4 cm', unit: 'Mtr' },
          { id: 'kd_edging_2cm_1', label: 'Edging', type: 'Uk. 2 cm', unit: 'Mtr' },
          { id: 'kd_edging_4cm_2', label: 'Edging', type: 'Uk. 4 cm', unit: 'Mtr' },
          { id: 'kd_edging_2cm_2', label: 'Edging', type: 'Uk. 2 cm', unit: 'Mtr' },
          { id: 'kd_edging_4cm_3', label: 'Edging', type: 'Uk. 4 cm', unit: 'Mtr' }
        ]
      }
    ]
  },
  {
    id: 'KEBUTUHAN_FINISHING',
    title: 'Kebutuhan Finishing',
    icon: '✨',
    page: 1,
    tables: [
      {
        id: 'kf_tacosheet',
        name: 'Tacosheet',
        unit: 'Mtr',
        categoryHint: 'HPL & Edging',
        columns: ['Tacosheet', 'Kode', 'Qty (Mtr)', 'Remarks'],
        rows: [
          { id: 'kf_tacosheet_taco_1', label: 'Tacosheet', brand: 'Taco', type: '', unit: 'Mtr' },
          { id: 'kf_tacosheet_taco_2', label: 'Tacosheet', brand: 'Taco', type: '', unit: 'Mtr' },
          { id: 'kf_tacosheet_custom_1', label: 'Tacosheet', brand: '', type: '', unit: 'Mtr', isCustom: true }
        ]
      },
      {
        id: 'kf_wpc',
        name: 'WPC',
        unit: 'Btg',
        categoryHint: 'Plywood & Board',
        columns: ['WPC', 'Type', 'Qty (Btg)', 'Remarks'],
        rows: [
          { id: 'kf_wpc_24mm', label: 'WPC', type: 'WPC 24mm', unit: 'Btg' },
          { id: 'kf_wpc_10mm', label: 'WPC', type: 'WPC 10mm', unit: 'Btg' },
          { id: 'kf_wpc_custom_1', label: 'WPC', type: '', unit: 'Btg', isCustom: true },
          { id: 'kf_wpc_siku_l', label: 'WPC', type: 'Siku L', unit: 'Btg' }
        ]
      },
      {
        id: 'kf_kaca',
        name: 'Kaca',
        unit: 'Lbr',
        categoryHint: 'Hardware & Fitting',
        columns: ['Kaca', 'Type', 'Qty (Lbr)', 'Remarks'],
        rows: [
          { id: 'kf_kaca_clear_5mm', label: 'Kaca', type: 'Kaca Clear 5mm', unit: 'Lbr' },
          { id: 'kf_kaca_cermin_5mm', label: 'Kaca', type: 'Kaca Cermin 5mm', unit: 'Lbr' },
          { id: 'kf_kaca_custom_1', label: 'Kaca', type: '', unit: 'Lbr', isCustom: true },
          { id: 'kf_kaca_custom_2', label: 'Kaca', type: '', unit: 'Lbr', isCustom: true }
        ]
      },
      {
        id: 'kf_solidsurface',
        name: 'Solid Surface',
        unit: 'Buah',
        categoryHint: 'Bahan Habis Pakai',
        columns: ['Solid Surface', 'Type', 'Qty (Buah)', 'Remarks'],
        rows: [
          { id: 'kf_solidsurface_top_table', label: 'Solid Surface', type: 'Top Table', unit: 'Buah' },
          { id: 'kf_solidsurface_custom_1', label: 'Solid Surface', type: '', unit: 'Buah', isCustom: true },
          { id: 'kf_solidsurface_custom_2', label: 'Solid Surface', type: '', unit: 'Buah', isCustom: true }
        ]
      },
      {
        id: 'kf_engsel_sendok',
        name: 'Engsel Sendok',
        unit: 'Psg',
        categoryHint: 'Hardware & Fitting',
        columns: ['Engsel Sendok', 'Type', 'Qty (Psg)', 'Remarks'],
        rows: [
          { id: 'kf_engsel_sendok_lurus', label: 'Engsel Sendok', brand: 'Hafele / Taco', type: 'Lurus', unit: 'Psg' },
          { id: 'kf_engsel_sendok_set_bkk', label: 'Engsel Sendok', brand: 'Hafele / Taco', type: 'Set BKK', unit: 'Psg' },
          { id: 'kf_engsel_sendok_full_bkk', label: 'Engsel Sendok', brand: 'Hafele / Taco', type: 'Full BKK', unit: 'Psg' },
          { id: 'kf_engsel_sendok_custom_1', label: 'Engsel Sendok', type: '', unit: 'Psg', isCustom: true },
          { id: 'kf_engsel_frame_efa0', label: 'Engsel Frame', type: 'EFA 0 - Lurus', unit: 'Psg' },
          { id: 'kf_engsel_frame_efa8', label: 'Engsel Frame', type: 'EFA 8 - Set BKK', unit: 'Psg' },
          { id: 'kf_engsel_frame_efa16', label: 'Engsel Frame', type: 'EFA 16 - Full BKK', unit: 'Psg' }
        ]
      },
      {
        id: 'kf_engsel_robot',
        name: 'Engsel Robot',
        unit: 'Pcs',
        categoryHint: 'Hardware & Fitting',
        columns: ['Engsel Robot', 'Type', 'Qty (Pcs)', 'Remarks'],
        rows: [
          { id: 'kf_engsel_robot_lurus', label: 'Engsel Robot', brand: 'Femarg', type: 'Lurus', unit: 'Pcs' },
          { id: 'kf_engsel_robot_set_bkk', label: 'Engsel Robot', brand: 'Femarg', type: 'Set BKK', unit: 'Pcs' },
          { id: 'kf_engsel_robot_full_bkk', label: 'Engsel Robot', brand: 'Femarg', type: 'Full BKK', unit: 'Pcs' },
          { id: 'kf_engsel_robot_custom_1', label: 'Engsel Robot', type: '', unit: 'Pcs', isCustom: true },
          { id: 'kf_engsel_concealed', label: 'Engsel Concealed', type: '', unit: 'Pcs' },
          { id: 'kf_engsel_pivot', label: 'Engsel Pivot', type: 'Pintu / Kaca', unit: 'Pcs' },
          { id: 'kf_engsel_robot_custom_2', label: 'Engsel Robot', type: '', unit: 'Pcs', isCustom: true },
          { id: 'kf_engsel_sendok_kaca', label: 'Engsel Sendok Kaca', type: '', unit: 'Pcs' }
        ]
      },
      {
        id: 'kf_rel_laci',
        name: 'Rel Laci',
        unit: 'Psg',
        categoryHint: 'Hardware & Fitting',
        columns: ['Rel Laci', 'Type', 'Qty (Psg)', 'Remarks'],
        rows: [
          { id: 'kf_rel_tandem_25cm', label: 'Rel Laci Tandem', type: '25 cm', unit: 'Psg' },
          { id: 'kf_rel_tandem_30cm', label: 'Rel Laci Tandem', type: '30 cm', unit: 'Psg' },
          { id: 'kf_rel_tandem_35cm', label: 'Rel Laci Tandem', type: '35 cm', unit: 'Psg' },
          { id: 'kf_rel_tandem_40cm', label: 'Rel Laci Tandem', type: '40 cm', unit: 'Psg' },
          { id: 'kf_rel_tandem_45cm', label: 'Rel Laci Tandem', type: '45 cm', unit: 'Psg' },
          { id: 'kf_rel_tandem_50cm', label: 'Rel Laci Tandem', type: '50 cm', unit: 'Psg' },
          { id: 'kf_rel_custom_1', label: 'Rel Laci', type: '', unit: 'Psg', isCustom: true },
          { id: 'kf_rel_dt_20cm', label: 'Rel Laci Doubletrack', type: '20 cm', unit: 'Psg' },
          { id: 'kf_rel_dt_25cm', label: 'Rel Laci Doubletrack', type: '25 cm', unit: 'Psg' },
          { id: 'kf_rel_dt_30cm', label: 'Rel Laci Doubletrack', type: '30 cm', unit: 'Psg' },
          { id: 'kf_rel_dt_35cm', label: 'Rel Laci Doubletrack', type: '35 cm', unit: 'Psg' },
          { id: 'kf_rel_dt_40cm', label: 'Rel Laci Doubletrack', type: '40 cm', unit: 'Psg' },
          { id: 'kf_rel_dt_45cm', label: 'Rel Laci Doubletrack', type: '45 cm', unit: 'Psg' },
          { id: 'kf_rel_dt_50cm', label: 'Rel Laci Doubletrack', type: '50 cm', unit: 'Psg' }
        ]
      }
    ]
  },
  {
    id: 'KEBUTUHAN_AKSESORIS',
    title: 'Kebutuhan Aksesoris',
    icon: '💡',
    page: 2,
    tables: [
      {
        id: 'aks_kelistrikan_led',
        name: 'Kelistrikan - LED',
        unit: 'Mtr',
        categoryHint: 'Kelistrikan & Lampu',
        columns: ['Kelistrikan', 'Type', 'Qty (Mtr)', 'Remarks'],
        rows: [
          { id: 'aks_kelistrikan_led_3000k', label: 'LED Strip', type: '3000k (WW)', unit: 'Mtr' },
          { id: 'aks_kelistrikan_led_4000k', label: 'LED Strip', type: '4000k (NW)', unit: 'Mtr' },
          { id: 'aks_kelistrikan_led_6000k', label: 'LED Strip', type: '6000K (W)', unit: 'Mtr' },
          { id: 'aks_kelistrikan_led_jelly', label: 'LED Jelly', type: '', unit: 'Mtr' }
        ]
      },
      {
        id: 'aks_kelistrikan_lampu',
        name: 'Kelistrikan - Lampu',
        unit: 'Pcs',
        categoryHint: 'Kelistrikan & Lampu',
        columns: ['Kelistrikan', 'Type', 'Qty (Pcs)', 'Remarks'],
        rows: [
          { id: 'aks_kelistrikan_lampu_downlight', label: 'Lampu Downlight', type: '', unit: 'Pcs' },
          { id: 'aks_kelistrikan_lampu_spotlight', label: 'Lampu Spotlight', type: '', unit: 'Pcs' },
          { id: 'aks_kelistrikan_lampu_biasa', label: 'Lampu', type: '', unit: 'Pcs' }
        ]
      },
      {
        id: 'aks_kelistrikan_trafo',
        name: 'Kelistrikan - Trafo',
        unit: 'Pcs',
        categoryHint: 'Kelistrikan & Lampu',
        columns: ['Kelistrikan', 'Type', 'Qty (Pcs)', 'Remarks'],
        rows: [
          { id: 'aks_kelistrikan_trafo_3a', label: 'Trafo', type: '3A', unit: 'Pcs' },
          { id: 'aks_kelistrikan_trafo_5a', label: 'Trafo', type: '5A', unit: 'Pcs' },
          { id: 'aks_kelistrikan_trafo_10a', label: 'Trafo', type: '10A', unit: 'Pcs' },
          { id: 'aks_kelistrikan_trafo_12a', label: 'Trafo', type: '12A', unit: 'Pcs' }
        ]
      },
      {
        id: 'aks_kelistrikan_saklar',
        name: 'Kelistrikan - Saklar & Stop Kontak',
        unit: 'Pcs',
        categoryHint: 'Kelistrikan & Lampu',
        columns: ['Kelistrikan', 'Type', 'Qty (Pcs)', 'Remarks'],
        rows: [
          { id: 'aks_kelistrikan_rulam_sayap', label: 'Rulam - Sayap', type: 'Hitam / Putih', unit: 'Pcs' },
          { id: 'aks_kelistrikan_rulam_non_sayap', label: 'Rulam - Non Sayap', type: 'Hitam / Putih', unit: 'Pcs' },
          { id: 'aks_kelistrikan_stop_kontak', label: 'Stop Kontak', type: '', unit: 'Pcs' },
          { id: 'aks_kelistrikan_saklar_led_bulat', label: 'Saklar LED Bulat', type: 'Hitam / Putih', unit: 'Pcs' },
          { id: 'aks_kelistrikan_saklar_1gang', label: 'Saklar 1 Gang', type: '', unit: 'Pcs' },
          { id: 'aks_kelistrikan_saklar_2gang', label: 'Saklar 2 Gang', type: '', unit: 'Pcs' },
          { id: 'aks_kelistrikan_saklar_3gang', label: 'Saklar 3 Gang', type: '', unit: 'Pcs' }
        ]
      },
      {
        id: 'aks_kelistrikan_kabel',
        name: 'Kelistrikan - Kabel',
        unit: 'Mtr',
        categoryHint: 'Kelistrikan & Lampu',
        columns: ['Kelistrikan', 'Type', 'Qty (Mtr)', 'Remarks'],
        rows: [
          { id: 'aks_kelistrikan_kabel_led', label: 'Kabel LED', type: '', unit: 'Mtr' },
          { id: 'aks_kelistrikan_kabel_2x075', label: 'Kabel Listrik', type: '2 X 0,75', unit: 'Mtr' },
          { id: 'aks_kelistrikan_kabel_2x15', label: 'Kabel Listrik', type: '2 X 1,5', unit: 'Mtr' },
          { id: 'aks_kelistrikan_kabel_3x15', label: 'Kabel Listrik', type: '3 X 1,5', unit: 'Mtr' }
        ]
      },
      {
        id: 'aks_hardware',
        name: 'Akssesories Hardware',
        unit: 'Pcs',
        categoryHint: 'Hardware & Fitting',
        columns: ['Akssesories', 'Type', 'Qty (Pcs)', 'Remarks'],
        rows: [
          { id: 'aks_hardware_rak_sendok', label: 'Rak Sendok', type: '', unit: 'Pcs' },
          { id: 'aks_hardware_rak_piring_huben', label: 'Rak Piring - Huben', type: '', unit: 'Pcs' },
          { id: 'aks_hardware_rak_panci_hafele', label: 'Rak Panci - Hafele', type: '', unit: 'Pcs' },
          { id: 'aks_hardware_rak_botol', label: 'Rak Botol', type: '', unit: 'Pcs' },
          { id: 'aks_hardware_handle_alu', label: 'Handle Alu', type: '', unit: 'Pcs', categoryHint: 'Aluminium & Profil' },
          { id: 'aks_hardware_frame_alu', label: 'Frame Alu', type: '', unit: 'Pcs', categoryHint: 'Aluminium & Profil' },
          { id: 'aks_hardware_plat_siku_l', label: 'Plat Siku Frame (L)', type: '', unit: 'Pcs' },
          { id: 'aks_hardware_baut_siku_frame', label: 'Baut Siku Frame', type: '', unit: 'Pcs' },
          { id: 'aks_hardware_hanger_oval', label: 'Hanger Stainless Oval', type: '', unit: 'Pcs' },
          { id: 'aks_hardware_bracket_hanger', label: 'Bracket Hanger', type: '', unit: 'Pcs' },
          { id: 'aks_hardware_lubang_hawa_plastik', label: 'Lubang Hawa Plastik', type: '', unit: 'Pcs' },
          { id: 'aks_hardware_lubang_hawa_stainless', label: 'Lubang Hawa Stainless', type: '', unit: 'Pcs' },
          { id: 'aks_hardware_lubang_gromet_bulat', label: 'Lubang Gromet Bulat', type: '', unit: 'Pcs' },
          { id: 'aks_hardware_lubang_gromet_kotak', label: 'Lubang Gromet Kotak', type: '', unit: 'Pcs' },
          { id: 'aks_hardware_kunci_laci_plat_l', label: 'Kunci Laci + Plat L', type: '', unit: 'Pcs' },
          { id: 'aks_hardware_hidrolik_gasspring', label: 'Hidrolik / Gasspring', type: '', unit: 'Pcs' },
          { id: 'aks_hardware_push_on_pintu', label: 'Push On Pintu', type: '', unit: 'Pcs' },
          { id: 'aks_hardware_magnet_push_on_kaca', label: 'Magnet Push on kaca', type: '', unit: 'Pcs' },
          { id: 'aks_hardware_list_t', label: 'List T', type: '', unit: 'Pcs', categoryHint: 'Aluminium & Profil' },
          { id: 'aks_hardware_list_u', label: 'List U', type: '', unit: 'Pcs', categoryHint: 'Aluminium & Profil' },
          { id: 'aks_hardware_bracket_meja_lipat', label: 'Bracket Meja Lipat', type: '', unit: 'Pcs' },
          { id: 'aks_hardware_handle_lemari', label: 'Handle Lemari', type: '', unit: 'Pcs' },
          { id: 'aks_hardware_set_roda_sliding_slowmotion', label: 'Set Roda Pintu Sliding', type: 'Slowmotion', unit: 'Pcs' },
          { id: 'aks_hardware_roda_sliding_huben_3141', label: 'Roda Sliding - Huben', type: 'SD 3141', unit: 'Pcs' },
          { id: 'aks_hardware_rel_sliding_huben_atas', label: 'Rel Sliding - Huben', type: 'SD 02 - U (Atas)', unit: 'Pcs', categoryHint: 'Aluminium & Profil' },
          { id: 'aks_hardware_rel_sliding_huben_bawah', label: 'Rel Sliding - Huben', type: 'SD 02 - M (Bawah)', unit: 'Pcs', categoryHint: 'Aluminium & Profil' },
          { id: 'aks_hardware_kapstock', label: 'Kapstock', type: '', unit: 'Pcs' }
        ]
      }
    ]
  },
  {
    id: 'KEBUTUHAN_PRODUKSI',
    title: 'Kebutuhan Produksi',
    icon: '🔨',
    page: 2,
    tables: [
      {
        id: 'prod_barang',
        name: 'Kebutuhan Produksi / Workshop',
        unit: 'Pcs',
        categoryHint: 'Bahan Habis Pakai',
        columns: ['Barang', 'Type', 'Qty (Pcs)', 'Remarks'],
        rows: [
          { id: 'prod_sekrup_engsel', label: 'Sekrup Engsel', type: '', unit: 'Pcs' },
          { id: 'prod_sekrup_2cm', label: 'Sekrup', type: '2 cm', unit: 'Pcs' },
          { id: 'prod_sekrup_25cm', label: 'Sekrup', type: '2.5 cm', unit: 'Pcs' },
          { id: 'prod_sekrup_3cm', label: 'Sekrup', type: '3 cm', unit: 'Pcs' },
          { id: 'prod_sekrup_4cm', label: 'Sekrup', type: '4 cm', unit: 'Pcs' },
          { id: 'prod_sekrup_5cm', label: 'Sekrup', type: '5 cm', unit: 'Pcs' },
          { id: 'prod_sekrup_7cm', label: 'Sekrup', type: '7 cm', unit: 'Pcs' },
          { id: 'prod_paku_tembak_f30', label: 'Paku Tembak', type: 'F 30', unit: 'Pcs' },
          { id: 'prod_paku_tembak_f20', label: 'Paku Tembak', type: 'F 20', unit: 'Pcs' },
          { id: 'prod_paku_tembak_f15', label: 'Paku Tembak', type: 'F 15', unit: 'Pcs' },
          { id: 'prod_paku_beton_5cm', label: 'Paku Beton', type: '5 cm', unit: 'Pcs' },
          { id: 'prod_paku_beton_7cm', label: 'Paku Beton', type: '7 cm', unit: 'Pcs' },
          { id: 'prod_staples_tembak', label: 'Staples Tembak', type: '', unit: 'Pcs' },
          { id: 'prod_amplas_gulung', label: 'Amplas Gulung', type: 'P80 / P100', unit: 'Pcs' },
          { id: 'prod_amplas_bulat', label: 'Amplas Bulat', type: 'P80 / P100', unit: 'Pcs' },
          { id: 'prod_kepala_amplas', label: 'Kepala Amplas', type: '', unit: 'Pcs' },
          { id: 'prod_tutup_sekrup_hitam_putih', label: 'Tutup Sekrup', type: 'Hitam / Putih', unit: 'Pcs' },
          { id: 'prod_tutup_sekrup_abu_coklat', label: 'Tutup Sekrup', type: 'Abu / Coklat', unit: 'Pcs' },
          { id: 'prod_biji_ambalan', label: 'Biji Ambalan', type: '', unit: 'Pcs' },
          { id: 'prod_lakban_kertas', label: 'Lakban Kertas', type: '', unit: 'Pcs' },
          { id: 'prod_lem_alteco', label: 'Lem Alteco', type: '', unit: 'Pcs' },
          { id: 'prod_solasi_listrik', label: 'Solasi Listrik', type: '', unit: 'Pcs' },
          { id: 'prod_sealtape', label: 'Sealtape', type: '', unit: 'Pcs' },
          { id: 'prod_doubletape', label: 'Doubletape', type: '', unit: 'Pcs' },
          { id: 'prod_fisher_s6_s8', label: 'Fisher', type: 'S6 / S8', unit: 'Pcs' },
          { id: 'prod_fisher_gypsum', label: 'Fisher', type: 'Gypsum', unit: 'Pcs' },
          { id: 'prod_isi_cutter', label: 'Isi Cutter', type: '', unit: 'Pcs' },
          { id: 'prod_thiner', label: 'Thiner', type: '', unit: 'Pcs' },
          { id: 'prod_kain_bal', label: 'Kain Bal', type: '', unit: 'Pcs' },
          { id: 'prod_sealant_clear', label: 'Sealant', type: 'Clear', unit: 'Pcs' },
          { id: 'prod_sealant_putih_hitam', label: 'Sealant', type: 'Putih / Hitam', unit: 'Pcs' },
          { id: 'prod_sealant_abu', label: 'Sealant', type: 'Abu tua / muda', unit: 'Pcs' },
          { id: 'prod_sealant_cklt', label: 'Sealant', type: 'Cklt tua / muda', unit: 'Pcs' },
          { id: 'prod_mata_bor_beton', label: 'Mata Bor Beton', type: 'S6 / S8', unit: 'Pcs' },
          { id: 'prod_mata_bor_keramik', label: 'Mata Bor Keramik', type: '6mm / 8mm', unit: 'Pcs' },
          { id: 'prod_mata_bor_gromet', label: 'Mata Bor Gromet', type: '', unit: 'Pcs' },
          { id: 'prod_mata_p_keramik', label: 'Mata P. Keramik', type: '', unit: 'Pcs' },
          { id: 'prod_mata_p_gerinda', label: 'Mata P. Gerinda', type: '', unit: 'Pcs' },
          { id: 'prod_mata_router', label: 'Mata Router', type: 'Bearing / non B', unit: 'Pcs' },
          { id: 'prod_mata_jig_saw', label: 'Mata Jig Saw', type: '', unit: 'Pcs' },
          { id: 'prod_mata_driver', label: 'Mata Driver', type: '', unit: 'Pcs' },
          { id: 'prod_timah_tenol', label: 'Timah / Tenol', type: '', unit: 'Pcs' },
          { id: 'prod_sapolac', label: 'Sapolac', type: '', unit: 'Pcs' },
          { id: 'prod_gergaji_kecil', label: 'Gergaji', type: 'Kecil', unit: 'Pcs' },
          { id: 'prod_kompon', label: 'Kompon', type: '', unit: 'Pcs' },
          { id: 'prod_karung_polybag', label: 'Karung / Polybag', type: '', unit: 'Pcs' },
          { id: 'prod_penutup_kabel', label: 'Penutup Kabel', type: 'Besar / Kecil', unit: 'Pcs' },
          { id: 'prod_kuas_cat', label: 'Kuas Cat', type: 'Besar / Kecil', unit: 'Pcs' },
          { id: 'prod_roll_cat', label: 'Roll Cat', type: 'Besar / Kecil', unit: 'Pcs' },
          { id: 'prod_pembersih_kaca', label: 'Pembersih Kaca', type: '', unit: 'Pcs' },
          { id: 'prod_pledge', label: 'Pledge', type: '', unit: 'Pcs' },
          { id: 'prod_plastik_cor', label: 'Plastik Cor', type: '', unit: 'Pcs' },
          { id: 'prod_lem_kuning', label: 'Lem Kuning', type: '', unit: 'Pcs' },
          { id: 'prod_cat_tusir', label: 'Cat Tusir', type: '', unit: 'Pcs' },
          { id: 'prod_custom_1', label: '', type: '', unit: 'Pcs', isCustom: true },
          { id: 'prod_custom_2', label: '', type: '', unit: 'Pcs', isCustom: true },
          { id: 'prod_custom_3', label: '', type: '', unit: 'Pcs', isCustom: true },
          { id: 'prod_custom_4', label: '', type: '', unit: 'Pcs', isCustom: true }
        ]
      }
    ]
  }
]

export const FIELD_FORM_ROWS_BY_ID = {}
for (const sec of FIELD_FORM_SECTIONS) {
  for (const tbl of sec.tables) {
    for (const r of tbl.rows) {
      FIELD_FORM_ROWS_BY_ID[r.id] = {
        ...r,
        sectionId: sec.id,
        sectionTitle: sec.title,
        tableId: tbl.id,
        table: tbl.name,
        categoryHint: r.categoryHint || tbl.categoryHint || ''
      }
    }
  }
}

export function getAllTemplateRows() {
  const list = []
  for (const sec of FIELD_FORM_SECTIONS) {
    for (const tbl of sec.tables) {
      for (const r of tbl.rows) {
        list.push({
          ...r,
          sectionId: sec.id,
          sectionTitle: sec.title,
          tableId: tbl.id,
          table: tbl.name,
          categoryHint: r.categoryHint || tbl.categoryHint || ''
        })
      }
    }
  }
  return list
}
