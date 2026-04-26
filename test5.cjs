const express = require('express');
const app = express();
app.get('/test', (req, res) => {
  res.json("<html><body>hello</body></html>");
});
app.listen(4005, () => {
  console.log("ready");
  fetch('http://localhost:4005/test').then(r => r.text()).then(t => {
     console.log('RAW_BODY:', t);
     process.exit(0);
  });
});
