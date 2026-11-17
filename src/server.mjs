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

// Хранилище активных и завершённых прогонов (строго изолировано по runId)
const runs = new Map();

function appendLogAsync(runId, entry) {
  const safeId = String(runId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(LOG_DIR, XXXINLINECODEXXX41XXXINLINECODEXXX);
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

const server = http.createServer(async (req, res) => {
  // Полный CORS + Private Network Access для браузерной песочницы арены
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, XXXINLINECODEXXX42XXXINLINECODEXXX);

  // 1. Healthcheck Арены
  if (url.pathname === '/v1/health' && req.method === 'GET') {
    return sendJson(res, 200, { status: 'ok' });
  }

  // 2. Эндпоинты турнира: /v1/runs/{runId}/{start|event|finish}
  const runMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/(start|event|finish)$/);
  if (runMatch && req.method === 'POST') {
    const runId = decodeURIComponent(runMatch[1]);
    const action = runMatch[2];

    let body = {};
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { error: 'Invalid JSON' });
    }

    if (action === 'start') {
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
      if (!record) {
        // Защита, если event пришёл без предварительного start
        record = {
          runId,
          mode: req.headers['x-arena-mode'] || 'arena',
          startedAt: new Date().toISOString(),
          finished: false,
          bot: new FactoryBot({}),
          telemetry: { profitHistory: [], lastState: null, salesLog: [], commandsLog: [], report: null }
        };
        runs.set(runId, record);
      }

      const seq = body.seq ?? Number(req.headers['x-arena-seq'] || 0);
      const payload = { ...body, seq };
      const commands = record.bot.handleEvent(payload);
      const elapsedMs = Math.round((performance.now() - t0) * 100) / 100;

      // Обновляем телеметрию для дашборда
      if (body.state) {
        record.telemetry.lastState = body.state;
        const money = body.state.money ?? body.state.balance ?? 0;
        const t = body.t ?? 0;
        const hist = record.telemetry.profitHistory;
        if (hist.length === 0 || hist[hist.length - 1].t !== t) {
          hist.push({
            t,
            money,
            itemsCount: (body.state.items || body.state.inventory || []).length
          });
        }
      }
      if (body.event?.type === 'sale_result' || body.event?.event === 'sale_result') {
        record.telemetry.salesLog.unshift({ t: body.t, ...body.event });
        if (record.telemetry.salesLog.length > 50) record.telemetry.salesLog.pop();
      }
      if (commands.length > 0) {
        record.telemetry.commandsLog.unshift({ t: body.t, seq, commands, elapsedMs });
        if (record.telemetry.commandsLog.length > 50) record.telemetry.commandsLog.pop();
      }

      appendLogAsync(runId, { ts: Date.now(), action: 'event', seq, t: body.t, event: body.event, commands, elapsedMs });
      return sendJson(res, 200, { commands });
    }

    if (action === 'finish') {
      const record = runs.get(runId);
      if (record) {
        record.finished = true;
        record.finishedAt = new Date().toISOString();
        record.telemetry.report = body.report || body;
      }
      appendLogAsync(runId, { ts: Date.now(), action: 'finish', body });
      return sendJson(res, 200, { ok: true });
    }
  }

  // 3. API для веб-интерфейса (мониторинг прогонов и запуск локальной симуляции)
  if (url.pathname === '/api/runs' && req.method === 'GET') {
    const list = [...runs.values()].map(r => ({
      runId: r.runId,
      mode: r.mode,
      startedAt: r.startedAt,
      finished: r.finished,
      lastTick: r.telemetry.lastState?.t ?? 0,
      money: r.telemetry.lastState?.money ?? r.telemetry.report?.profit ?? 0
    }));
    return sendJson(res, 200, { runs: list.reverse() });
  }

  const apiRunMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (apiRunMatch && req.method === 'GET') {
    const runId = decodeURIComponent(apiRunMatch[1]);
    const record = runs.get(runId);
    if (!record) return sendJson(res, 404, { error: 'Run not found' });

    const buyersBelief = [...record.bot.buyers.values()].map(b => ({
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

    const simId = XXXINLINECODEXXX43XXXINLINECODEXXX;
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

  // 4. Раздача веб-интерфейса
  if ((url.pathname === '/' || url.pathname === '/index.html') && req.method === 'GET') {
    const htmlPath = path.join(__dirname, '..', 'web', 'index.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(htmlPath).pipe(res);
      return;
    }
  }

  sendJson(res, 404, { error: 'Not Found' });
});

server.listen(PORT, () => {
  console.log(XXXINLINECODEXXX44XXXINLINECODEXXX);
  console.log(XXXINLINECODEXXX45XXXINLINECODEXXX);
});
