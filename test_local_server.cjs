const axios = require('axios');
async function test() {
  try {
     console.log('Fetching...');
     const res = await axios.post('http://localhost:3000/api/tastytrade/session', {
       login: "zeldagoncalves@gmail.com",
       password: "fakepassword"
     });
     console.log('SUCCESS:', res.status, res.data);
  } catch (err) {
     console.log('ERROR STATUS:', err.response?.status);
     console.log('ERROR DATA:', err.response?.data);
     if (typeof err.response?.data === 'string') {
        console.log('BODY:', err.response?.data.substring(0, 500));
     }
  }
}
test();
