import {it,expect} from 'vitest';
import {createEmptyInvoice} from '../src/lib/model.js';
it('prefills the exact approved Kabineku bank account',()=>{
 const i=createEmptyInvoice();expect(i.payment.transferVia).toBe('BCA');expect(i.payment.bankLines).toBe('6040359867 Daril Aldian');
});import {vi} from 'vitest';
import {PDFPage} from 'pdf-lib';
import fs from 'node:fs';
import {buildInvoicePdf} from '../src/pdf/invoicePdf.js';
it('keeps notes below the payment panel with breathing room',async()=>{
 const texts=[],rects=[];const oldT=PDFPage.prototype.drawText,oldR=PDFPage.prototype.drawRectangle;
 const st=vi.spyOn(PDFPage.prototype,'drawText').mockImplementation(function(t,o){texts.push({t,...o});return oldT.call(this,t,o)});
 const sr=vi.spyOn(PDFPage.prototype,'drawRectangle').mockImplementation(function(o){rects.push(o);return oldR.call(this,o)});
 try{
  const invoice=createEmptyInvoice();invoice.invoiceNo='SAMPLE';invoice.notes='CONTOH - BUKAN TAGIHAN';invoice.lines[0]={...invoice.lines[0],desc:'Kitchen set',qty:'1',unitPrice:'100.000'};
  const a=n=>new Uint8Array(fs.readFileSync(new URL('../src/assets/'+n,import.meta.url)));
  await buildInvoicePdf({invoice,fontRegular:a('fonts/Carlito-Regular.ttf'),fontBold:a('fonts/Carlito-Bold.ttf'),mode:'final'});
  const note=texts.find(x=>x.t==='Catatan:');const panel=rects.find(x=>x.width>490&&x.height>=30&&x.height<150);
  expect(note).toBeTruthy();expect(panel).toBeTruthy();expect(panel.y-(note.y+note.size)).toBeGreaterThanOrEqual(12);
  expect(texts.some(x=>x.t==='Payment transfer to: BCA')).toBe(true);
 }finally{st.mockRestore();sr.mockRestore()}
});