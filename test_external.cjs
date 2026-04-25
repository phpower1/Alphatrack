const axios = require('axios');
async function test() {
  try {
    const res = await axios.post('https://ais-dev-kx6pemhd7nhpmnpdnzdq6s-242598958176.us-west2.run.app/api/tastytrade/session', {
      login: 'zeldagoncalves@gmail.com',
      password: 'fakepassword'
    });
    console.log(res.status, typeof res.data, res.data);
  } catch (err) {
    if (err.response) {
       console.log(err.response.status);
       console.log(typeof err.response.data, typeof err.response.data === 'string' ? err.response.data.substring(0, 200) : err.response.data);
    } else {
       console.log(err.message);
    }
  }
}
test();
