import { it,expect } from 'vitest';
import { normalizeInvoice } from '../../modules/sales-invoice/official/model.js';
it('shared normalization retains theme and defaults legacy safely',()=>{
 expect(normalizeInvoice({templateId:'kabineku',templateVersion:1})).toMatchObject({templateId:'kabineku',templateVersion:1});
 expect(normalizeInvoice({})).toMatchObject({templateId:'noir',templateVersion:1});
});
