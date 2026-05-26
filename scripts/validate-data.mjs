import fs from 'node:fs';

const items = JSON.parse(fs.readFileSync(new URL('../data/items.json', import.meta.url), 'utf8'));
const sources = JSON.parse(fs.readFileSync(new URL('../data/sources.json', import.meta.url), 'utf8'));
const errors = [];

if (!Array.isArray(items) || items.length === 0) errors.push('items.json must contain at least one item');
if (!sources || !Array.isArray(sources.sourceFamilies)) errors.push('sources.json missing sourceFamilies');

for (const item of items) {
  for (const key of ['id', 'title', 'deadline', 'url', 'source']) {
    if (!item[key]) errors.push(`${item.id || '<missing-id>'}: missing ${key}`);
  }
  if (Number.isNaN(Date.parse(item.deadline))) errors.push(`${item.id}: invalid deadline ${item.deadline}`);
  if (item.url && !/^https?:\/\//.test(item.url)) errors.push(`${item.id}: invalid url ${item.url}`);
  if (item.sourceUrl && !/^https?:\/\//.test(item.sourceUrl)) errors.push(`${item.id}: invalid sourceUrl ${item.sourceUrl}`);
  if (String(item.id || '').startsWith('ctftime-')) {
    if (!/^https:\/\/ctftime\.org\/event\/\d+/i.test(item.sourceUrl || item.url || '')) {
      errors.push(`${item.id}: CTFtime-derived items must keep the CTFtime event page as sourceUrl`);
    }
    if (item.verificationLevel === 'official_via_ctftime') {
      if (!item.canonicalUrl || item.canonicalUrl !== item.url) {
        errors.push(`${item.id}: official_via_ctftime items must set canonicalUrl equal to url`);
      }
      if (/^https:\/\/ctftime\.org\/event\/\d+/i.test(item.url || '')) {
        errors.push(`${item.id}: official_via_ctftime items must point url at the extracted official URL`);
      }
    }
  }
  const text = JSON.stringify(item);
  if (/\?\?\?\?|�/.test(text)) errors.push(`${item.id}: contains mojibake placeholder`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`validated ${items.length} DDL items and ${sources.sourceFamilies.length} source families`);
