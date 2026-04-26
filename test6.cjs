const express = require('express');
const { createServer } = require('vite');

async function test() {
  const app = express();
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'spa'
  });
  
  app.use(vite.middlewares);
  
  app.listen(4006, async () => {
    const res = await fetch('http://localhost:4006/api/missing', { method: 'POST' });
    const text = await res.text();
    console.log('STATUS:', res.status, 'BODY:', text.substring(0, 50));
    process.exit(0);
  });
}
test();
