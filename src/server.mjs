import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { FactoryBot, NaiveBot } from './bot.mjs';
import { ArenaEmulator } from './engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const LOG_DIR = path.join(__dirname, '..', 'logs');

fs.mkdirSync(LOG_DIR, { recursive: true });

const runs = new Map();

function appendLogAsync(runId, entry) {
  const safeId = String(runId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(LOG_DIR, `${safeId}.jsonl`);
  fs.promises.appendFile(filePath, JSON.stringify(entry) + '\n').catch(() => {});
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(() => {
    if (!res.headersSent) sendJson(res, 500, { error: { code: 'internal_error', message: 'Не удалось обработать запрос' } });
    else if (!res.writableEnded) res.end();
  });
});

async function handleRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Arena-Run, X-Arena-Spec, X-Arena-Mode, X-Arena-Seq');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const baseUrl = `http://${req.headers.host ?? 'localhost:8080'}`;
  const url = new URL(req.url, baseUrl);

  // Healthcheck
  if (url.pathname === '/v1/health' && req.method === 'GET') {
    return sendJson(res, 200, { status: 'ok' });
  }

  // /v1/runs/{runId}/{start|event|finish}
  const runMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/(start|event|finish)$/);
  if (runMatch && req.method === 'POST') {
    const runId = decodeURIComponent(runMatch[1]);
    const action = runMatch[2];

    let body = {};
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { error: { code: 'invalid_json', message: 'Некорректный JSON' } });
    }

    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return sendJson(res, 400, { error: { code: 'invalid_body', message: 'Тело запроса должно быть объектом' } });
    }

    if (action === 'start') {
      if ((body.machines !== undefined && !Array.isArray(body.machines)) || (body.buyers !== undefined && !Array.isArray(body.buyers))) {
        return sendJson(res, 400, { error: { code: 'invalid_body', message: 'machines и buyers должны быть массивами' } });
      }
      const bot = new FactoryBot(body);
      const record = {
        runId,
        mode: req.headers['x-arena-mode'] || 'arena',
        startedAt: new Date().toISOString(),
        finished: false,
        bot,
        telemetry: {
          profitHistory: [],
          lastState: null,
          salesLog: [],
          commandsLog: [],
          robotsProduced: 0,
          robotsSold: 0,
          seenSeq: new Set(),
          report: null
        }
      };
      runs.set(runId, record);
      appendLogAsync(runId, { ts: Date.now(), action: 'start', body });
      return sendJson(res, 200, { ok: true });
    }

    if (action === 'event') {
      const t0 = performance.now();
      let record = runs.get(runId);
      if (record?.finished) return sendJson(res, 409, { error: { code: 'run_finished', message: 'Прогон завершён' } });
      if (!record) {
        record = {
          runId,
          mode: req.headers['x-arena-mode'] || 'arena',
          startedAt: new Date().toISOString(),
          finished: false,
          bot: new FactoryBot({}),
          telemetry: {
            profitHistory: [],
            lastState: null,
            salesLog: [],
            commandsLog: [],
            robotsProduced: 0,
            robotsSold: 0,
            seenSeq: new Set(),
            report: null
          }
        };
        runs.set(runId, record);
      }

      const seq = body.seq ?? Number(req.headers['x-arena-seq'] || 0);
      const isNewEvent = !record.telemetry.seenSeq.has(seq);
      record.telemetry.seenSeq.add(seq);
      const payload = { ...body, seq };
      const commands = record.bot.handleEvent(payload).map(({ type, ...command }) => ({ cmd: type, ...command }));
      const elapsedMs = Math.round((performance.now() - t0) * 100) / 100;

      if (body.state && isNewEvent) {
        record.telemetry.lastState = { ...body.state, t: body.t ?? 0 };
        const money = body.state.cash ?? body.state.money ?? body.state.balance ?? 0;
        const t = body.t ?? 0;
        const hist = record.telemetry.profitHistory;
        if (hist.length === 0 || hist[hist.length - 1].t !== t) {
          hist.push({
            t,
            money,
            itemsCount: (body.state.storage?.items || body.state.items || body.state.inventory || []).length
          });
        } else {
          hist[hist.length - 1] = { t, money, itemsCount: (body.state.storage?.items || body.state.items || body.state.inventory || []).length };
        }
      }
      if (isNewEvent && body.event?.type === 'machine_done' && body.event.item?.kind === 'robot') record.telemetry.robotsProduced++;
      if (isNewEvent && (body.event?.type === 'sale_result' || body.event?.event === 'sale_result')) {
        if (body.event.outcome === 'sold') record.telemetry.robotsSold++;
        record.telemetry.salesLog.unshift({ t: body.t, ...body.event });
        if (record.telemetry.salesLog.length > 50) record.telemetry.salesLog.pop();
      }
      if (isNewEvent && commands.length > 0) {
        record.telemetry.commandsLog.unshift({ t: body.t, seq, commands, elapsedMs });
        if (record.telemetry.commandsLog.length > 50) record.telemetry.commandsLog.pop();
      }

      appendLogAsync(runId, { ts: Date.now(), action: 'event', seq, t: body.t, event: body.event, report: body.report, commands, elapsedMs });
      return sendJson(res, 200, { commands });
    }

    if (action === 'finish') {
      const record = runs.get(runId);
      if (record) {
        record.finished = true;
        record.finishedAt = new Date().toISOString();
        record.telemetry.report = body.report || body;
        record.bot = null;
        record.telemetry.seenSeq.clear();
      }
      appendLogAsync(runId, { ts: Date.now(), action: 'finish', body });
      return sendJson(res, 200, { ok: true });
    }
  }

  // API для веб-интерфейса: /api/runs
  if (url.pathname === '/api/runs' && req.method === 'GET') {
    const list = [...runs.values()].map(r => ({
      runId: r.runId,
      mode: r.mode,
      startedAt: r.startedAt,
      finished: r.finished,
      lastTick: r.telemetry.lastState?.t ?? 0,
      money: r.telemetry.report?.profit ?? r.telemetry.lastState?.cash ?? r.telemetry.lastState?.money ?? 0
    }));
    return sendJson(res, 200, { runs: list.reverse() });
  }

  const apiRunMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (apiRunMatch && req.method === 'GET') {
    const runId = decodeURIComponent(apiRunMatch[1]);
    const record = runs.get(runId);
    if (!record) return sendJson(res, 404, { error: 'Run not found' });

    const buyersBelief = [...(record.bot?.buyers.values() || [])].map(b => ({
      buyerId: b.buyerId,
      cooldownUntil: b.cooldownUntil,
      salesCount: b.salesCount,
      offersCount: b.offersCount,
      hypotheses: b.hypotheses.filter(h => h.possible)
    }));

    return sendJson(res, 200, {
      runId: record.runId,
      mode: record.mode,
      finished: record.finished,
      telemetry: record.telemetry,
      buyersBelief
    });
  }

  // Локальная симуляция: /api/simulate
  if (url.pathname === '/api/simulate' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const seed = Number(body.seed ?? Math.floor(Math.random() * 100000));
    const horizon = Number(body.horizon ?? 650);

    const emuLevel3 = new ArenaEmulator({ seed, horizon });
    const botLevel3 = new FactoryBot(emuLevel3.getStartPayload());
    const report3 = emuLevel3.runFullShift(botLevel3);

    const emuNaive = new ArenaEmulator({ seed, horizon });
    const botNaive = new NaiveBot(emuNaive.getStartPayload());
    const reportNaive = emuNaive.runFullShift(botNaive);

    const simId = `sim-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    runs.set(simId, {
      runId: simId,
      mode: 'local-emulator',
      startedAt: new Date().toISOString(),
      finished: true,
      bot: botLevel3,
      telemetry: {
        profitHistory: report3.history,
        lastState: emuLevel3.getPublicState(),
        salesLog: [],
        commandsLog: [],
        report: report3,
        naiveComparison: reportNaive.profit
      }
    });

    return sendJson(res, 200, {
      simId,
      level3: report3,
      naiveProfit: reportNaive.profit
    });
  }

  // Раздача index.html
  if ((url.pathname === '/' || url.pathname === '/index.html') && req.method === 'GET') {
    const htmlPath = path.join(__dirname, '..', 'web', 'index.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(htmlPath).pipe(res);
      return;
    }
  }

  sendJson(res, 404, { error: 'Not Found' });
}

server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
  console.log(`Dashboard available at http://localhost:${PORT}`);
});
