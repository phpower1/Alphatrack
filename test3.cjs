const http = require('http');

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/tastytrade/session',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
}, (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => console.log('HTTP', res.statusCode, data.substring(0, 500)));
});

req.on('error', console.error);
req.write(JSON.stringify({ login: 'a', password: 'b' }));
req.end();
