import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const CRAWL_TIMEOUT_MS = Number(process.env.CRAWL_TIMEOUT_MS) || 20000;
const REACHABILITY_TIMEOUT_MS = Number(process.env.REACHABILITY_TIMEOUT_MS) || Math.min(7000, CRAWL_TIMEOUT_MS);
const USER_AGENT = 'Just-DDL-Crawler/1.0 (+https://just-agent.github.io/just-ddl/)';

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim().slice(0, 200) : null;
}

function fetchViaPowerShell(url) {
  if (process.platform !== 'win32') return null;
  const timeoutSec = Math.max(15, Math.ceil(CRAWL_TIMEOUT_MS / 1000) + 5);
  const escapedUrl = url.replace(/'/g, "''");
  const script = "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); (Invoke-WebRequest -Uri '" + escapedUrl + "' -UseBasicParsing -TimeoutSec " + timeoutSec + " -Headers @{ 'User-Agent'='Mozilla/5.0'; 'Accept-Language'='en-US,en;q=0.9' }).Content";
  for (const command of ['pwsh', 'powershell']) {
    const result = spawnSync(command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: (timeoutSec + 5) * 1000
    });
    if (result.status === 0 && result.stdout && result.stdout.trim().length > 1000) {
      return result.stdout;
    }
  }
  return null;
}

async function fetchSourcePage(source) {
  const report = {
    sourceId: source.id,
    source: source.name,
    url: source.url,
    items: [],
    reachable: false,
    httpStatus: null,
    finalUrl: null,
    title: null,
    contentLength: null,
    fetchedAt: new Date().toISOString(),
    note: 'Source reachability check only; curated data/items.json preserved until item parser is implemented.',
    error: null
  };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);
    const res = await fetch(source.url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT }
    });
    clearTimeout(timer);
    report.httpStatus = res.status;
    report.finalUrl = res.url;
    const text = await res.text();
    report.contentLength = text.length;
    report.title = extractTitle(text);
    report.reachable = res.status >= 200 && res.status < 400;
    report.note = report.reachable
      ? 'Source reachable. Curated data/items.json preserved until item parser is implemented.'
      : `Source returned HTTP ${res.status}. Curated data/items.json preserved.`;
  } catch (err) {
    report.error = err.name === 'AbortError' ? `Timeout after ${REACHABILITY_TIMEOUT_MS}ms` : err.message;
    report.note = `Source fetch failed: ${report.error}. Curated data/items.json preserved.`;
  }
  return report;
}

const CTFTIME_URL = 'https://ctftime.org/event/list/upcoming';
const CTFTIME_MIN_ITEMS = 5;
const CTFTIME_MAX_FUTURE_DAYS = Number(process.env.CTFTIME_MAX_FUTURE_DAYS) || 400;

const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };

async function parseCtftimeItems() {
  const report = {
    sourceId: 'ctftime',
    source: 'CTFtime',
    url: CTFTIME_URL,
    items: [],
    reachable: false,
    httpStatus: null,
    finalUrl: null,
    title: null,
    contentLength: null,
    fetchedAt: new Date().toISOString(),
    note: 'CTFtime upcoming events parser.',
    error: null,
    parsedItemCount: 0,
    invalidItemCount: 0,
    parserHealthy: false
  };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CRAWL_TIMEOUT_MS);
    const res = await fetch(CTFTIME_URL, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT }
    });
    clearTimeout(timer);
    report.httpStatus = res.status;
    report.finalUrl = res.url;
    const text = await res.text();
    report.contentLength = text.length;
    report.title = (text.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || null;
    report.reachable = res.status >= 200 && res.status < 400;

    if (!report.reachable) {
      report.note = 'CTFtime returned HTTP ' + res.status + '. No items parsed.';
      return report;
    }

    const rowRe = /<tr[^>]*>\s*<td[^>]*>\s*<a\s+href="([^"]+)">([\s\S]*?)<\/a><\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>/gi;
    let m;
    while ((m = rowRe.exec(text)) !== null) {
      const href = m[1];
      const title = m[2].replace(/<[^>]+>/g, '').trim();
      const deadlineText = m[3].replace(/<[^>]+>/g, ' ').trim();
      const format = m[4].replace(/<[^>]+>/g, ' ').trim();
      const location = m[5].replace(/<[^>]+>/g, ' ').trim();
      const decodedDeadline = deadlineText.replace(/&mdash;/g, '\u2014').replace(/&ndash;/g, '\u2013').replace(/&amp;/g, '&');

      const dateMatch = deadlineText.match(/(\d{1,2})\s+(\w{3})(?:\s+(\d{4}))?(?:,\s*)?(\d{1,2}:\d{2})\s+UTC/i);
      if (!dateMatch) continue;

      const day = dateMatch[1];
      const mon = MONTHS[dateMatch[2].toLowerCase()];
      let year = dateMatch[3];
      const time = dateMatch[4];

      if (!year) {
        const endYearMatch = decodedDeadline.match(/[\u2014\u2013-]\s*\d{1,2}\s+\w+\s+(\d{4})/i);
        if (endYearMatch) year = endYearMatch[1];
      }
      if (!year) {
        const allYears = decodedDeadline.match(/(\d{4})/g);
        if (allYears) year = allYears[allYears.length - 1];
      }
      if (!mon || !year) continue;

      const isoLike = year + '-' + String(mon).padStart(2,'0') + '-' + String(day).padStart(2,'0') + 'T' + time + ':00Z';
      const eventDate = new Date(isoLike);
      if (isNaN(eventDate.getTime())) continue;
      const daysFromNow = (eventDate.getTime() - Date.now()) / 86400000;
      if (daysFromNow < -7 || daysFromNow > CTFTIME_MAX_FUTURE_DAYS) {
        report.invalidItemCount += 1;
        continue;
      }

      const slugTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const eventMatch = href.match(/\/event\/([0-9]+)/);
      const itemId = 'ctftime-' + (eventMatch ? eventMatch[1] : slugTitle);

      const locLower = (location + ' ' + format).toLowerCase();
      const isOnline = locLower.includes('on-line') || locLower.includes('online') || locLower.includes('remote');

      report.items.push({
        id: itemId,
        title: title,
        deadline: isoLike,
        dateRange: decodedDeadline.replace(/\s+/g, ' ').trim(),
        location: isOnline ? 'Online' : location || 'TBD',
        isOnline: isOnline,
        tags: ['CTF', 'security', format || 'Jeopardy'],
        url: 'https://ctftime.org' + href,
        status: 'upcoming',
        description: 'Parsed from CTFtime upcoming events. Deadline represents the event start time, not a registration deadline.',
        stage: 'upcoming',
        source: 'ctftime',
        type: 'contest'
      });
    }
    report.parsedItemCount = report.items.length;
    report.parserHealthy = report.parsedItemCount >= CTFTIME_MIN_ITEMS;
    report.note = 'Parsed ' + report.parsedItemCount + ' items from CTFtime upcoming events; rejected ' + report.invalidItemCount + ' date-window outliers.';
  } catch (err) {
    report.error = err.name === 'AbortError' ? 'Timeout after ' + CRAWL_TIMEOUT_MS + 'ms' : err.message;
    report.note = 'CTFtime fetch failed: ' + report.error;
  }
  return report;
}

async function ctfTimeAdapter() {
  return parseCtftimeItems();
}
async function securityTrainingAdapter() {
  return fetchSourcePage({ id: "pwncollege", name: "pwn.college / security training boards", url: "https://pwn.college" });
}

async function bugcrowdAdapter() {
  return fetchSourcePage({ id: "bugcrowd", name: "Bugcrowd programs", url: "https://bugcrowd.com/programs" });
}

async function hackerOneAdapter() {
  return fetchSourcePage({ id: "hackerone", name: "HackerOne programs", url: "https://hackerone.com/directory/programs" });
}

const adapters = [ctfTimeAdapter, securityTrainingAdapter, bugcrowdAdapter, hackerOneAdapter];
const existingItemsUrl = new URL('../data/items.json', import.meta.url);
const existingItems = JSON.parse(fs.readFileSync(existingItemsUrl, 'utf8'));
let previousParsedItemCount = null;
try {
  const previousReport = JSON.parse(fs.readFileSync(new URL('../data/crawl-report.json', import.meta.url), 'utf8'));
  previousParsedItemCount = previousReport.parsedItemCount ?? null;
} catch {}
const reports = await Promise.all(adapters.map(adapter => adapter()));

const harvestedItems = reports.flatMap(report => report.items);
const parsedItemCount = reports.reduce((s, r) => s + (r.parsedItemCount || 0), 0);
const parserHealthy = reports.every(r => r.parserHealthy !== false);
const parserDropOk = previousParsedItemCount === null || parsedItemCount >= Math.floor(previousParsedItemCount * 0.5);

function mergeFetchedWithExisting(fetchedItems, currentItems) {
  const merged = new Map();
  for (const item of currentItems) {
    if (item?.id) merged.set(item.id, item);
  }
  for (const item of fetchedItems) {
    if (item?.id) merged.set(item.id, item);
  }
  return [...merged.values()].sort((a, b) => {
    const dateDiff = Date.parse(a.deadline) - Date.parse(b.deadline);
    if (dateDiff !== 0) return dateDiff;
    return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN');
  });
}

if (harvestedItems.length >= CTFTIME_MIN_ITEMS && parserHealthy && parserDropOk) {
  const mergedItems = mergeFetchedWithExisting(harvestedItems, existingItems);
  fs.writeFileSync(existingItemsUrl, JSON.stringify(mergedItems, null, 2) + '\n', 'utf8');
  console.log('crawler wrote ' + harvestedItems.length + ' fetched items; preserved/merged total ' + mergedItems.length + ' items');
} else {
  console.log('parser emitted ' + harvestedItems.length + ' items (health gate failed or threshold not met); preserving ' + existingItems.length + ' curated items in data/items.json');
}

const reachableCount = reports.filter(r => r.reachable).length;
console.log('reachability: ' + reachableCount + '/' + reports.length + ' sources reachable');
if (parsedItemCount > 0) console.log('parsedItemCount: ' + parsedItemCount);

fs.writeFileSync(new URL('../data/crawl-report.json', import.meta.url), JSON.stringify({
  topicId: "security-ddl",
  generatedAt: new Date().toISOString(),
  adapterCount: reports.length,
  reachableCount,
  parsedItemCount,
  previousParsedItemCount,
  parserHealthy,
  parserDropOk,
  adapters: reports
}, null, 2) + '\n', 'utf8');
