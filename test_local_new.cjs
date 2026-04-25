const axios = require('axios');
async function test() {
  try {
     console.log('Fetching...');
     const res = await axios.post('http://localhost:3000/api/tt/connect', {
       userIdentifier: "zeldagoncalves@gmail.com",
       secretToken: "fakepassword"
     });
     console.log('SUCCESS:', res.status, res.data);
  } catch (err) {
     console.log('ERROR STATUS:', err.response?.status);
     console.log('ERROR DATA:', err.response?.data);
  }
}
test();
