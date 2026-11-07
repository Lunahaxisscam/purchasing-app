import {it,expect,vi} from 'vitest';
import {PDFPage} from 'pdf-lib';
import fs from 'node:fs';
import {createEmptyInvoice} from '../src/lib/model.js';
import {buildInvoicePdf} from '../src/pdf/invoicePdf.js';
import {PAGE} from '../src/pdf/engine/layout.js';
it.each([false,true])('right aligns closing, signer and title (long notes=%s)',async(long)=>{
 const texts=[];const old=PDFPage.prototype.drawText;
 const spy=vi.spyOn(PDFPage.prototype,'drawText').mockImplementation(function(t,o){texts.push({t,...o});return old.call(this,t,o)});
 try{const a=n=>new Uint8Array(fs.readFileSync(new URL('../src/assets/'+n,import.meta.url)));const i=createEmptyInvoice();i.signature={signerName:'Tim Kabineku (Contoh)',signerTitle:'Administrasi - Simulasi'};if(long)i.notes='Catatan contoh. '.repeat(900);
 await buildInvoicePdf({invoice:i,fontRegular:a('fonts/Carlito-Regular.ttf'),fontBold:a('fonts/Carlito-Bold.ttf')});
 for(const t of ['Yours sincerely,',i.signature.signerName,i.signature.signerTitle]){const v=texts.find(x=>x.t===t);expect(v).toBeTruthy();expect(v.x+v.font.widthOfTextAtSize(t,v.size)).toBeCloseTo(PAGE.width-PAGE.marginX,3)}
 }finally{spy.mockRestore()}
},60000);