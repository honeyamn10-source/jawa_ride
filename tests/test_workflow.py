import unittest, tempfile, os, sys, threading, urllib.request, urllib.error, http.cookiejar, json, concurrent.futures
sys.path.insert(0,os.path.dirname(os.path.dirname(__file__)))
import server

class Client:
    def __init__(self,base):
        self.base=base; self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def call(self,path,data=None,headers=None):
        req=urllib.request.Request(self.base+'/api/'+path,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json',**(headers or {})})
        try:
            with self.opener.open(req) as r:return r.status,json.load(r)
        except urllib.error.HTTPError as e:return e.code,json.load(e)

class Workflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();server.DB=cls.tmp.name+'/test.db';server.initialize()
        cls.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        threading.Thread(target=cls.http.serve_forever,daemon=True).start();cls.base='http://127.0.0.1:'+str(cls.http.server_port)
    @classmethod
    def tearDownClass(cls):cls.http.shutdown();cls.http.server_close();cls.tmp.cleanup()
    def account(self,role):
        c=Client(self.base); email=os.urandom(8).hex()+'@test.example'
        code,r=c.call('register',{'name':role,'email':email,'password':'correct horse battery','role':role,'vehicle':'Blue car','plate':'AB 1234'})
        self.assertEqual(code,200,r);return c,email
    def ride(self,c):
        code,r=c.call('rides',{'pickup':'Central station','destination':'Harbour','plat':6.92,'plng':79.86,'dlat':6.97,'dlng':79.88,'budget':900,'currency':'LKR'})
        self.assertEqual(code,200,r);return r['id']
    def test_complete_cash_trip_and_authorization(self):
        c,_=self.account('customer');d,_=self.account('driver');outsider,_=self.account('customer');rid=self.ride(c)
        self.assertEqual(d.call(f'rides/{rid}/offer',{'fare':850,'eta':4})[0],403)
        self.assertEqual(d.call('availability',{'online':True})[0],200)
        self.assertEqual(d.call('location',{'lat':6.91,'lng':79.85})[0],200)
        self.assertEqual(d.call(f'rides/{rid}/offer',{'fare':850,'eta':4})[0],200)
        ride=c.call('state')[1]['rides'][0];self.assertGreater(ride['distance'],0);self.assertEqual(ride['currency'],'LKR');offer=ride['offers'][0]['id']
        self.assertEqual(outsider.call(f'rides/{rid}/accept',{'offer_id':offer,'offer_version':1})[0],403)
        self.assertEqual(c.call(f'rides/{rid}/accept',{'offer_id':offer,'offer_version':1})[0],200)
        pin=c.call('state')[1]['rides'][0]['pickup_pin']
        self.assertRegex(pin,r'^[0-9]{6}$')
        self.assertNotIn('pickup_pin',d.call('state')[1]['rides'][0])
        self.assertEqual(c.call(f'rides/{rid}/receipt')[0],409)
        self.assertEqual(c.call(f'rides/{rid}/accept',{'offer_id':offer,'offer_version':1})[0],409)
        self.assertEqual(outsider.call(f'rides/{rid}/chat',{'body':'intrusion'})[0],403)
        self.assertEqual(c.call(f'rides/{rid}/chat',{'body':'Meet at entrance <script>'})[0],200)
        self.assertEqual(d.call('state')[1]['rides'][0]['messages'][0]['body'],'Meet at entrance <script>')
        self.assertEqual(c.call(f'rides/{rid}/status',{'status':'arrived'})[0],403)
        self.assertEqual(d.call(f'rides/{rid}/status',{'status':'completed','cash_received':True})[0],409)
        self.assertEqual(d.call(f'rides/{rid}/status',{'status':'arrived'})[0],200)
        self.assertEqual(d.call(f'rides/{rid}/status',{'status':'in_progress'})[0],400)
        self.assertEqual(d.call(f'rides/{rid}/status',{'status':'in_progress','pickup_pin':pin})[0],200)
        self.assertNotIn('pickup_pin',c.call('state')[1]['rides'][0])
        self.assertEqual(c.call(f'rides/{rid}/status',{'status':'cancelled'})[0],409)
        self.assertEqual(d.call(f'rides/{rid}/status',{'status':'completed'})[0],400)
        self.assertEqual(d.call(f'rides/{rid}/status',{'status':'completed','cash_received':True})[0],200)
        self.assertEqual(c.call(f'rides/{rid}/chat',{'body':'closed'})[0],409)
        self.assertEqual(c.call(f'rides/{rid}/rate',{'stars':5})[0],200)
        r=c.call('state')[1]['rides'][0];self.assertEqual((r['fare'],r['cash_confirmed'],r['rating']),(850,1,5))
        self.assertNotIn('lat',r['driver']);self.assertNotIn('lng',r['driver'])
        receipt=c.call(f'rides/{rid}/receipt')[1]['receipt']
        self.assertEqual((receipt['amount'],receipt['currency'],receipt['payment_method']),(850,'LKR','cash'))
        self.assertEqual(d.call(f'rides/{rid}/receipt')[1]['receipt'],receipt)
        self.assertEqual(outsider.call(f'rides/{rid}/receipt')[0],403)
        self.assertEqual(Client(self.base).call(f'rides/{rid}/receipt')[0],401)

    def test_pickup_code_attempt_limit_persists(self):
        c,_=self.account('customer');d,_=self.account('driver');rid=self.ride(c)
        d.call('availability',{'online':True});d.call(f'rides/{rid}/offer',{'fare':100,'eta':3})
        offer=c.call('state')[1]['rides'][0]['offers'][0]['id']
        c.call(f'rides/{rid}/accept',{'offer_id':offer,'offer_version':1});d.call(f'rides/{rid}/status',{'status':'arrived'})
        pin=c.call('state')[1]['rides'][0]['pickup_pin']
        wrong='000000' if pin!='000000' else '111111'
        for expected in [400,400,400,400,429]:
            self.assertEqual(d.call(f'rides/{rid}/status',{'status':'in_progress','pickup_pin':wrong})[0],expected)
        server.initialize()
        self.assertEqual(d.call(f'rides/{rid}/status',{'status':'in_progress','pickup_pin':pin})[0],429)
        self.assertEqual(c.call('state')[1]['rides'][0]['status'],'arrived')
        with server.connect() as db:
            db.execute('UPDATE rides SET pin_locked_until=? WHERE id=?',(1,rid))
        self.assertEqual(d.call(f'rides/{rid}/status',{'status':'in_progress','pickup_pin':pin})[0],200)
    def test_booking_race(self):
        c,_=self.account('customer');d,_=self.account('driver');e,_=self.account('driver');rid=self.ride(c)
        for driver in [d,e]:
            driver.call('availability',{'online':True});driver.call(f'rides/{rid}/offer',{'fare':100,'eta':2})
        offers=c.call('state')[1]['rides'][0]['offers']
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            results=list(pool.map(lambda o:c.call(f'rides/{rid}/accept',{'offer_id':o['id'],'offer_version':o['version']})[0],offers))
        self.assertEqual(sorted(results),[200,409])
    def test_one_driver_cannot_accept_two_trips(self):
        c,_=self.account('customer');c2,_=self.account('customer');d,_=self.account('driver');d.call('availability',{'online':True})
        for customer in [c,c2]:
            rid=self.ride(customer);d.call(f'rides/{rid}/offer',{'fare':200,'eta':5})
        r1=c.call('state')[1]['rides'][0];r2=c2.call('state')[1]['rides'][0]
        self.assertEqual(c.call(f"rides/{r1['id']}/accept",{'offer_id':r1['offers'][0]['id'],'offer_version':r1['offers'][0]['version']})[0],200)
        self.assertEqual(c2.call(f"rides/{r2['id']}/accept",{'offer_id':r2['offers'][0]['id'],'offer_version':r2['offers'][0]['version']})[0],409)
    def test_validation_and_cancellation(self):
        c,_=self.account('customer');d,_=self.account('driver');rid=self.ride(c)
        self.assertEqual(c.call('rides',{})[0],409)
        self.assertEqual(c.call('location',{'lat':91,'lng':0})[0],400)
        self.assertEqual(c.call('location',{'lat':'NaN','lng':0})[0],400)
        self.assertEqual(c.call(f'rides/{rid}/status',{'status':'cancelled'})[0],200)
        d.call('availability',{'online':True})
        self.assertEqual(d.call(f'rides/{rid}/offer',{'fare':200,'eta':4})[0],409)
        self.ride(c)
    def test_login_logout_csrf_and_no_password_leak(self):
        c,email=self.account('customer');self.assertNotIn('password',c.call('state')[1]['user']);self.assertNotIn('salt',c.call('state')[1]['user'])
        self.assertEqual(c.call('logout',{},headers={'Origin':'https://evil.example'})[0],403)
        self.assertEqual(c.call('logout',{})[0],200);self.assertEqual(c.call('state')[0],401)
        self.assertEqual(c.call('login',{'email':email,'password':'wrong'})[0],401)
        self.assertEqual(c.call('login',{'email':email,'password':'correct horse battery'})[0],200)
        self.assertEqual(c.call('state')[0],200)
    def test_currency_configuration(self):
        code,config=Client(self.base).call('config')
        self.assertEqual(code,200);self.assertIn('LKR',config['currencies']);self.assertIn('USD',config['currencies'])

    def test_offer_change_requires_new_customer_acceptance(self):
        c,_=self.account('customer');d,_=self.account('driver');rid=self.ride(c)
        d.call('availability',{'online':True})
        d.call(f'rides/{rid}/offer',{'fare':100,'eta':3})
        old=c.call('state')[1]['rides'][0]['offers'][0]
        d.call(f'rides/{rid}/offer',{'fare':900,'eta':8})
        code,result=c.call(f'rides/{rid}/accept',{'offer_id':old['id'],'offer_version':1})
        self.assertEqual(code,409,result)
        self.assertEqual(c.call('state')[1]['rides'][0]['status'],'requested')
        current=c.call('state')[1]['rides'][0]['offers'][0]
        self.assertEqual(c.call(f'rides/{rid}/accept',{'offer_id':current['id'],'offer_version':current['version']})[0],200)

    def test_driver_logout_removes_availability(self):
        c,_=self.account('customer');d,_=self.account('driver');rid=self.ride(c)
        d.call('availability',{'online':True});d.call(f'rides/{rid}/offer',{'fare':100,'eta':3})
        offer=c.call('state')[1]['rides'][0]['offers'][0]
        d.call('logout',{})
        self.assertEqual(c.call(f'rides/{rid}/accept',{'offer_id':offer['id'],'offer_version':1})[0],409)

    def test_current_driver_trip_survives_busy_inbox(self):
        c,_=self.account('customer');d,_=self.account('driver');rid=self.ride(c)
        d.call('availability',{'online':True});d.call(f'rides/{rid}/offer',{'fare':100,'eta':3})
        offer=c.call('state')[1]['rides'][0]['offers'][0]
        self.assertEqual(c.call(f'rides/{rid}/accept',{'offer_id':offer['id'],'offer_version':1})[0],200)
        with server.connect() as db:
            template=db.execute('SELECT * FROM users WHERE id=?',(c.call('state')[1]['user']['id'],)).fetchone()
            for i in range(105):
                customer_id=db.execute('INSERT INTO users(name,email,password,salt,role) VALUES(?,?,?,?,?)',('Inbox customer',f'bulk-{rid}-{i}@test.example',template['password'],template['salt'],'customer')).lastrowid
                db.execute("INSERT INTO rides(customer_id,pickup,destination,plat,plng,dlat,dlng,distance,currency,budget,status,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",(customer_id,'Station','Harbour',6.92,79.86,6.97,79.88,6,'LKR',500,'requested',1,1))
        rides=d.call('state')[1]['rides']
        self.assertEqual(rides[0]['id'],rid)
        self.assertFalse(any(r['status']=='requested' for r in rides))

    def test_malformed_inputs_and_password_whitespace(self):
        c=Client(self.base);email=os.urandom(8).hex()+'@test.example'
        details={'name':'Customer','email':email,'password':'  password with spaces  ','role':'customer'}
        self.assertEqual(c.call('register',{**details,'name':None})[0],400)
        self.assertEqual(c.call('register',details)[0],200)
        self.assertEqual(c.call('location',{'lat':True,'lng':2})[0],400)
        self.assertEqual(c.call('logout',{})[0],200)
        self.assertEqual(c.call('login',{'email':email,'password':details['password'].strip()})[0],401)
        self.assertEqual(c.call('login',{'email':email,'password':details['password']})[0],200)

    def test_static_app_and_csp(self):
        with urllib.request.urlopen(self.base) as r:
            self.assertIn('Jawa Ride',r.read().decode());self.assertIn("frame-ancestors 'none'",r.headers['Content-Security-Policy'])
        with urllib.request.urlopen(self.base+'/app.js') as r:self.assertIn('Find a driver',r.read().decode())

if __name__=='__main__':unittest.main(verbosity=2)
