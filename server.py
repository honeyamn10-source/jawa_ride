import os, json, sqlite3, hashlib, secrets, time, math, re
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from http.cookies import SimpleCookie
from pathlib import Path
from contextlib import closing

ROOT = Path(__file__).resolve().parent
DB = os.environ.get('JAWA_DB', str(ROOT / 'data' / 'jawa.sqlite3'))
CURRENCIES = set('AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWG'.split())
COOKIE_SECURE = os.environ.get('JAWA_SECURE_COOKIE') == '1'

def connect():
    con = sqlite3.connect(DB, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    return con

def initialize():
    Path(DB).parent.mkdir(parents=True, exist_ok=True)
    with closing(connect()) as c, c:
        c.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS auth_attempts(key TEXT PRIMARY KEY, attempts INTEGER, reset REAL);
        CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL, vehicle TEXT NOT NULL DEFAULT '', plate TEXT NOT NULL DEFAULT '', online INTEGER NOT NULL DEFAULT 0, lat REAL, lng REAL);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), expires REAL);
        CREATE TABLE IF NOT EXISTS rides(id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES users(id), driver_id INTEGER REFERENCES users(id), pickup TEXT, destination TEXT, plat REAL, plng REAL, dlat REAL, dlng REAL, distance REAL, currency TEXT NOT NULL DEFAULT 'USD', budget REAL, fare REAL, status TEXT DEFAULT 'requested', cash_confirmed INTEGER DEFAULT 0, created REAL, updated REAL);
        CREATE TABLE IF NOT EXISTS offers(id INTEGER PRIMARY KEY, ride_id INTEGER REFERENCES rides(id), driver_id INTEGER REFERENCES users(id), fare REAL, eta INTEGER, created REAL, UNIQUE(ride_id,driver_id));
        CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, ride_id INTEGER REFERENCES rides(id), user_id INTEGER REFERENCES users(id), body TEXT, created REAL);
        CREATE TABLE IF NOT EXISTS ratings(ride_id INTEGER PRIMARY KEY REFERENCES rides(id), stars INTEGER, customer_id INTEGER REFERENCES users(id));
        ''')

        if 'currency' not in [r[1] for r in c.execute('PRAGMA table_info(rides)')]:
            c.execute("ALTER TABLE rides ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'")
        if 'version' not in [r[1] for r in c.execute('PRAGMA table_info(offers)')]:
            c.execute('ALTER TABLE offers ADD COLUMN version INTEGER NOT NULL DEFAULT 1')
        columns = {r[1] for r in c.execute('PRAGMA table_info(rides)')}
        for name, declaration in [('pickup_pin', 'TEXT'), ('pin_failures', 'INTEGER NOT NULL DEFAULT 0'), ('pin_locked_until', 'REAL NOT NULL DEFAULT 0')]:
            if name not in columns:
                c.execute(f'ALTER TABLE rides ADD COLUMN {name} {declaration}')
        for row in c.execute("SELECT id FROM rides WHERE pickup_pin IS NULL AND status IN ('accepted','arrived')").fetchall():
            c.execute('UPDATE rides SET pickup_pin=? WHERE id=?', (f'{secrets.randbelow(1000000):06d}', row['id']))

def distance(a,b,c,d):
    p,q=math.radians(a),math.radians(c)
    h=math.sin((q-p)/2)**2+math.cos(p)*math.cos(q)*math.sin(math.radians(d-b)/2)**2
    return round(6371*2*math.asin(min(1,math.sqrt(h))),2)

class Problem(Exception):
    def __init__(self, message, status=400): self.message,self.status=message,status

def text_value(data,key,limit=200,strip=True):
    value=data.get(key,'')
    if not isinstance(value,str): raise Problem(f'Enter text for {key}.')
    if strip: value=value.strip()
    if not value or len(value)>limit: raise Problem(f'{key} is required (maximum {limit} characters).')
    return value

def number(data,key,low,high):
    if isinstance(data.get(key),bool): raise Problem(f'Enter a valid {key}.')
    try: value=float(data[key])
    except (KeyError,ValueError,TypeError): raise Problem(f'Enter a valid {key}.')
    if not math.isfinite(value) or not low<=value<=high: raise Problem(f'{key} must be between {low} and {high}.')
    return value

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def reply(self,data,status=200,cookie=None):
        raw=json.dumps(data,allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json')
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        if cookie: self.send_header('Set-Cookie',cookie)
        self.send_header('Content-Length',str(len(raw)))
        self.end_headers(); self.wfile.write(raw)
    def user(self,c):
        jar=SimpleCookie()
        try: jar.load(self.headers.get('Cookie',''))
        except Exception: raise Problem('Please sign in.',401)
        token=jar.get('jawa_session')
        u=c.execute('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?',(hashlib.sha256(token.value.encode()).hexdigest() if token else '',time.time())).fetchone()
        if not u: raise Problem('Please sign in.',401)
        return dict(u)
    def public_user(self,u): return {k:v for k,v in dict(u).items() if k not in ('password','salt')}
    def do_GET(self):
        if self.path.startswith('/api/'):
            return self.api('GET')
        path=self.path.split('?')[0]
        assets={'/':('index.html','text/html; charset=utf-8'),'/app.js':('app.js','text/javascript'),'/style.css':('style.css','text/css')}
        for weight in (400,500,600,700,800):
            name=f'inter-latin-{weight}-normal.woff2'
            assets['/assets/'+name]=('assets/'+name,'font/woff2')
        if path not in assets: return self.reply({'error':'Not found'},404)
        filename,mime=assets[path]; raw=(ROOT/'public'/filename).read_bytes()
        self.send_response(200); self.send_header('Content-Type',mime)
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.send_header('X-Content-Type-Options','nosniff'); self.send_header('Content-Length',str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def do_POST(self): self.api('POST')
    def api(self,method):
        try:
            data={}
            if method=='POST':
                if self.headers.get('Sec-Fetch-Site')=='cross-site': raise Problem('Cross-site request denied.',403)
                origin=self.headers.get('Origin')
                if origin:
                    from urllib.parse import urlsplit
                    if urlsplit(origin).netloc!=self.headers.get('Host'): raise Problem('Origin denied.',403)
                if self.headers.get('Content-Type','').split(';')[0]!='application/json': raise Problem('JSON required.',415)
                try:
                    size=int(self.headers.get('Content-Length','0'))
                    if size<0 or size>16000: raise Problem('Request too large.',413)
                    data=json.loads(self.rfile.read(size))
                    if not isinstance(data,dict): raise ValueError()
                except (ValueError,UnicodeDecodeError): raise Problem('Invalid JSON.')
            path=self.path.split('?')[0]
            with closing(connect()) as c, c:
                if method=='POST' and path in ('/api/login','/api/register'):
                    key=hashlib.sha256((self.client_address[0]+path).encode()).hexdigest()
                    c.execute('DELETE FROM auth_attempts WHERE reset<?',(time.time(),))
                    c.execute('INSERT INTO auth_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1',(key,time.time()+900))
                    count=c.execute('SELECT attempts FROM auth_attempts WHERE key=?',(key,)).fetchone()[0]
                    c.commit()
                    if count>100: raise Problem('Too many authentication attempts. Try again in 15 minutes.',429)
                if method=='POST': c.execute('BEGIN IMMEDIATE')
                result,cookie=self.route(c,method,path,data)
            self.reply(result,cookie=cookie)
        except Problem as e: self.reply({'error':e.message},e.status)
        except sqlite3.IntegrityError: self.reply({'error':'This account or action already exists.'},409)
        except Exception:
            import traceback; traceback.print_exc()
            self.reply({'error':'The request could not be completed.'},500)
    def route(self,c,method,path,d):
        now=time.time()
        if path in ('/api/register','/api/login') and method=='POST':
            email=text_value(d,'email',254).lower(); password=text_value(d,'password',200,strip=False)
            if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email): raise Problem('Enter a valid email address.')
            if path=='/api/register':
                if len(password)<10: raise Problem('Use a password with at least 10 characters.')
                name=text_value(d,'name',80); role=d.get('role')
                if role not in ('customer','driver'): raise Problem('Choose customer or driver.')
                vehicle=text_value(d,'vehicle',80) if role=='driver' else ''
                plate=text_value(d,'plate',30) if role=='driver' else ''
                salt=secrets.token_hex(16); digest=hashlib.scrypt(password.encode(),salt=bytes.fromhex(salt),n=16384,r=8,p=1).hex()
                uid=c.execute('INSERT INTO users(name,email,password,salt,role,vehicle,plate) VALUES(?,?,?,?,?,?,?)',(name,email,digest,salt,role,vehicle,plate)).lastrowid
                u=c.execute('SELECT * FROM users WHERE id=?',(uid,)).fetchone()
            else:
                u=c.execute('SELECT * FROM users WHERE email=?',(email,)).fetchone()
                salt=u['salt'] if u else '00'*16
                digest=hashlib.scrypt(password.encode(),salt=bytes.fromhex(salt),n=16384,r=8,p=1).hex()
                if not u or not secrets.compare_digest(digest,u['password']): raise Problem('Email or password is incorrect.',401)
            token=secrets.token_urlsafe(32)
            c.execute('DELETE FROM sessions WHERE expires<?',(now,))
            c.execute('INSERT INTO sessions VALUES(?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),u['id'],now+86400*7))
            return {'user':self.public_user(u)},f'jawa_session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800'+ ('; Secure' if COOKIE_SECURE else '')
        if path=='/api/config' and method=='GET': return {'currencies':sorted(CURRENCIES)},None
        u=self.user(c); uid=u['id']; role=u['role']
        if path=='/api/logout' and method=='POST':
            jar=SimpleCookie(self.headers.get('Cookie','')); token=jar['jawa_session'].value
            c.execute('DELETE FROM sessions WHERE token=?',(hashlib.sha256(token.encode()).hexdigest(),))
            if role=='driver': c.execute('UPDATE users SET online=0 WHERE id=?',(uid,))
            return {'ok':True},'jawa_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
        if path=='/api/state' and method=='GET':
            if role=='customer': rows=c.execute('SELECT * FROM rides WHERE customer_id=? ORDER BY id DESC LIMIT 100',(uid,)).fetchall()
            else: rows=c.execute("""SELECT * FROM rides WHERE driver_id=? OR
                (status='requested' AND ?=1 AND NOT EXISTS
                    (SELECT 1 FROM rides active WHERE active.driver_id=? AND active.status NOT IN ('completed','cancelled')))
                ORDER BY CASE WHEN driver_id=? AND status NOT IN ('completed','cancelled') THEN 0
                    WHEN status='requested' THEN 1 ELSE 2 END, id DESC LIMIT 100""",(uid,u['online'],uid,uid)).fetchall()
            rides=[]
            for row in rows:
                ride=dict(row)
                ride.pop('pin_failures',None)
                ride.pop('pin_locked_until',None)
                if uid!=ride['customer_id'] or ride['status'] not in ('accepted','arrived'):
                    ride.pop('pickup_pin',None)
                # A driver's inbox exposes route and budget only; chats require assignment.
                offers=c.execute('''SELECT offers.*,users.name,users.vehicle,users.plate,
                    (users.online=1 AND NOT EXISTS (SELECT 1 FROM rides active WHERE active.driver_id=offers.driver_id
                     AND active.status NOT IN ('completed','cancelled'))) AS available
                    FROM offers JOIN users ON users.id=offers.driver_id WHERE ride_id=?'''+(' AND driver_id=?' if role=='driver' else ''),(ride['id'],uid) if role=='driver' else (ride['id'],)).fetchall()
                ride['offers']=[dict(x) for x in offers]
                ride['customer_name']=c.execute('SELECT name FROM users WHERE id=?',(ride['customer_id'],)).fetchone()['name']
                ride['driver']=self.public_user(c.execute('SELECT * FROM users WHERE id=?',(ride['driver_id'],)).fetchone()) if ride['driver_id'] else None
                if ride['driver']:
                    ride['driver']={k:ride['driver'][k] for k in ('name','vehicle','plate','lat','lng')}
                    if ride['status'] in ('completed','cancelled'):
                        ride['driver'].pop('lat',None)
                        ride['driver'].pop('lng',None)
                ride['messages']=[dict(x) for x in c.execute('SELECT messages.*,users.name FROM messages JOIN users ON users.id=messages.user_id WHERE ride_id=? ORDER BY messages.id',(ride['id'],))] if uid in (ride['customer_id'],ride['driver_id']) else []
                rating=c.execute('SELECT stars FROM ratings WHERE ride_id=?',(ride['id'],)).fetchone(); ride['rating']=rating['stars'] if rating else None
                ride['pickup_distance']=distance(u['lat'],u['lng'],ride['plat'],ride['plng']) if role=='driver' and u['lat'] is not None else None
                rides.append(ride)
            return {'user':self.public_user(u),'rides':rides},None
        if path=='/api/availability' and method=='POST':
            if role!='driver': raise Problem('Drivers only.',403)
            online=d.get('online')
            if not isinstance(online,bool): raise Problem('Invalid availability.')
            c.execute('UPDATE users SET online=? WHERE id=?',(int(online),uid)); return {'ok':True},None
        if path=='/api/location' and method=='POST':
            lat=number(d,'lat',-90,90); lng=number(d,'lng',-180,180)
            c.execute('UPDATE users SET lat=?,lng=? WHERE id=?',(lat,lng,uid)); return {'ok':True},None
        if path=='/api/rides' and method=='POST':
            if role!='customer': raise Problem('Customers only.',403)
            if c.execute("SELECT 1 FROM rides WHERE customer_id=? AND status NOT IN ('completed','cancelled')",(uid,)).fetchone(): raise Problem('Finish or cancel your current ride first.',409)
            pickup=text_value(d,'pickup'); dest=text_value(d,'destination')
            plat=number(d,'plat',-90,90); plng=number(d,'plng',-180,180); dlat=number(d,'dlat',-90,90); dlng=number(d,'dlng',-180,180)
            km=distance(plat,plng,dlat,dlng)
            if km<0.1: raise Problem('Pickup and destination must be at least 100 metres apart.')
            currency=str(d.get('currency','USD')).upper()
            if currency not in CURRENCIES: raise Problem('Choose a supported currency.')
            budget=number(d,'budget',1,100000)
            rid=c.execute('INSERT INTO rides(customer_id,pickup,destination,plat,plng,dlat,dlng,distance,currency,budget,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(uid,pickup,dest,plat,plng,dlat,dlng,km,currency,budget,now,now)).lastrowid
            return {'id':rid},None
        match=re.fullmatch(r'/api/rides/(\d+)/(offer|accept|status|chat|rate|receipt)',path)
        if not match or method!=('GET' if match[2]=='receipt' else 'POST'): raise Problem('Not found.',404)
        rid=int(match[1]); action=match[2]
        row=c.execute('SELECT * FROM rides WHERE id=?',(rid,)).fetchone()
        if not row: raise Problem('Ride not found.',404)
        r=dict(row); participant=uid in (r['customer_id'],r['driver_id'])
        if action=='receipt':
            if not participant: raise Problem('Access denied.',403)
            if r['status']!='completed' or not r['cash_confirmed']: raise Problem('A receipt is available after the driver confirms cash payment.',409)
            return {'receipt':{
                'number':f'JAWA-{rid:08d}', 'ride_id':rid,
                'customer':c.execute('SELECT name FROM users WHERE id=?',(r['customer_id'],)).fetchone()['name'],
                'driver':c.execute('SELECT name FROM users WHERE id=?',(r['driver_id'],)).fetchone()['name'],
                'pickup':r['pickup'], 'destination':r['destination'],
                'amount':r['fare'], 'currency':r['currency'], 'payment_method':'cash',
                'completed_at':r['updated'], 'confirmation':'Cash receipt confirmed by driver. Not a tax invoice.'
            }},None
        if action=='offer':
            if role!='driver' or not u['online']: raise Problem('Go online as a driver first.',403)
            if r['status']!='requested': raise Problem('This request is no longer available.',409)
            if c.execute("SELECT 1 FROM rides WHERE driver_id=? AND status NOT IN ('completed','cancelled')",(uid,)).fetchone(): raise Problem('Finish your active trip first.',409)
            fare=number(d,'fare',1,100000); eta=number(d,'eta',1,180)
            if eta!=int(eta): raise Problem('Arrival time must be a whole number of minutes.')
            c.execute('INSERT INTO offers(ride_id,driver_id,fare,eta,created) VALUES(?,?,?,?,?) ON CONFLICT(ride_id,driver_id) DO UPDATE SET fare=excluded.fare,eta=excluded.eta,created=excluded.created,version=offers.version+1',(rid,uid,round(fare,2),int(eta),now))
        elif action=='accept':
            if uid!=r['customer_id']: raise Problem('Only the customer can accept.',403)
            if r['status']!='requested': raise Problem('An offer has already been accepted or the ride was cancelled.',409)
            offer_id=d.get('offer_id')
            if not isinstance(offer_id,int) or isinstance(offer_id,bool): raise Problem('Choose a valid offer.')
            offer=c.execute('SELECT offers.*,users.online FROM offers JOIN users ON users.id=offers.driver_id WHERE offers.id=? AND ride_id=?',(offer_id,rid)).fetchone()
            if not offer or not offer['online']: raise Problem('This driver is no longer available.',409)
            if type(d.get('offer_version')) is not int or d['offer_version']!=offer['version']:
                raise Problem('The offer changed. Review the latest fare and arrival time before accepting.',409)
            if c.execute("SELECT 1 FROM rides WHERE driver_id=? AND status NOT IN ('completed','cancelled')",(offer['driver_id'],)).fetchone(): raise Problem('Driver is on another trip.',409)
            c.execute("UPDATE rides SET driver_id=?,fare=?,status='accepted',updated=?,pickup_pin=? WHERE id=?",(offer['driver_id'],offer['fare'],now,f'{secrets.randbelow(1000000):06d}',rid))
        elif action=='status':
            if not participant: raise Problem('Access denied.',403)
            target=d.get('status'); current=r['status']
            if target=='cancelled':
                if current not in ('requested','accepted','arrived'): raise Problem('This ride can no longer be cancelled.',409)
            else:
                if uid!=r['driver_id']: raise Problem('Only the assigned driver can advance the trip.',403)
                transitions={'accepted':'arrived','arrived':'in_progress','in_progress':'completed'}
                if transitions.get(current)!=target: raise Problem('Invalid trip transition.',409)
                if target=='in_progress':
                    if r['pin_locked_until']>now: raise Problem('Too many incorrect pickup codes. Try again in one minute.',429)
                    pin=d.get('pickup_pin')
                    if not isinstance(pin,str) or not re.fullmatch(r'[0-9]{6}',pin) or not secrets.compare_digest(pin,r['pickup_pin'] or ''):
                        failures=(0 if r['pin_locked_until'] else r['pin_failures'])+1
                        c.execute('UPDATE rides SET pin_failures=?,pin_locked_until=? WHERE id=?',(failures,now+60 if failures>=5 else 0,rid))
                        c.commit()
                        raise Problem('Pickup code is incorrect.' if failures<5 else 'Too many incorrect pickup codes. Try again in one minute.',400 if failures<5 else 429)
                if target=='completed' and d.get('cash_received') is not True: raise Problem('Confirm receipt of the cash fare first.')
            c.execute('UPDATE rides SET status=?,updated=?,cash_confirmed=? WHERE id=?',(target,now,int(target=='completed'),rid))
            if target in ('in_progress','cancelled'):
                c.execute('UPDATE rides SET pickup_pin=NULL,pin_failures=0,pin_locked_until=0 WHERE id=?',(rid,))
        elif action=='chat':
            if not participant or not r['driver_id']: raise Problem('Chat is available to the assigned customer and driver.',403)
            if r['status'] in ('completed','cancelled'): raise Problem('This trip chat is closed.',409)
            body=text_value(d,'body',1000)
            c.execute('INSERT INTO messages(ride_id,user_id,body,created) VALUES(?,?,?,?)',(rid,uid,body,now))
        elif action=='rate':
            if uid!=r['customer_id'] or r['status']!='completed': raise Problem('Only completed trips can be rated by their customer.',403)
            stars=number(d,'stars',1,5)
            if stars!=int(stars): raise Problem('Choose a whole number of stars.')
            c.execute('INSERT INTO ratings VALUES(?,?,?)',(rid,int(stars),uid))
        return {'ok':True},None

if __name__=='__main__':
    initialize()
    server=ThreadingHTTPServer((os.environ.get('HOST','0.0.0.0'),int(os.environ.get('PORT','3000'))),Handler)
    print('Jawa Ride listening on port '+str(server.server_port),flush=True)
    server.serve_forever()
