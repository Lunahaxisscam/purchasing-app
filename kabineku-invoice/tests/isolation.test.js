import {it,expect} from 'vitest';
import fs from 'node:fs';
import {createEmptyInvoice,normalizeInvoice} from '../src/lib/model.js';
it('starts and normalizes only Kabineku, never reuses Noir identity or storage namespace',()=>{
 expect(createEmptyInvoice().templateId).toBe('kabineku');
 expect(normalizeInvoice({templateId:'noir'}).templateId).toBe('kabineku');
 const storage=fs.readFileSync(new URL('../src/lib/storage.js',import.meta.url),'utf8');
 expect(storage).not.toContain('noir-invoice-generator/v1:');
 expect(storage).not.toContain('win.localStorage');
});