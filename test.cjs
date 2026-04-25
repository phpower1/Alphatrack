const axios = require('axios');

async function test(url) {
  try {
    let res = await axios.get(url, {
      maxRedirects: 0,
      validateStatus: s => s < 400 || s === 405
    });
    console.log(url, res.status, res.headers.location);
  } catch(e) {
    console.log(url, e.response ? e.response.status : e.message, e.response ? e.response.headers.location : '');
  }
}

test('https://manage.tastytrade.com/oauth/authorize?client_id=c8f263c2-f7a9-4e98-b940-59b2eb0ba34b&redirect_uri=x&response_type=code');
test('https://my.tastytrade.com/oauth/authorize?client_id=x&redirect_uri=x&response_type=code');
test('https://my.tastyworks.com/oauth/authorize?client_id=x');
