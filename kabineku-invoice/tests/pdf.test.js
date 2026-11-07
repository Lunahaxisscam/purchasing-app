import {it,expect} from 'vitest';
import fs from 'node:fs';
import {PDFDocument} from 'pdf-lib';
import {createEmptyInvoice} from '../src/lib/model.js';
import {buildInvoicePdf} from '../src/pdf/invoicePdf.js';
it('creates real Kabineku A4 PDF, including multipage synthetic content',async()=>{
 const invoice=createEmptyInvoice();invoice.invoiceNo='SYNTHETIC-TEST';invoice.billTo.projectOwner='SYNTHETIC TEST ONLY';invoice.lines[0]={...invoice.lines[0],desc:'SYNTHETIC furniture',qty:'1',unitPrice:'100.000'};
 const assets={logoBytes:new Uint8Array(fs.readFileSync(new URL('../src/assets/noir-logo.jpg',import.meta.url))),fontRegular:new Uint8Array(fs.readFileSync(new URL('../src/assets/fonts/Carlito-Regular.ttf',import.meta.url))),fontBold:new Uint8Array(fs.readFileSync(new URL('../src/assets/fonts/Carlito-Bold.ttf',import.meta.url)))};
 for(const long of [false,true]){
  if(long)invoice.lines=Array.from({length:70},(_,i)=>({...invoice.lines[0],id:String(i),desc:'SYNTHETIC ITEM '+i}));
  const out=await buildInvoicePdf({invoice,...assets,mode:'sample',watermark:'SYNTHETIC TEST'});const doc=await PDFDocument.load(out.bytes);
  expect(doc.getSubject()).toBe('Invoice (A4, template Kabineku)');expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28,1);expect(long?doc.getPageCount()>1:doc.getPageCount()===1).toBe(true);
  fs.mkdirSync(new URL('../test-output/',import.meta.url),{recursive:true});fs.writeFileSync(new URL(`../test-output/kabineku-${long?'multi':'one'}.pdf`,import.meta.url),out.bytes);
 }
},60000);