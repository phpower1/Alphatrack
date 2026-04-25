const axios = require('axios');

async function testLocalProxy() {
  try {
    const res = await axios.post('http://localhost:3000/api/tastytrade/session', {
      login: 'zeldagoncalves@gmail.com',
      password: 'fakepassword',
    });
    console.log('SUCCESS', res.status, res.data);
  } catch(e) {
    console.log('PROXY STATUS', e.response?.status);
    console.log('PROXY DATA', typeof e.response?.data === 'string' ? e.response?.data.substring(0, 500) : e.response?.data);
  }
}

testLocalProxy();
