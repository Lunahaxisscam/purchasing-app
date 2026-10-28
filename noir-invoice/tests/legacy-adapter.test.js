import { it,expect } from 'vitest';
import { toOfficialInvoice } from '../../modules/sales-invoice/official/adapter.js';
import { computeTotals, selectTemplate, createEmptyInvoice, applyDefaultTermSchedule } from '../src/lib/model.js';
it('legacy list adapter stays Noir without losing literal identity, terms or payment',()=>{
 const a=toOfficialInvoice({invoice_no:'SYNTHETIC literal /000',customer_name:'TEST',nominal:123456,issue_date:'2026-01-01',payment_terms:'DP 30%, Termin 70%' });
 expect(a.templateId).toBe('noir');expect(a.invoiceNo).toBe('SYNTHETIC literal /000');expect(a.lines[0].unitPrice).toBe('123456');expect(a.paymentSchedule.terms).toHaveLength(2);
});
it('theme invariance covers optional tax, signed adjustments and custom terms',()=>{
 for(const tax of [{enabled:false},{enabled:true,mode:'amount',amount:'-1.250'},{enabled:true,mode:'percent',rate:'2,5'}]) {
 const a=createEmptyInvoice(); a.tax={...a.tax,...tax};a.lines[0]={...a.lines[0],desc:'TEST',qty:'1,25',unitPrice:'100.000'};a.lines.push({...a.lines[0],id:'adj',kind:'adjustment',qty:'1',unitPrice:'-5.000'});
 a.paymentSchedule={enabled:true,totalProject:'120.000',terms:[{id:'custom',label:'CUSTOM TEST',percent:'17',amount:'20.400'}]};
 expect(computeTotals(selectTemplate(a,'kabineku'))).toEqual(computeTotals(a));expect(selectTemplate(a,'kabineku').paymentSchedule).toEqual(a.paymentSchedule);
 }
 const a=createEmptyInvoice();const b=selectTemplate(a,'kabineku');expect(b.paymentSchedule.enabled).toBe(false);expect(applyDefaultTermSchedule(b,{grandTotal:100000n})).toBe(b);
});
