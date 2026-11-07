import pathlib,json,os,traceback
from playwright.sync_api import sync_playwright
R=pathlib.Path(r'C:\Users\NL Admin\Documents\00 LOCAL HERMES PLAYFIELD\00 purchasing-app');B=R.parent/'19 research-crawl4ai/browsers';os.environ['PLAYWRIGHT_BROWSERS_PATH']=str(B)
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True);context=browser.new_context(accept_downloads=True,viewport={'width':1100,'height':900});page=context.new_page();errors=[];requests=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('dialog',lambda d:d.accept())
  host='''<html><body><iframe title="Kabineku Invoice Generator (manual)" src="/kabineku-invoice/index.html" sandbox="allow-scripts allow-downloads allow-forms allow-modals" style="width:100%;height:850px"></iframe></body></html>'''
  def route(r):
   url=r.request.url
   if '/__kabineku-test-host' in url:r.fulfill(status=200,content_type='text/html',body=host)
   elif url.startswith('http://127.0.0.1:3001/kabineku-invoice/') or url.startswith('data:') or url.startswith('blob:'):r.continue_()
   else:requests.append(url);r.abort()
  page.route('**/*',route);page.goto('http://127.0.0.1:3001/__kabineku-test-host');frame=page.frame_locator('iframe');frame.locator('#invoiceNo').wait_for(timeout=30000)
  frame.locator('#invoiceNo').fill('SYNTHETIC-TEST');frame.locator('[id="billTo.projectOwner"]').fill('SYNTHETIC TEST ONLY')
  frame.locator('[data-tab="items"]').click();frame.locator('[data-field="desc"]').first.fill('SYNTHETIC furniture');frame.locator('[data-field="unitPrice"]').first.fill('100.000')
  frame.locator('#btn-save').click();frame.locator('[data-tab="drafts"]').click();assert frame.locator('#draft-count').inner_text()=='1'
  child=page.frames[1];assert frame.locator('#paper').get_attribute('data-template')=='kabineku'
  isolation=child.evaluate('''() => {let parentBlocked=false,storageBlocked=false;try{void parent.document.body}catch(e){parentBlocked=true}try{void localStorage.length}catch(e){storageBlocked=true}return {parentBlocked,storageBlocked,template:document.querySelector('#paper').dataset.template}}''')
  assert isolation['parentBlocked'] and isolation['storageBlocked'],isolation
  with page.expect_download(timeout=60000) as pending:frame.locator('#btn-pdf').click()
  download=pending.value;pdf=R/'staging-final/kabineku-invoice/test-output/kabineku-browser-DRAF.pdf';download.save_as(pdf);assert pdf.read_bytes().startswith(b'%PDF-')
  assert not errors,errors;assert not requests,requests
  page.screenshot(path=str(R/'kabineku-e2e.png'),full_page=True)
  context.close();browser.close()
 report={'stage':'passed','isolation':isolation,'unexpected_requests':requests,'page_errors':errors,'download':str(pdf),'pdf_bytes':pdf.stat().st_size,'real_browser':'Chromium on DAT laptop, isolated headless test context','database_writes':False}
 (R/'kabineku-e2e.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
except Exception:
 (R/'kabineku-e2e.json').write_text(json.dumps({'stage':'error','error':traceback.format_exc()}));raise