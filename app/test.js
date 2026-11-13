// Local test: signs a fake slash command the way Slack does and checks the reply.
const crypto = require('node:crypto');
process.env.SLACK_SIGNING_SECRET = 'local-test-secret';
process.env.PORT = '3999';
const { server } = require('./server.js');

function signed(body) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = 'v0=' + crypto.createHmac('sha256', 'local-test-secret').update(`v0:${ts}:${body}`).digest('hex');
  return { 'x-slack-request-timestamp': ts, 'x-slack-signature': sig, 'content-type': 'application/x-www-form-urlencoded' };
}

server.listen(3999, async () => {
  const url = 'http://localhost:3999/slack/ratecheck';
  const cases = [['', 200], ['rate', 200], ['fx', 200], ['help', 200]];
  let ok = true;
  for (const [text, want] of cases) {
    const body = `command=%2Fratecheck&text=${text}`;
    const r = await fetch(url, { method: 'POST', headers: signed(body), body });
    const j = await r.json();
    console.log(`/ratecheck ${text || '(blank)'} -> ${r.status} ${j.response_type}\n${j.text}\n`);
    if (r.status !== want) ok = false;
  }
  const bad = await fetch(url, { method: 'POST', headers: { 'x-slack-request-timestamp': '1', 'x-slack-signature': 'v0=nope' }, body: 'text=' });
  console.log(`unsigned request -> ${bad.status}`);
  if (bad.status !== 401) ok = false;
  server.close();
  console.log(ok ? 'ALL TESTS PASSED' : 'TESTS FAILED');
  process.exit(ok ? 0 : 1);
});
