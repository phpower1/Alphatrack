const axios = require('axios');
async function testSchema() {
  try {
     const res = await axios.post('https://api.tastyworks.com/sessions', {
       login: "dummy_not_exists123_456@gmail.com",
       password: "fakepassword123",
     }, {
       headers: {
         'User-Agent': 'Mozilla/5.0'
       }
     });
  } catch (err) {
     console.log(err.response?.status, err.response?.data);
  }
}
testSchema();
