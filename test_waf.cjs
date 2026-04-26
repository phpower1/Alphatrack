const axios = require('axios');

async function testWaf() {
  try {
     const res = await axios.post('https://api.tastyworks.com/sessions', {
       login: "zeldagoncalves@gmail.com",
       password: "fakepassword"
     }, {
       headers: {
         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
         'Accept': 'application/json'
       }
     });
  } catch (e) {
     console.log('STATUS:', e.response?.status);
     console.log('TYPE:', typeof e.response?.data);
     if (typeof e.response?.data === 'string') {
        console.log('BODY:', e.response?.data.substring(0, 300));
     } else {
        console.log('BODY:', e.response?.data);
     }
  }
}

testWaf();
