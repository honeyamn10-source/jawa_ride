"""Real browser smoke test with an isolated server and customer/driver accounts."""
import os, time, tempfile, threading, sys
sys.path.insert(0,str(__import__("pathlib").Path(__file__).resolve().parents[1]))
import server
from pathlib import Path
from playwright.sync_api import sync_playwright
temp=tempfile.TemporaryDirectory()
server.DB=temp.name+'/browser.sqlite3';server.initialize()
http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
threading.Thread(target=http.serve_forever,daemon=True).start()
BASE='http://127.0.0.1:'+str(http.server_port)
with sync_playwright() as p:
    Path('artifacts').mkdir(exist_ok=True)
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    customer=browser.new_context(viewport={'width':390,'height':844})
    driver=browser.new_context(viewport={'width':1280,'height':900})
    a=customer.new_page();b=driver.new_page();errors=[]
    b.goto(BASE);b.get_by_role('button',name='Sign in →').wait_for()
    b.screenshot(path='artifacts/welcome-desktop.png',full_page=True)
    for page in [a,b]:page.on('pageerror',lambda e:errors.append(str(e)))
    tag=str(time.time_ns())
    for page,role in [(a,'customer'),(b,'driver')]:
        page.goto(BASE);page.get_by_role('button',name='Create account',exact=True).click()
        page.get_by_label('Full name').fill('Maya Perera' if role=='customer' else 'Arun Silva')
        page.get_by_label('I want to').select_option(role)
        if role=='driver':
            page.get_by_label('Vehicle model & colour').fill('Blue hatchback');page.get_by_label('Registration plate').fill('JAWA-1')
        page.get_by_label('Email address').fill(role+tag+'@example.test');page.get_by_label('Password',exact=True).fill('browser-test-secret-123')
        page.get_by_role('button',name='Create account →').click();page.get_by_role('button',name='Sign out').wait_for()
    assert b.request.post(BASE+'/api/location',data={'lat':6.91,'lng':79.85}).status==200
    matching_state=b.request.get(BASE+'/api/state').json()
    assert matching_state['matching']['location_current'],matching_state
    b.evaluate('() => refresh(true)')
    b.get_by_text('Matching within 15 km',exact=True).wait_for()
    b.get_by_role('button',name='Go online →').click();b.get_by_role('button',name='Go offline').wait_for()
    a.set_viewport_size({'width':1280,'height':1000})
    a.screenshot(path='artifacts/booking-desktop.png',full_page=True)
    a.set_viewport_size({'width':390,'height':844})
    for field,value in [('Pickup location','Central station'),('Pickup latitude','6.92'),('Pickup longitude','79.86'),('Destination','City harbour'),('Destination latitude','6.97'),('Destination longitude','79.88'),('Your cash offer','900')]:
        a.get_by_label(field,exact=True).fill(value)
    a.get_by_label('Saved place name').fill('Home');a.get_by_role('button',name='Save place').click()
    a.get_by_role('button',name='Home Central station').wait_for()
    assert a.get_by_label('Pickup location').input_value()=='Central station'
    a.get_by_label('Ride currency').select_option('LKR')
    a.get_by_role('button',name='Account',exact=True).click()
    a.get_by_role('heading',name='Your account.').wait_for()
    a.get_by_role('button',name='Ride',exact=True).click()
    assert a.get_by_label('Pickup location').input_value()=='Central station'
    assert a.get_by_label('Ride currency').input_value()=='LKR'
    a.get_by_label('Ride currency').focus()
    assert a.request.post(BASE+'/api/location',data={'lat':6.92,'lng':79.86}).status==200
    a.evaluate('() => refresh(true)')
    assert a.get_by_label('Ride currency').input_value()=='LKR', 'Polling reset currency selection'
    assert a.get_by_label('Ride currency').evaluate('(el)=>el===document.activeElement')
    a.get_by_role('button',name='Find a driver').click()
    b.get_by_role('button',name='Send offer').wait_for(timeout=15000)
    b.get_by_label('Cash fare',exact=True).fill('850');b.get_by_role('button',name='Send offer').click()
    a.get_by_role('button',name='Accept',exact=True).wait_for(timeout=15000)
    a.locator('#notice').wait_for(state='hidden',timeout=8000)
    a.set_viewport_size({'width':390,'height':1000})
    a.evaluate('window.scrollTo(0,0)')
    a.screenshot(path='artifacts/customer-offer-mobile.png')
    a.set_viewport_size({'width':320,'height':740})
    assert a.locator('body').evaluate('(el)=>el.scrollWidth <= window.innerWidth'), 'Narrow mobile page overflows'
    a.set_viewport_size({'width':390,'height':844})
    a.get_by_role('button',name='Accept',exact=True).click()
    a.get_by_label('Message',exact=True).fill('I am at the main entrance');a.get_by_role('button',name='Send',exact=True).click()
    b.get_by_text('I am at the main entrance',exact=False).wait_for(timeout=15000)
    a.get_by_label('Message',exact=True).fill('Unsent pickup detail')
    b.get_by_label('Message',exact=True).fill('I am arriving in a blue car')
    b.get_by_role('button',name='Send',exact=True).click()
    a.get_by_text('I am arriving in a blue car',exact=False).wait_for(timeout=9000)
    assert a.get_by_label('Message',exact=True).input_value()=='Unsent pickup detail', 'Polling erased the chat draft'
    assert a.get_by_label('Message',exact=True).evaluate('(el)=>el===document.activeElement'), 'Polling stole input focus'
    b.evaluate('window.scrollTo(0,0)')
    b.screenshot(path='artifacts/driver-active-desktop.png',full_page=True)
    pin=a.locator('[data-pickup-code]').inner_text()
    b.get_by_role('button',name='I’ve arrived at pickup').click()
    a.get_by_text('arrived',exact=True).wait_for(timeout=9000)
    assert a.get_by_label('Message',exact=True).input_value()=='Unsent pickup detail'
    b.get_by_label('Customer pickup code',exact=True).fill(pin)
    b.get_by_role('button',name='Start trip',exact=True).click()
    b.get_by_role('checkbox').check();b.get_by_role('button',name='Complete trip',exact=True).click()
    a.get_by_role('button',name='Rate trip',exact=True).wait_for(timeout=15000);a.get_by_role('button',name='Rate trip',exact=True).click()
    a.get_by_text('Your rating:',exact=False).wait_for()
    with a.expect_download() as download_info:
        a.get_by_role('button',name='Download cash receipt').click()
    download=download_info.value
    receipt=Path(download.path()).read_text()
    assert 'LKR' in receipt and '850' in receipt and 'Central station' in receipt
    assert a.locator('body').evaluate('(el)=>el.scrollWidth <= window.innerWidth'), 'Mobile page overflows'
    assert not errors,errors
    a.evaluate('window.scrollTo(0,0)');b.evaluate('window.scrollTo(0,0)')
    a.screenshot(path='artifacts/customer-mobile.png',full_page=True);b.screenshot(path='artifacts/driver-desktop.png',full_page=True)
    a.get_by_role('button',name='Activity',exact=True).click()
    a.get_by_role('heading',name='Your activity.').wait_for()
    a.locator('.history-item > summary').click()
    a.get_by_role('button',name='Download cash receipt').wait_for()
    a.evaluate('() => refresh(true)')
    assert a.locator('.history-item').evaluate('(el)=>el.open'), 'Refresh collapsed the selected history trip'
    a.screenshot(path='artifacts/activity-mobile.png',full_page=True)
    b.get_by_role('button',name='Account',exact=True).click()
    b.get_by_role('heading',name='Your account.').wait_for()
    assert b.get_by_label('Vehicle',exact=True).input_value()=='Blue hatchback'
    assert not errors,errors
    browser.close()
http.shutdown();http.server_close();temp.cleanup()
print('PASS: mobile customer + desktop driver registration, cash offer, acceptance, chat, pickup code, trip, rating and receipt download; no browser errors.')
