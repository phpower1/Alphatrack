const express = require('express');
const app = express();
app.get('/test', (req, res) => {
  res.json("<!DOCTYPE HTML><html></html>");
});

app.listen(4012, async () => {
   const res = await fetch('http://localhost:4012/test');
   const text = await res.text();
   console.log('STATUS:', res.status);
   console.log('BODY:', text);
   try {
      console.log('PARSED:', JSON.parse(text));
   } catch(e) {
      console.log('PARSE ERROR:', e.message);
   }
   process.exit(0);
});
