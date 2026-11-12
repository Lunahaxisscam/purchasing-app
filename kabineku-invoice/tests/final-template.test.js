import {it,expect,vi} from 'vitest';
import fs from 'node:fs';
import {PDFPage} from 'pdf-lib';
import {createEmptyInvoice} from '../src/lib/model.js';
import {buildInvoicePdf} from '../src/pdf/invoicePdf.js';
it('final Kabineku header has logo and INVOICE without duplicate issuer name',async()=>{
 const all=[];const old=PDFPage.prototype.drawText;const spy=vi.spyOn(PDFPage.prototype,'drawText').mockImplementation(function(t,o){all.push(t);return old.call(this,t,o)});
 try{const i=createEmptyInvoice();i.invoiceNo='11/KBNK/007';i.issuer.name='KABINEKU';i.billTo.projectOwner='Bpk Johan';i.billTo.address='XYZ Trail 10 no 35';i.lines[0]={...i.lines[0],desc:'Commitment fee',qty:'1',unitPrice:'500.000'};
 const a=n=>new Uint8Array(fs.readFileSync(new URL('../src/assets/'+n,import.meta.url)));await buildInvoicePdf({invoice:i,fontRegular:a('fonts/Carlito-Regular.ttf'),fontBold:a('fonts/Carlito-Bold.ttf'),logoBytes:a('kabineku-logo.jpg'),mode:'final'});
 expect(all).toContain('INVOICE');expect(all).not.toContain('KABINEKU');expect(all.some(t=>/SIMULASI|DRAF|CONTOH/.test(t))).toBe(false);expect(all).toContain('11/KBNK/007');
 }finally{spy.mockRestore()}
});