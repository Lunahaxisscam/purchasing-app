import { it, expect } from 'vitest';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import { buildInvoicePdf } from '../src/pdf/invoicePdf.js';
import { createEmptyInvoice, selectTemplate } from '../src/lib/model.js';
const report=process.env.INVOICE_TEST_REPORT_DIR || '/home/ubuntu/reports/invoice-kabineku-staging';
fs.mkdirSync(report,{recursive:true});

const assets={logoBytes:fs.readFileSync(new URL('../src/assets/noir-logo.jpg',import.meta.url)),fontRegular:fs.readFileSync(new URL('../src/assets/fonts/Carlito-Regular.ttf',import.meta.url)),fontBold:fs.readFileSync(new URL('../src/assets/fonts/Carlito-Bold.ttf',import.meta.url))};
it('produces parsed real A4 PDFs for both themes, short and multipage with all content', async()=>{
 const a=createEmptyInvoice(); a.invoiceNo='SYNTHETIC TEST'; a.billTo.projectOwner='SYNTHETIC TEST — NOT A CUSTOMER';a.issuer.name='SYNTHETIC TEST';a.signature.signerName='TEST SIGNER';a.notes='SYNTHETIC TEST — NOT A TRANSACTION';
 a.lines[0]={...a.lines[0],desc:'SYNTHETIC TEST furniture',note:'Test specifications only',qty:'1,25',unitPrice:'100.000'};
 for(const theme of ['noir','kabineku']) for(const long of [false,true]) {
 const invoice=selectTemplate(a,theme); if(long)invoice.lines=[{...a.lines[0],desc:'LONG START '+('Synthetic description wrapping test. '.repeat(450))+' LONG END'},...Array.from({length:35},(_,i)=>({...a.lines[0],id:String(i),desc:'SYNTHETIC ROW '+i}))];
 const out=await buildInvoicePdf({invoice,...assets,mode:'sample',watermark:'SYNTHETIC TEST',now:new Date('2026-01-01')});
 const pdf=await PDFDocument.load(out.bytes);expect(pdf.getPageCount()).toBe(out.pageCount);expect(pdf.getPage(0).getWidth()).toBeCloseTo(595.28,1);
 expect(pdf.getSubject()).toBe(`Invoice (A4, template ${theme==='noir'?'Noir':'Kabineku'})`);
 expect(long?out.pageCount>1:out.pageCount===1).toBe(true);
 const file=`${report}/${theme}-${long?'stress':'one-page'}.pdf`;fs.writeFileSync(file,out.bytes);
 const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'});
 expect(text).toContain('rekening belum diisi');expect(text).toContain('Grand Total');
 if(theme==='kabineku')expect(text).toContain('kabi');
 if(long){expect(text).toContain('LONG END');expect(text).toContain('SYNTHETIC ROW 34');expect(text.match(/Amount/g).length).toBeGreaterThan(1);}
 }
},60000);
