const axios = require('axios');

async function testWAF() {
  try {
    console.log('Sending request...');
    const result = await axios.post('https://api.tastyworks.com/sessions', {
      login: 'zeldagoncalves@gmail.com',
      password: 'fakepassword',
      rememberMe: true
    });
    console.log(result.status);
  } catch (err) {
    if (err.response) {
       console.log('STATUS:', err.response.status);
       console.log('DATA:', typeof err.response.data === 'string' ? err.response.data.substring(0, 100) : err.response.data);
       console.log('BODY TYPE:', typeof err.response.data);
    } else {
       console.log('ERR:', err.message);
    }
  }
}

testWAF();
