import Head from 'next/head'
import '../styles/globals.css'
import '../styles/compact-flow.css'

// CATATAN VIEWPORT (t_eebe4678): tag <meta name="viewport"> hidup HANYA di
// sini, TIDAK lagi diduplikasi di pages/_document.js.
//
// Sebelumnya tag yang sama dipasang di _app DAN _document, sehingga HTML
// memuat dua tag viewport (Next.js menyuntik default `width=device-width`
// lebih dulu, lalu tag kita menyusul). Dua tag = perilaku tidak terdefinisi
// dan menyulitkan diagnosis bug mobile. Konvensi Next.js yang didukung: satu
// sumber saja; `next/head` di _app dipilih karena tetap ter-render di HTML
// awal (SSR/SSG) dan bisa di-override per halaman bila perlu.
export default function MyApp({ Component, pageProps }) {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      <Component {...pageProps} />
    </>
  )
}
