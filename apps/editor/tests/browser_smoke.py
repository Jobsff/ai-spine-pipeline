"""Optional offline Chromium UI smoke tests. pip install playwright; install Chromium.
Run after npm run build. No network or engine runtime is used by this test.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('QA_OUT', ROOT / 'qa-output'))
OUT.mkdir(parents=True, exist_ok=True)
HTML = (ROOT / 'dist/AI-Bone-Studio.html').read_text()
results = []

def save(page, name):
    with page.expect_download() as pending:
        page.click('#save')
    target = OUT / name
    pending.value.save_as(target)
    return json.loads(target.read_text())

def set_range(page, selector, value):
    page.locator(selector).evaluate("(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}", str(value))

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':1440,'height':1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('dialog', lambda dialog: dialog.accept())
    page.set_content(HTML)
    page.click('#empty-demo')
    page.wait_for_timeout(500)
    assert page.locator('.part-row').count() == 13
    assert page.locator('.bone-row').count() == 9
    baseline = save(page, 'demo.project.json')
    results.append('Practice puppet: 13 parts, 9 bones, embedded images saved')
    page.click('#play')
    page.wait_for_timeout(350)
    assert page.locator('#time-label').inner_text() != '0.00 s'
    page.click('#play')
    page.screenshot(path=str(OUT / 'desktop.png'))
    results.append('Animation playback updates timeline without browser errors')
    # Part property editing, binding and undo/redo.
    page.click('[data-mode="assemble"]')
    hat = next(p for p in baseline['parts'] if p['name']=='练习帽子')
    page.click(f'[data-part="{hat["id"]}"]')
    x = float(page.locator('#part-x').input_value())
    page.locator('#part-x').fill(str(x+25)); page.locator('#part-x').press('Tab')
    moved = save(page, 'moved.project.json')
    assert abs(next(p for p in moved['parts'] if p['id']==hat['id'])['x']-(x+25))<.001
    page.click('#undo'); page.click(f'[data-part="{hat["id"]}"]')
    assert abs(float(page.locator('#part-x').input_value())-x)<.001
    page.click('#redo'); page.click(f'[data-part="{hat["id"]}"]')
    assert abs(float(page.locator('#part-x').input_value())-(x+25))<.001
    page.locator('#part-bind').select_option('root')
    bound = save(page, 'bound.project.json')
    assert next(p for p in bound['parts'] if p['id']==hat['id'])['boneId']=='root'
    results.append('Numeric transform / undo / redo / binding selector persisted')
    # Restore project roundtrip and generate exports.
    page.locator('#project-input').set_input_files(str(OUT/'demo.project.json'))
    page.wait_for_timeout(300)
    assert save(page, 'restored.project.json') == baseline
    results.append('Open saved project restores exact serialized content')
    page.click('#go-export')
    with page.expect_download() as pending: page.click('#export-spine')
    pending.value.save_as(OUT/'demo-spine38.zip')
    with page.expect_download() as pending: page.click('#export-png')
    pending.value.save_as(OUT/'setup.png')
    with page.expect_download(timeout=30000) as pending: page.click('#export-frames')
    pending.value.save_as(OUT/'frames.zip')
    page.locator('#project-input').set_input_files(str(OUT/'demo-spine38.zip'))
    page.wait_for_timeout(300)
    assert save(page, 'from-bundle.project.json')==baseline
    results.append('ZIP / transparent PNG / 30-frame PNG sequence exported; ZIP reopens')
    # Draw a connected two-bone chain in an empty project with actual mouse clicks.
    page.click('#new'); page.click('#draw-tool')
    box=page.locator('#board').bounding_box()
    for x,y in [(200,200),(300,200),(370,240)]: page.mouse.click(box['x']+x*box['width']/800,box['y']+y*box['height']/720)
    page.keyboard.press('Escape')
    chain=save(page,'chain.project.json')
    assert len(chain['bones'])==3 and chain['bones'][2]['parentId']==chain['bones'][1]['id']
    results.append('Canvas mouse drawing creates two connected parent/child bones')
    # Image import on phone, touch drag and responsive panel switching.
    mobile=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1,has_touch=True,is_mobile=True)
    mobile.on('pageerror', lambda error: errors.append(str(error)))
    mobile.set_content(HTML)
    mobile.locator('#image-input').set_input_files(str(OUT/'setup.png'))
    mobile.wait_for_timeout(400)
    assert mobile.locator('.part-row').count()==1
    mobile.click('button[data-pane="library"]')
    mobile.click('.part-row')
    mobile.click('button[data-pane="inspector"]')
    assert mobile.locator('#part-bind').is_visible()
    mobile.screenshot(path=str(OUT/'mobile-properties.png'))
    mobile.click('button[data-pane="canvas"]')
    assert mobile.locator('#board').is_visible()
    mobile.screenshot(path=str(OUT/'mobile-canvas.png'))
    assert mobile.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
    before=save(mobile,'mobile-before.project.json')
    box=mobile.locator('#board').bounding_box()
    x,y=box['x']+box['width']*.5,box['y']+box['height']*.48
    session=mobile.context.new_cdp_session(mobile)
    session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
    session.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x+15,'y':y+12}]})
    session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
    after=save(mobile,'mobile-after.project.json')
    assert after['parts'][0]['x']!=before['parts'][0]['x']
    results.append('390px mobile layout: import, properties, canvas, single-touch drag, save')
    assert not errors, errors
    (OUT/'browser-results.json').write_text(json.dumps({'checks':results,'browserErrors':errors,'engineRuntimeTest':False,'indexedDBTest':False},ensure_ascii=False,indent=2))
    print(json.dumps(results,ensure_ascii=False,indent=2))
    browser.close()
