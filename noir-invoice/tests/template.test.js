import { describe, it, expect } from 'vitest';
import { createEmptyInvoice, normalizeInvoice } from '../src/lib/model.js';
describe('template identity', () => {
 it('defaults legacy to Noir v1 and retains allowlisted Kabineku v1', () => {
  expect(createEmptyInvoice()).toMatchObject({templateId:'noir',templateVersion:1});
  expect(normalizeInvoice({})).toMatchObject({templateId:'noir',templateVersion:1});
  expect(normalizeInvoice({templateId:'kabineku',templateVersion:1})).toMatchObject({templateId:'kabineku',templateVersion:1});
  expect(normalizeInvoice({templateId:'<img onerror=alert(1)>',templateVersion:999})).toMatchObject({templateId:'noir',templateVersion:1});
 });
});
