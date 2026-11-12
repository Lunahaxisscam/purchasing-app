import {it,expect,vi} from 'vitest';
import {PDFPage} from 'pdf-lib';
import fs from 'node:fs';
import {createEmptyInvoice} from '../src/lib/model.js';
import {buildInvoicePdf} from '../src/pdf/invoicePdf.js';
it('embeds the supplied Kabineku artwork instead of reconstructing text',async()=>{
 const texts=[],images=[];const ot=PDFPage.prototype.drawText,oi=PDFPage.prototype.drawImage;
 const st=vi.spyOn(PDFPage.prototype,'drawText').mockImplementation(function(t,o){texts.push(t);return ot.call(this,t,o)});
 const si=vi.spyOn(PDFPage.prototype,'drawImage').mockImplementation(function(i,o){images.push(o);return oi.call(this,i,o)});
 try {const a=n=>new Uint8Array(fs.readFileSync(new URL('../src/assets/'+n,import.meta.url)));
 await buildInvoicePdf({invoice:createEmptyInvoice(),logoBytes:a('kabineku-logo.jpg'),fontRegular:a('fonts/Carlito-Regular.ttf'),fontBold:a('fonts/Carlito-Bold.ttf')});
 expect(images.length).toBeGreaterThan(0);expect(images[0].width/images[0].height).toBeCloseTo(326/226,3);
 expect(texts).not.toContain('kabi');expect(texts).not.toContain('by Noir Living Indonesia');
 }finally{st.mockRestore();si.mockRestore()}
});