const axios = require('axios');
async function test() {
  try {
    const res = await axios.post('http://localhost:3000/api/tastytrade/session', {
      login: 'zeldagoncalves@gmail.com',
      password: 'fakepassword'
    });
    console.log(res.status);
  } catch (err) {
    if (err.response) {
      console.log(err.response.status, typeof err.response.data, err.response.data);
    } else {
      console.log(err.message);
    }
  }
}
test();
