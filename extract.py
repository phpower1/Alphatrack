import urllib.request
import re

url = "https://developer.tastytrade.com/oauth/"
try:
    with urllib.request.urlopen(url) as response:
        html = response.read().decode('utf-8')
        links = re.findall(r'href=[\'"]?([^\'" >]+)', html)
        oauth_links = [l for l in links if 'oauth' in l.lower() or 'authorize' in l.lower() or 'token' in l.lower()]
        print("LINKS:", oauth_links)
        
        matches = re.finditer(r'https://[^"\s]+', html)
        for m in matches:
            v = m.group(0)
            if 'oauth' in v or 'authorize' in v or 'token' in v:
                print("FOUND:", v)
except Exception as e:
    print("ERROR:", e)
