import fs from 'node:fs';

async function ctfTimeAdapter() {
  return {
    source: "CTFtime",
    url: "https://ctftime.org/event/list/upcoming",
    items: [],
    note: 'TODO: implement parser for CTFtime; keep data/items.json as curated fallback until parser is verified.'
  };
}

async function securityTrainingAdapter() {
  return {
    source: "pwn.college / security training boards",
    url: "https://pwn.college",
    items: [],
    note: 'TODO: implement parser for pwn.college / security training boards; keep data/items.json as curated fallback until parser is verified.'
  };
}

async function bugcrowdAdapter() {
  return {
    source: "Bugcrowd programs",
    url: "https://bugcrowd.com/programs",
    items: [],
    note: 'TODO: implement parser for Bugcrowd programs; keep data/items.json as curated fallback until parser is verified.'
  };
}

async function hackerOneAdapter() {
  return {
    source: "HackerOne programs",
    url: "https://hackerone.com/directory/programs",
    items: [],
    note: 'TODO: implement parser for HackerOne programs; keep data/items.json as curated fallback until parser is verified.'
  };
}

const adapters = [ctfTimeAdapter, securityTrainingAdapter, bugcrowdAdapter, hackerOneAdapter];
const existingItemsUrl = new URL('../data/items.json', import.meta.url);
const existingItems = JSON.parse(fs.readFileSync(existingItemsUrl, 'utf8'));
const reports = [];

for (const adapter of adapters) {
  reports.push(await adapter());
}

const harvestedItems = reports.flatMap(report => report.items);
if (harvestedItems.length > 0) {
  fs.writeFileSync(existingItemsUrl, JSON.stringify(harvestedItems, null, 2) + '\n', 'utf8');
  console.log(`crawler wrote ${harvestedItems.length} fetched items`);
} else {
  console.log(`crawler adapters ran; no verified fetched items yet, preserving ${existingItems.length} curated items`);
}

fs.writeFileSync(new URL('../data/crawl-report.json', import.meta.url), JSON.stringify({
  generatedAt: new Date().toISOString(),
  topicId: "security-ddl",
  adapters: reports
}, null, 2) + '\n', 'utf8');
