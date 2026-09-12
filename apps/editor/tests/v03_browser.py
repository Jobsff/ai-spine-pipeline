"""V0.3 browser flow. Offline standalone by default; LIVE_URL enables real-origin QA in CI.
Not a real AI/provider call, not a Laya/Cocos engine test. Requires Playwright, Pillow.
"""
import base64, io, json, os, zipfile
from pathlib import Path
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('QA_OUT',ROOT/'qa-v03')); OUT.mkdir(parents=True,exist_ok=True)
HTML=(ROOT/'dist/AI-Bone-Studio.html').read_text()
checks=[];errors=[]

def ready(p):
    p.wait_for_function("!document.querySelector('#preparation')?.classList.contains('processing')")
def act(p,action):
    p.locator(f'#preparation [data-action="{action}"]').click();ready(p)
def prep_save(p,name):
    with p.expect_download() as got: act(p,'save-prep')
    path=OUT/name;got.value.save_as(path);return json.loads(path.read_text())
def project_save(p,name):
    with p.expect_download() as got:p.click('#save')
    path=OUT/name;got.value.save_as(path);return json.loads(path.read_text())
def boot(p):
    if os.environ.get('LIVE_URL'):p.goto(os.environ['LIVE_URL'],wait_until='networkidle')
    else:p.set_content(HTML)
    p.on('pageerror',lambda e:errors.append(str(e)))
    p.on('dialog',lambda d:d.accept())

def set_range(p,selector,value):
    p.locator(selector).evaluate('(e,v)=>{e.value=v;e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));}',str(value))

with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000});boot(page)
    page.click('#prepare')
    # Supplied role, fixed-template amendment, adopt, preserve source and crop a new version.
    img=Image.new('RGBA',(240,200),(248,245,255,255));ImageDraw.Draw(img).ellipse((70,35,170,150),fill=(234,190,171,255))
    role=OUT/'role.png';img.save(role)
    page.locator('#prep-role-file').set_input_files(str(role));ready(page)
    page.locator('#prep-description').fill('两头身女魔法师，银紫色头发。')
    page.locator('#prep-amend').fill('帽子简单一点');act(page,'amend');act(page,'adopt')
    page.get_by_text('设计稿含多个视图？裁出本次使用的角色',exact=True).click()
    for field,value in [('x',40),('y',10),('width',160),('height',180)]:page.locator('#crop-'+field).fill(str(value))
    act(page,'crop-role');act(page,'adopt')
    data=prep_save(page,'role.prep.json');assert len(data['characters'])==2
    assert data['characters'][0]['width']==240 and data['characters'][1]['width']==160
    assert Image.open(io.BytesIO(base64.b64decode(data['characters'][0]['image'].split(',')[1]))).tobytes()==img.tobytes()
    assert '帽子简单一点' in data['description']
    checks.append('upload / amend without paid call / adopt / immutable crop version / source retained')
    # No backend configured: clear route to settings, does not fake success.
    act(page,'generate-role');assert page.locator('#gateway-url').is_visible()
    assert 'GitHub Pages' in page.locator('#preparation').inner_text()
    assert page.locator('[data-job-use]').count()==0
    checks.append('unconfigured API has explicit gateway setup state, not simulated image generation')
    page.locator('#preparation nav [data-step="2"]').click()
    act(page,'demo-sheet')
    page.get_by_text('规则网格切分（保留同一格内的分离像素）',exact=True).click()
    act(page,'grid');assert page.locator('.candidate').count()==12
    assert page.locator('.candidate.approved').count()==0
    for cid in page.locator('[data-approve]').evaluate_all('(els)=>els.map(e=>e.dataset.approve)'):
        page.locator(f'[data-approve="{cid}"]').click();ready(page)
    assert page.locator('.candidate.approved').count()==12
    data=prep_save(page,'approved.prep.json')
    assert len(data['candidates'])==12
    assert all(c['status']=='approved' for c in data['candidates'])
    assert all(c['keyVersion']=='chroma-distance-unmix/2' for c in data['candidates'])
    assert 'API_KEY' not in json.dumps(data)
    with page.expect_download() as got:act(page,'download-parts')
    got.value.save_as(OUT/'parts.zip')
    with zipfile.ZipFile(OUT/'parts.zip') as z:
        assert z.testzip() is None
        manifest=json.loads(z.read('manifest.json'));assert len(manifest['parts'])==12
        for entry in manifest['parts']:
            a=Image.open(io.BytesIO(z.read(entry['file'])))
            assert a.mode=='RGBA' and a.getchannel('A').getextrema()==(0,255)
            assert a.getpixel((0,0))[3]==0
    page.screenshot(path=str(OUT/'preparation-desktop.png'))
    checks.append('chroma-only practice sheet -> grid 12 review candidates -> explicit approval -> RGBA ZIP and traceable metadata')
    # Re-keying does not overwrite confirmed candidate images.
    act(page,'key');rekeyed=prep_save(page,'rekeyed.prep.json')
    assert [x['image'] for x in rekeyed['candidates']]==[x['image'] for x in data['candidates']]
    act(page,'send-parts');assert not page.locator('#preparation').is_visible()
    initial=project_save(page,'assembled.project.json')
    assert len(initial['parts'])==12 and initial['version']=='0.3'
    assert len({p['assetId'] for p in initial['parts']})==12
    checks.append('confirmed candidates survive re-key, handoff to real editor with no false auto-assembly')
    # A closed-eye part becomes a real attachment variant, aligned and keyed.
    open_eye=next(p for p in initial['parts'] if p['name']=='eye_L_open')
    closed_eye=next(p for p in initial['parts'] if p['name']=='eye_L_closed')
    page.click(f'[data-part="{open_eye["id"]}"]')
    page.locator('#expressions summary').click()
    page.locator('#expr-source').select_option(closed_eye['id']);page.click('#expr-add-existing')
    page.locator('#expr-x').fill('2');page.locator('#expr-x').press('Tab')
    page.click('[data-mode="animate"]')
    page.locator('#expr-part').select_option(open_eye['id'])
    page.click('#expr-blink')
    swapped=project_save(page,'blink.project.json')
    eye=next(p for p in swapped['parts'] if p['id']==open_eye['id'])
    assert len(swapped['parts'])==11 and len(eye['variants'])==1
    assert eye['variants'][0]['x']==2
    assert len(swapped['clips'][0]['attachments'][eye['id']])==4
    # Exact persistence and resource export.
    page.locator('#project-input').set_input_files(str(OUT/'blink.project.json'))
    page.wait_for_timeout(150);assert project_save(page,'blink-restored.project.json')==swapped
    page.click('#go-export')
    with page.expect_download() as got:page.click('#export-spine')
    got.value.save_as(OUT/'blink-spine.zip')
    with zipfile.ZipFile(OUT/'blink-spine.zip') as z:
        assert z.testzip() is None
        skeleton=json.loads(z.read(next(n for n in z.namelist() if n.endswith('.json') and not n.endswith('.project.json') and n not in ['asset-map.json','compatibility.json'])))
        track=skeleton['animations']['idle']['slots']['slot_'+eye['id']]['attachment']
        assert track[1]['name']=='variant_'+eye['variants'][0]['id']
        assert track[1]['name'] in skeleton['skins'][0]['attachments']['slot_'+eye['id']]
        meta=json.loads(z.read('compatibility.json'));assert meta['exporter']=='ai-bone-studio/0.3.0'
    with page.expect_download(timeout=30000) as got:page.click('#export-frames')
    got.value.save_as(OUT/'blink-frames.zip')
    with zipfile.ZipFile(OUT/'blink-frames.zip') as z:
        frames=[n for n in z.namelist() if n.endswith('.png')];assert len(frames)==30
        hashes=[z.read(n) for n in frames];assert hashes[0]!=hashes[13]
    checks.append('real closed-eye attachment / alignment / four discrete blink keys / roundtrip / Spine slot track / visibly different frame raster')
    # Restore preparation exact data, not imported/pivot data conflation.
    page.click('#prepare');page.locator('#prep-open').set_input_files(str(OUT/'approved.prep.json'));ready(page)
    assert prep_save(page,'prep-restored.prep.json')==data
    checks.append('preparation document roundtrip restores role versions, source sheets and confirmed pixels')
    # Mask operations and manual rectangles remain candidates only.
    fresh=browser.new_page(viewport={'width':1200,'height':950});boot(fresh);fresh.click('#prepare');fresh.locator('#preparation nav [data-step="2"]').click();act(fresh,'demo-sheet')
    cv=fresh.locator('#mask-canvas');box=cv.bounding_box()
    def pixel(x,y):return box['x']+x*box['width']/900,box['y']+y*box['height']/900
    fresh.mouse.move(*pixel(25,25));fresh.mouse.down();fresh.mouse.move(*pixel(275,200),steps=5);fresh.mouse.up();act(fresh,'crop-box')
    assert fresh.locator('.candidate').count()==1
    fresh.locator('#mask-tool').select_option('erase');box=cv.bounding_box()
    fresh.mouse.click(*pixel(150,112));act(fresh,'mask-undo')
    checks.append('manual rectangle creates a review candidate; erase and mask undo execute without errors')
    # Mobile: all preparation tabs usable, real candidate flow, no horizontal overflow.
    mobile=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);boot(mobile)
    mobile.click('#prepare')
    assert mobile.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
    for tab in [1,2,3,2]:
        mobile.locator(f'#preparation nav [data-step="{tab}"]').click()
        assert mobile.locator('#preparation').evaluate('(e)=>e.scrollWidth <= e.clientWidth + 1')
    act(mobile,'demo-sheet');mobile.get_by_text('规则网格切分（保留同一格内的分离像素）',exact=True).click();act(mobile,'grid')
    assert mobile.locator('.candidate').count()==12
    assert mobile.locator('#preparation').evaluate('(e)=>e.scrollWidth <= e.clientWidth + 1')
    mobile.locator('.prep-body').evaluate('(e)=>e.scrollTop=0');mobile.screenshot(path=str(OUT/'preparation-mobile.png'))
    checks.append('390x844 mobile preparation tabs, scrolling, keying and grid candidates without horizontal overflow')
    if os.environ.get('LIVE_URL'):
        # Real origin only: verify IndexedDB survives navigation/reload.
        mobile.wait_for_timeout(800);mobile.reload(wait_until='networkidle');mobile.wait_for_timeout(400)
        mobile.click('#prepare');mobile.locator('#preparation nav [data-step="2"]').click()
        assert mobile.locator('.candidate').count()==12
        checks.append('HTTP-origin IndexedDB preparation survives browser reload with 12 candidates')
        gateway=browser.new_page(viewport={'width':1200,'height':950});boot(gateway)
        jobs={};posts=[];fake_token='browser-contract-test-not-a-real-key'
        image_url='data:image/png;base64,'+base64.b64encode(role.read_bytes()).decode()
        def api_route(route):
            req=route.request;path=req.url.removeprefix('https://gateway.example.test');headers={'access-control-allow-origin':req.headers.get('origin','*'),'access-control-allow-headers':'Authorization,Content-Type','access-control-allow-methods':'GET,POST,DELETE,OPTIONS'}
            if req.method=='OPTIONS':route.fulfill(status=204,headers=headers);return
            assert req.headers.get('authorization')=='Bearer '+fake_token
            payload={};status=200
            if path=='/capabilities':payload={'version':'0.3.0','providers':[{'id':'openai','label':'Contract-test provider','model':'mock-not-live','generate':True,'edit':True}]}
            elif path=='/jobs' and req.method=='POST':
                data=req.post_data_json;posts.append(data);assert data['confirmed'] is True and data['kind']=='parts' and data['reference'].startswith('data:image/png;') and data['color']=='#00ff00'
                assert '不透明的纯色' in data['prompt'] and 'apiKey' not in data
                job={'id':data['requestId'],'requestId':data['requestId'],'status':'succeeded','kind':'parts','createdAt':'2026-09-12T00:00:00Z','images':[{'dataUrl':image_url}]};jobs[job['id']]=job;payload={'job':job};status=202
            elif path=='/jobs':payload={'jobs':list(jobs.values())}
            elif path.startswith('/jobs/') and req.method=='DELETE':del jobs[path[6:]];payload={'deleted':True}
            elif path.startswith('/jobs/'):payload=jobs[path[6:]]
            route.fulfill(status=status,headers=headers,content_type='application/json',body=json.dumps(payload))
        gateway.route('https://gateway.example.test/**',api_route)
        gateway.click('#prepare');gateway.locator('#prep-role-file').set_input_files(str(role));ready(gateway);act(gateway,'adopt')
        gateway.locator('#preparation nav [data-step="3"]').click();gateway.locator('#gateway-url').fill('https://gateway.example.test');gateway.locator('#gateway-token').fill(fake_token);act(gateway,'connect');assert not posts
        gateway.locator('#preparation nav [data-step="2"]').click();act(gateway,'generate-parts');assert len(posts)==1
        for _ in range(2):act(gateway,'refresh-jobs')
        assert len(posts)==1
        gateway.wait_for_timeout(800);gateway.reload(wait_until='networkidle');gateway.wait_for_timeout(300);gateway.click('#prepare');gateway.locator('#preparation nav [data-step="3"]').click()
        assert gateway.locator('#gateway-token').input_value()==''
        gateway.locator('#gateway-token').fill(fake_token);act(gateway,'connect');assert len(posts)==1
        gateway.locator('[data-job-use]').click();ready(gateway)
        assert gateway.locator('#mask-canvas').is_visible()
        recovered=prep_save(gateway,'mock-recovered.prep.json');assert recovered['jobs'][0]['imported'] is True and fake_token not in json.dumps(recovered)
        checks.append('mock gateway contract: paid confirmation, reference+chroma request, query-only refresh, reload recovery, token not persisted, result returns to QA')
    assert not errors,errors
    result={'checks':checks,'browserErrors':errors,'mode':'live-http' if os.environ.get('LIVE_URL') else 'offline-set-content','realProviderCalls':False,'engineTest':False,'indexedDBReloadTest':bool(os.environ.get('LIVE_URL'))}
    (OUT/'v03-browser-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(json.dumps(result,ensure_ascii=False,indent=2));browser.close()
