#!/usr/bin/env node
const { chromium } = require("playwright");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:7000";
const TIMEOUT = Number(process.env.TIMEOUT_MS || 60000);
const GURU_COUNT = Number(process.env.GURU_COUNT || 20);
const JAV18_COUNT = Number(process.env.JAV18_COUNT || 10);
const JAVPOST_COUNT = Number(process.env.JAVPOST_COUNT || 10);

const GURU_URLS = [
  "https://jav.guru/1046649/dldss-531-dahlia-s-shocking-transfer-goddess-jun-reincarnated-the-miraculous-venus-descends/",
  "https://jav.guru/1046008/olm-354e-the-elegant-bitch-woman-is-extremely-horny-from-lack-of-men-she-climaxex-luxurious-perverses-play-tomoda/",
  "https://jav.guru/1046409/start-635-99-shots-of-real-cum-splashed-all-over-akari-matsunaga-complete-career-change-sod-raw-cum/",
  "https://jav.guru/1046418/start-601-it-seems-that-rui-chan-from-miss-a-universe-got-a-job-of-female-hero-then-got-gangbanged-by-her-husband/",
  "https://jav.guru/1046424/mrec-010-sex-record-010-ririko-kinoshita-av-debut-cumming-out-to-her-husbands-best-friend-with-a-man-they-hate/",
  "https://jav.guru/1046436/drop-141-amateur-girls-first-erotic-dildo-masturbation-7/",
  "https://jav.guru/1046439/doks-690-a-devoted-and-erotic-blowjob-to-make-you-cum-repeatedly/",
  "https://jav.guru/1046440/doks-689-a-collection-of-aphrodisiac-harassment-records-by-a-certain-manager/",
  "https://jav.guru/1046441/doks-688-the-ultimate-angle-for-easy-handjobs-detailed-diving-into-fellatio-2/",
  "https://jav.guru/1046442/doks-687-the-beautiful-legged-office-lady-rced-to-be-the-sexual-servant-of-her-old-man-boss-predesed/",
  "https://jav.guru/1046619/skt-006-shikota-holdings-inc-velota-this-woman-just-keeps-kissing-my-tongue-kiss/",
  "https://jav.guru/1046629/jur-674-subs-after-the-graduation-ceremony-a-gift-from-your-stepmother-to-you-now-that-youve-become-an-adult-mojimi/",
  "https://jav.guru/1046620/skt-005-shikota-co-ltd-do-you-like-my-ass-boobs-kissy-kiss/",
  "https://jav.guru/1046623/nld-033-nipple-pleasure-saloon/",
  "https://jav.guru/1046627/mimk-267-subs-series-of-sales-of-8-million-copies-the-horny-classmate-manga-then-be-get-deep-throat-by-her-massager-kit/",
  "https://jav.guru/1046634/iesp-765-run-amazes-newlywed-life-of-making-babies-17-times/",
  "https://jav.guru/1046639/gas-546-amateur-gathering-for-big-tit-lovers-i-want-to-get-creampied-with-noah-hazuki/",
  "https://jav.guru/1046630/jur-671-subs-female-interrogation-circle-recruitment-cycle-that-fucks-to-confess/",
  "https://jav.guru/1046631/jur-670-subs-female-prisoner-x-the-erotic-torture-room/",
  "https://jav.guru/1046640/fns-252-i-want-you-to-kiss-me-then-go-deep-with-mixed-fluids-kashikawa-shizuku/",
];

const JAVPOST_URLS = [
  "https://www.javpost.net/SONE-022-Censored/",
  "https://www.javpost.net/SONE-028-Censored/",
  "https://www.javpost.net/DLDSS-005-Censored/",
  "https://www.javpost.net/SSIS-949-Censored/",
  "https://www.javpost.net/MIDV-783-Censored/",
  "https://www.javpost.net/MIDV-775-Censored/",
  "https://www.javpost.net/MIDV-770-Censored/",
  "https://www.javpost.net/MIDV-765-Censored/",
  "https://www.javpost.net/FNS-254-Censored/",
  "https://www.javpost.net/MIST-529-Censored/",
];

const JAV18_URLS = [
  "https://18jav.tv/videos/hnd-765",
  "https://18jav.tv/videos/jufe-130",
  "https://18jav.tv/videos/dasd-572",
  "https://18jav.tv/videos/meyd-532",
  "https://18jav.tv/videos/mide-733",
  "https://18jav.tv/videos/sdmf-009",
  "https://18jav.tv/videos/cjod-224",
  "https://18jav.tv/videos/vec-383",
  "https://18jav.tv/videos/ebod-725",
  "https://18jav.tv/videos/ngod-101",
];

function makeId(url) {
  if (url.startsWith("https://18jav.tv/")) return "18jav:" + Buffer.from(url).toString("base64url");
  return "avmirror:" + Buffer.from(url).toString("base64url");
}

async function testStream(page, url, source) {
  const id = makeId(url);
  const streamUrl = `${BASE}/stream/movie/${id}.json`;
  const start = Date.now();
  try {
    const response = await page.goto(streamUrl, { timeout: TIMEOUT, waitUntil: "domcontentloaded" });
    const json = JSON.parse(await response.text());
    const streams = (json.streams || []).filter(s => s.url || s.externalUrl);
    const elapsed = Date.now() - start;
    if (streams.length > 0) {
      const playable = streams.filter(s => s.url && !s.externalUrl);
      return { source, url: url.slice(0, 80), status: "OK", players: streams.length, playable: playable.length, elapsed };
    }
    return { source, url: url.slice(0, 80), status: "EMPTY", players: 0, elapsed };
  } catch (e) {
    return { source, url: url.slice(0, 80), status: "ERROR", error: e.message.slice(0, 80), elapsed: Date.now() - start };
  }
}

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || "/usr/bin/chromium-browser",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const all = [
    ...GURU_URLS.slice(0, GURU_COUNT).map(u => ["Jav.guru", u]),
    ...JAVPOST_URLS.slice(0, JAVPOST_COUNT).map(u => ["JavPost", u]),
    ...JAV18_URLS.slice(0, JAV18_COUNT).map(u => ["18Jav", u]),
  ];

  const results = [];
  for (const [source, url] of all) {
    const result = await testStream(page, url, source);
    results.push(result);
    const icon = result.status === "OK" ? "✓" : result.status === "EMPTY" ? "○" : "✗";
    console.log(`${icon} [${result.source}] ${result.url} → ${result.status} (${result.players || 0} players, ${result.elapsed}ms)${result.error ? " " + result.error : ""}`);
  }

  await browser.close();

  const ok = results.filter(r => r.status === "OK");
  const empty = results.filter(r => r.status === "EMPTY");
  const err = results.filter(r => r.status === "ERROR");
  console.log(`\n=== RESULTADO: ${ok.length}/${results.length} OK, ${empty.length} vazios, ${err.length} erros ===`);
  for (const r of err) console.log(`  ERRO: [${r.source}] ${r.url} → ${r.error}`);

  process.exit(err.length > 0 ? 1 : 0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
