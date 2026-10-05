import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

// Memanggil kunci dari Vercel/Supabase Integration
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default function Home() {
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    // Menarik data dari tabel projects di Supabase
    async function fetchProjects() {
      const { data } = await supabase.from('projects').select('*');
      if (data) setProjects(data);
    }
    fetchProjects();
  }, []);

  return (
    <div style={{ padding: '40px', fontFamily: 'sans-serif', backgroundColor: '#f4f7fb', minHeight: '100vh' }}>
      <h1 style={{ color: '#172554' }}>Dashboard Purchasing v2.0</h1>
      <p>Sistem berhasil terhubung ke Vercel dan Supabase Database!</p>
      
      <div style={{ background: 'white', padding: '20px', borderRadius: '10px', marginTop: '20px' }}>
        <h3>Daftar Proyek dari Database:</h3>
        {projects.length === 0 ? (
          <p style={{ color: 'gray' }}>Belum ada data proyek di database. Silakan tambah data di Supabase.</p>
        ) : (
          <ul>
            {projects.map((p) => (
              <li key={p.id}><strong>{p.name}</strong> - Status: {p.status}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
