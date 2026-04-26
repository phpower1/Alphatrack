const axios = require('axios');
async function run() {
  try {
     let res = await axios.post('https://api.tastyworks.com/sessions', {
        login: 'abc@gmail.com', password: '123', rememberMe: true
     });
     console.log('SUCCESS', res.data);
  } catch(e) {
     if (e.response) {
       console.log('AXIOS ERROR', e.response.status, typeof e.response.data, typeof e.response.data === 'string' ? e.response.data.substring(0, 100) : e.response.data);
     } else {
       console.log('AXIOS ERROR (no response)', e.message);
     }
  }
}
run();
