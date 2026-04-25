import https from 'https';

https.get('https://developer.tastytrade.com/oauth/', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    // Find oauth endpoints
    const matches = data.match(/https:\/\/[A-Za-z0-9\-\.\/]+/g);
    if (matches) {
      const endpoints = matches.filter(url => url.includes('oauth') || url.includes('authorize') || url.includes('token') || url.includes('platform'));
      console.log(Array.from(new Set(endpoints)).join('\n'));
    }
  });
});
