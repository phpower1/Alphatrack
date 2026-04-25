const axios = require('axios');

async function testCloudFront() {
  try {
    const response = await axios.post('https://api.tastyworks.com/sessions', {
      login: 'zeldagoncalves@gmail.com',
      password: 'fakepassword',
      rememberMe: true
    }, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    console.log('SUCCESS', response.status);
  } catch (err) {
    if (err.response) {
      console.log('STATUS:', err.response.status);
      console.log('DATA:', typeof err.response.data === 'string' ? err.response.data.substring(0, 200) : err.response.data);
    } else {
      console.log('ERROR:', err.message);
    }
  }
}

testCloudFront();
