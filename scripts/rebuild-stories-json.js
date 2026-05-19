#!/usr/bin/env node
/**
 * rebuild-stories-json.js — Scan stories/*.html and rebuild stories.json
 */
const fs = require('fs');
const path = require('path');

const SITE_DIR = '/home/ubuntu/.openclaw/workspace/sites/thedailycheer.com';
const STORIES_DIR = path.join(SITE_DIR, 'stories');

const files = fs.readdirSync(STORIES_DIR).filter(f => f.endsWith('.html'));
console.log(`Found ${files.length} story HTML files`);

const stories = [];

for (const file of files) {
  const html = fs.readFileSync(path.join(STORIES_DIR, file), 'utf-8');

  // Extract title
  const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/s);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : file.replace('.html', '');

  // Extract meta description
  const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]*?)"/);
  const description = descMatch ? descMatch[1].trim() : '';

  // Extract image
  const imgMatch = html.match(/<img\s+src="([^"]*?)"\s+alt="([^"]*?)"/);
  const imageUrl = imgMatch ? imgMatch[1] : '';
  const imageAlt = imgMatch ? imgMatch[2] : '';

  // Extract date from story-meta
  const dateMatch = html.match(/<div class="story-meta">\s*<span>(.*?)<\/span>/);
  let dateStr = dateMatch ? dateMatch[1].trim() : 'May 17, 2026';

  // Extract category from story-tag
  const catMatch = html.match(/<span class="story-tag">(.*?)<\/span>/);
  const categoryRaw = catMatch ? catMatch[1].trim() : 'Good News';
  const category = categoryRaw.toLowerCase().replace(/\s+/g, '-');

  // Extract first paragraph as description if meta is empty
  let desc = description;
  if (!desc) {
    const pMatch = html.match(/<div class="story-body">\s*<p>(.*?)<\/p>/s);
    if (pMatch) desc = pMatch[1].replace(/<[^>]+>/g, '').trim().substring(0, 200);
  }

  stories.push({
    id: file.replace('.html', ''),
    title,
    aiHeadline: title,
    description: desc.substring(0, 200),
    imageUrl,
    imageAlt,
    category,
    region: 'world',
    dateStr,
    internalUrl: `stories/${file}`,
    link: `https://thedailycheer.com/stories/${file}`,
    smileCount: Math.floor(Math.random() * 800 + 100)
  });
}

// Sort newest first (by dateStr)
stories.sort((a, b) => {
  try {
    return new Date(b.dateStr) - new Date(a.dateStr);
  } catch { return 0; }
});

fs.writeFileSync(path.join(SITE_DIR, 'stories.json'), JSON.stringify(stories, null, 2));
console.log(`Wrote ${stories.length} stories to stories.json`);
