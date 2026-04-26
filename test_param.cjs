const axios = require('axios');
async function testSchema() {
  try {
     const res = await axios.post('https://api.tastyworks.com/sessions', {
       login: "zeldagoncalves@gmail.com",
       password: "fakepassword",
       rememberMe: true,
       "two-factor-token": "123456",
       "remember-token": "foo",
       otp: "123456"
     }, {
       headers: {
         'User-Agent': 'Mozilla/5.0'
       }
     });
     console.log(res.status, res.data);
  } catch (err) {
     console.log(err.response?.status, err.response?.data);
  }
}
testSchema();
