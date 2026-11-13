// Rate Check: a Slack slash command that posts the latest Bank of Canada
// policy rate and USD/CAD rate into the channel.
// No dependencies. Node 20 or newer.
const http = require('node:http');
const crypto = require('node:crypto');

const PORT = process.env.PORT || 3000;
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '';
const VALET = 'https://www.bankofcanada.ca/valet/observations/V39079,FXUSDCAD/json?recent=1';

// Check that the request really came from Slack.
function isFromSlack(req, body) {
  if (!SIGNING_SECRET) return false;
  const ts = req.headers['x-slack-request-timestamp'];
  const sig = req.headers['x-slack-signature'];
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const mine = 'v0=' + crypto.createHmac('sha256', SIGNING_SECRET).update(`v0:${ts}:${body}`).digest('hex');
  const a = Buffer.from(mine);
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function latestRates() {
  const res = await fetch(VALET, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error(`Bank of Canada returned ${res.status}`);
  const data = await res.json();
  const out = {};
  for (const row of data.observations) {
    if (row.V39079) out.policy = { value: row.V39079.v, date: row.d };
    if (row.FXUSDCAD) out.fx = { value: row.FXUSDCAD.v, date: row.d };
  }
  return out;
}

function reply(rates, ask) {
  const lines = [];
  if (ask !== 'fx' && rates.policy) lines.push(`*Bank of Canada policy rate:* ${rates.policy.value}% (as of ${rates.policy.date})`);
  if (ask !== 'rate' && rates.fx) lines.push(`*USD/CAD:* ${rates.fx.value} Canadian dollars per US dollar (daily average, ${rates.fx.date})`);
  lines.push('Source: Bank of Canada Valet API');
  return { response_type: 'in_channel', text: lines.join('\n') };
}

const HELP = {
  response_type: 'ephemeral',
  text: 'Try `/ratecheck` for both numbers, `/ratecheck rate` for the policy rate, or `/ratecheck fx` for USD/CAD.',
};

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok');
  }
  if (req.method !== 'POST' || req.url !== '/slack/ratecheck') {
    res.writeHead(404);
    return res.end();
  }
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
  req.on('end', async () => {
    if (!isFromSlack(req, body)) {
      res.writeHead(401);
      return res.end('bad signature');
    }
    const params = new URLSearchParams(body);
    const ask = (params.get('text') || '').trim().toLowerCase();
    let payload;
    if (ask === 'help' || (ask && ask !== 'rate' && ask !== 'fx')) {
      payload = HELP;
    } else {
      try {
        payload = reply(await latestRates(), ask);
      } catch (e) {
        payload = { response_type: 'ephemeral', text: 'The Bank of Canada data did not load in time. Try again in a minute.' };
      }
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
});

if (require.main === module) server.listen(PORT, () => console.log(`Rate Check listening on ${PORT}`));
module.exports = { server, isFromSlack, reply };
