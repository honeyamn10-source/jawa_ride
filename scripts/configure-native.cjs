const fs=require('node:fs');
const url=process.env.JAWA_APP_URL;
if(!url)throw new Error('Set JAWA_APP_URL to your deployed HTTPS Jawa Ride backend URL. Native builds need a reachable backend.');
const parsed=new URL(url);
if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw new Error('JAWA_APP_URL must be an HTTPS origin without credentials, path, query or fragment.');
fs.writeFileSync('capacitor.config.json',JSON.stringify({appId:'app.jawaride.mobile',appName:'Jawa Ride',webDir:'public',server:{url:parsed.origin,cleartext:false}},null,2)+'\n');
console.log('Native configuration written. Run npm run native:sync.');
