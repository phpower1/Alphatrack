const axios = require('axios');
async function test() {
  try {
     const res = await axios.post('https://api.tastyworks.com/sessions', {
       login: "zeldagoncalves@gmail.com",
       password: "fakepassword",
       rememberMe: true
     }, {
       headers: {
         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
         'Accept': 'application/json'
       }
     });
     console.log(res.status, res.data);
  } catch (err) {
     console.log('STATUS:', err.response?.status);
     console.log('BODY:', JSON.stringify(err.response?.data, null, 2));
  }
}
test();
