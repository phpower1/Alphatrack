const axios = require('axios');

async function testSessions(url) {
  try {
    const res = await axios.post(url, {
      login: 'fakeuser@gmail.com',
      password: 'fakepassword',
      rememberMe: true
    }, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    console.log(url, res.status, res.data);
  } catch (error) {
    if (error.response) {
      console.log(url, error.response.status, error.response.headers['content-type']);
      if (typeof error.response.data === 'string') {
        console.log(error.response.data.substring(0, 100));
      } else {
         console.log(error.response.data);
      }
    } else {
      console.log(url, error.message);
    }
  }
}

testSessions('https://api.tastyworks.com/sessions');
testSessions('https://api.tastytrade.com/sessions');
testSessions('https://api.tastyworks.com/customers/me/accounts');
testSessions('https://api.cert.tastyworks.com/sessions');
