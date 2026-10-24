// Static site build: content/ + data/ -> dist/
// Usage: node src/build.mjs [--drafts]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import matter from 'gray-matter';
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import anchor from 'markdown-it-anchor';
import { createHighlighter } from 'shiki';
import * as cheerio from 'cheerio';
import { ogImage, OG_WIDTH, OG_HEIGHT } from './og.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'dist');
const DRAFTS = process.argv.includes('--drafts');

const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/site.json'), 'utf8'));
const cveGroups = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/cves.json'), 'utf8'));
const reading = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/reading.json'), 'utf8'));

// ---------- helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const stripTags = (s) => String(s).replace(/<[^>]+>/g, '');
const write = (rel, data) => {
  const f = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const toDate = (d) => (d instanceof Date ? d : new Date(String(d) + 'T12:00:00Z'));
const iso = (d) => toDate(d).toISOString().slice(0, 10);
const fmtShort = (d) => { const x = toDate(d); return `${MONTHS[x.getUTCMonth()]} ${x.getUTCDate()}`; };
const fmtLong = (d) => { const x = toDate(d); return `${MONTHS_LONG[x.getUTCMonth()]} ${x.getUTCDate()}, ${x.getUTCFullYear()}`; };

// ---------- markdown ----------
const highlighter = await createHighlighter({
  themes: ['github-light', 'github-dark'],
  langs: ['bash', 'shell', 'c', 'cpp', 'python', 'javascript', 'typescript', 'json', 'rust', 'go', 'diff', 'text', 'yaml', 'toml', 'html', 'css', 'asm', 'swift', 'objective-c'],
});
const slugify = (s) => stripTags(s).toLowerCase().replace(/&[a-z]+;/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(code, lang) {
    const l = highlighter.getLoadedLanguages().includes(lang) ? lang : 'text';
    const html = highlighter.codeToHtml(code, { lang: l, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false });
    const label = lang ? `<span class="code-lang">${esc(lang)}</span>` : '';
    return `<div class="code">${label}${html}</div>`;
  },
})
  .use(footnote)
  .use(anchor, {
    slugify,
    level: [2, 3],
    permalink: anchor.permalink.linkInsideHeader({ symbol: '#', placement: 'before', class: 'h-anchor', ariaHidden: true }),
  });

// Fenced blocks: markdown-it wraps highlight output in <pre><code> unless it starts with <pre; we return a div, so bypass.
md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
  const t = tokens[idx];
  const lang = t.info.trim().split(/\s+/)[0];
  return opts.highlight(t.content, lang) + '\n';
};

function renderPost(src) {
  const html = md.render(src);
  const $ = cheerio.load(html, null, false);

  // Table of contents from h2/h3
  const toc = [];
  $('h2, h3').each((_, el) => {
    const $el = $(el);
    const text = $el.clone().find('.h-anchor').remove().end().text().trim();
    toc.push({ id: $el.attr('id'), text, level: el.tagName === 'h2' ? 2 : 3 });
  });

  // Footnotes -> margin sidenotes placed after the block that references them.
  const notes = {};
  $('section.footnotes li.footnote-item').each((_, li) => {
    const $li = $(li);
    const id = $li.attr('id');
    $li.find('a.footnote-backref').remove();
    const inner = $li.html().trim().replace(/^<p>/, '').replace(/<\/p>$/, '');
    notes[id] = inner;
  });
  $('sup.footnote-ref').each((_, sup) => {
    const $sup = $(sup);
    const $a = $sup.find('a');
    const target = ($a.attr('href') || '').slice(1);
    const n = $a.text().replace(/[\[\]]/g, '');
    $a.text(n);
    $a.attr('aria-describedby', `sn-${target}`);
    // Tufte-style: the note sits inline right after its reference, so it floats level with it.
    if (notes[target] !== undefined) {
      $sup.after(`<span class="sidenote" id="sn-${target}" role="note"><span class="sn-num">${n}</span>${notes[target]}</span>`);
    }
  });
  $('section.footnotes').addClass('endnotes').prepend('<h2 class="endnotes-title">Notes</h2>');
  $('hr.footnotes-sep').remove();

  // Tables scroll on small screens
  $('table').each((_, t) => { $(t).wrap('<div class="table-wrap"></div>'); });
  // Images
  $('img').attr('loading', 'lazy').attr('decoding', 'async');
  // Standalone image paragraphs with title -> figure
  $('p > img:only-child').each((_, img) => {
    const $img = $(img);
    const cap = $img.attr('title');
    if (cap) $img.parent().replaceWith(`<figure>${$.html($img.removeAttr('title'))}<figcaption>${esc(cap)}</figcaption></figure>`);
  });
  // External links
  $('a[href^="http"]').each((_, a) => {
    const $a = $(a);
    if (!$a.attr('href').startsWith(site.url)) $a.addClass('ext');
  });

  const text = $.root().clone().find('.sidenote, .endnotes, .code').remove().end().text();
  const words = (text.match(/\S+/g) || []).length;
  return { html: $.html(), toc, words, hasNotes: Object.keys(notes).length > 0 };
}

// ---------- assets ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const FONTS = [
  ['@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2', 'sans.woff2'],
  ['@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-italic.woff2', 'sans-italic.woff2'],
  ['@fontsource/fragment-mono/files/fragment-mono-latin-400-normal.woff2', 'mono.woff2'],
];
for (const [from, to] of FONTS) {
  const buf = fs.readFileSync(path.join(ROOT, 'node_modules', from));
  write(`fonts/${to}`, buf);
}
const css = fs.readFileSync(path.join(ROOT, 'src/style.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'src/site.js'), 'utf8');
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);
const cssPath = `/assets/style.${hash(css)}.css`;
const jsPath = `/assets/site.${hash(js)}.js`;
write(cssPath, css);
write(jsPath, js);
for (const f of fs.readdirSync(path.join(ROOT, 'static')).filter((f) => !f.startsWith('.'))) {
  fs.cpSync(path.join(ROOT, 'static', f), path.join(OUT, f), { recursive: true });
}

// ---------- layout ----------
const NAV = [
  ['/', 'Writing'],
  ['/cves/', 'CVEs'],
  ['/reading/', 'Reading'],
  ['/about/', 'About'],
];
const ICON_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='#000'/><text x='32' y='46' text-anchor='middle' font-family='Georgia,serif' font-size='40' fill='#fff'>S</text></svg>`;
write('favicon.svg', ICON_SVG);

function layout({ title, description, url, type = 'website', current, body, bodyClass = '', head = '', image = '/og/site.png' }) {
  const fullTitle = title ? `${title} — ${site.title}` : site.title;
  const abs = site.url + url;
  const nav = NAV.map(([href, label]) => `<a href="${href}"${current === href ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description || site.description)}">
<meta name="author" content="${esc(site.author)}">
<link rel="canonical" href="${abs}">
<meta property="og:title" content="${esc(title || site.title)}">
<meta property="og:site_name" content="${esc(site.title)}">
<meta property="og:description" content="${esc(description || site.description)}">
<meta property="og:type" content="${type}">
<meta property="og:url" content="${abs}">
<meta property="og:image" content="${site.url}${image}">
<meta property="og:image:width" content="${OG_WIDTH}">
<meta property="og:image:height" content="${OG_HEIGHT}">
<meta property="og:image:alt" content="${esc(title || site.title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${site.url}${image}">
${site.twitter ? '<meta name="twitter:creator" content="@' + site.twitter + '">' : ''}
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${esc(site.title)}" href="/feed.xml">
<link rel="preload" href="/fonts/sans.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${cssPath}">
<script>try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
${head}<script src="${jsPath}" defer></script>
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="bar">
    <a class="brand" href="/">${esc(site.title)}</a>
    <nav aria-label="Site">${nav}</nav>
    <button class="theme-toggle" type="button" aria-label="Toggle color theme" title="Toggle color theme"><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 2.75a7.25 7.25 0 0 1 0 14.5z" fill="currentColor"/></svg></button>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="bar">
    <span>© ${new Date().getUTCFullYear()} ${esc(site.author)}</span>
    <span class="foot-links"><a href="/feed.xml">RSS</a><a href="/about/">About</a></span>
  </div>
</footer>
</body>
</html>
`;
}

// ---------- posts ----------
const postDir = path.join(ROOT, 'content/posts');
let posts = fs.readdirSync(postDir).filter((f) => f.endsWith('.md')).map((f) => {
  const raw = fs.readFileSync(path.join(postDir, f), 'utf8');
  const { data, content } = matter(raw);
  const slug = data.slug || f.replace(/\.md$/, '');
  const r = renderPost(content);
  // Link previews and search fall back to the opening sentence when a post has no summary.
  const firstPara = stripTags((r.html.match(/<p>([\s\S]*?)<\/p>/) || [, ''])[1]).replace(/\s+/g, ' ').trim();
  const excerpt = (firstPara.match(/^.*?[.!?](\s|$)/) || [firstPara])[0].trim();
  return { ...data, slug, url: `/posts/${slug}/`, ...r, excerpt, minutes: Math.max(1, Math.round(r.words / 230)) };
});
posts = posts.filter((p) => DRAFTS || !p.draft).sort((a, b) => toDate(b.date) - toDate(a.date));

posts.forEach((p, i) => {
  const newer = posts[i - 1];
  const older = posts[i + 1];
  const showToc = p.toc.filter((t) => t.level === 2).length >= 3;
  const tocList = p.toc.map((t) => `<li class="l${t.level}"><a href="#${t.id}">${esc(t.text)}</a></li>`).join('');
  const toc = showToc ? `
<nav class="toc" aria-label="Contents">
  <details>
    <summary>Contents<svg class="tw" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6h10" stroke="currentColor" stroke-width="1.25"/><path class="v" d="M6 1v10" stroke="currentColor" stroke-width="1.25"/></svg></summary>
    <ol>${tocList}</ol>
  </details>
</nav>` : '';
  const pager = (newer || older) ? `
<nav class="pager" aria-label="More posts">
  ${older ? `<a class="older" href="${older.url}"><span class="k">Previous</span><span class="t">${md.renderInline(older.title)}</span></a>` : '<span></span>'}
  ${newer ? `<a class="newer" href="${newer.url}"><span class="k">Next</span><span class="t">${md.renderInline(newer.title)}</span></a>` : '<span></span>'}
</nav>` : '';
  const updated = p.updated ? ` · <span>Updated <time datetime="${iso(p.updated)}">${fmtLong(p.updated)}</time></span>` : '';
  const ld = { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, datePublished: iso(p.date), dateModified: iso(p.updated || p.date), author: { '@type': 'Person', name: site.author, url: site.url }, description: p.summary || p.excerpt, url: site.url + p.url, wordCount: p.words };
  const body = `
<div class="post-layout${showToc ? ' has-toc' : ''}">
${toc}
<article class="post prose${p.hasNotes ? ' has-notes' : ''}">
  <header class="post-head">
    <p class="post-meta">${p.draft ? '<span class="draft">Draft</span> · ' : ''}<time datetime="${iso(p.date)}">${fmtLong(p.date)}</time> · <span>${p.minutes} min read</span>${updated}</p>
    <h1>${md.renderInline(p.title)}</h1>
    ${p.summary ? `<p class="dek">${md.renderInline(p.summary)}</p>` : ''}
  </header>
  <div class="post-body">
${p.html}
  </div>
  <footer class="post-foot">
    ${site.postFooter ? `<p class="post-contact">${md.renderInline(site.postFooter)}</p>` : ''}
    ${pager}
  </footer>
</article>
</div>`;
  write(`posts/${p.slug}/index.html`, layout({
    title: stripTags(md.renderInline(p.title)), description: p.summary || p.excerpt, url: p.url, type: 'article', current: '/', bodyClass: 'is-post', image: `/og/posts/${p.slug}.png`,
    head: `<meta property="article:published_time" content="${iso(p.date)}">\n<script type="application/ld+json">${JSON.stringify(ld)}</script>\n`,
    body,
  }));
});

// ---------- CVE data ----------
const allCves = cveGroups.flatMap((g) => g.items.map((c) => ({ ...c, vendor: g.vendor })));
const SEV = ['Critical', 'High', 'Medium', 'Low'];
const sevCount = Object.fromEntries([...SEV, 'Unrated'].map((s) => [s, allCves.filter((c) => (c.severity || 'Unrated') === s).length]));
const sevClass = (s) => `sev-${(s || 'unrated').toLowerCase()}`;

// ---------- home ----------
{
  const byYear = {};
  for (const p of posts) (byYear[toDate(p.date).getUTCFullYear()] ||= []).push(p);
  const writing = Object.keys(byYear).sort((a, b) => b - a).map((y) => `
<section class="year">
  <h3 class="year-label">${y}</h3>
  <ol class="index">
    ${byYear[y].map((p) => `<li>
      <time datetime="${iso(p.date)}">${fmtShort(p.date)}</time>
      <div class="entry"><a href="${p.url}">${md.renderInline(p.title)}</a>${p.draft ? ' <span class="draft">Draft</span>' : ''}${p.summary ? `<p>${md.renderInline(p.summary)}</p>` : ''}</div>
      <span class="len">${p.minutes} min</span>
    </li>`).join('')}
  </ol>
</section>`).join('');

  const body = `
<div class="home">
  <section class="intro"><p>${md.renderInline(site.intro)}</p></section>
  <section class="block" aria-labelledby="h-writing">
    <h2 id="h-writing" class="label">Writing <span class="count">${posts.length}</span></h2>
    ${writing || '<p class="empty">Nothing published yet.</p>'}
  </section>
</div>`;
  write('index.html', layout({ url: '/', current: '/', body, bodyClass: 'is-home' }));
}

// ---------- CVEs page ----------
{
  const nCve = allCves.filter((c) => c.id.startsWith('CVE-')).length;
  const nGhsa = allCves.length - nCve;
  const groups = cveGroups.map((g) => `
<section class="vendor" aria-labelledby="v-${slugify(g.vendor)}">
  <h2 id="v-${slugify(g.vendor)}">${esc(g.vendor)} <span class="count">${g.items.length}</span></h2>
  <ol class="cve-list">
  ${g.items.map((c) => `
    <li class="cve" id="${c.id}">
      <div class="cve-head">
        <a class="id" href="#${c.id}">${c.id}</a>
        <span class="prod">${esc(c.product)}</span>
      </div>
      <p class="impact">${md.renderInline(c.impact)}</p>
      <p class="facts">
        ${[c.severity ? `<span class="${sevClass(c.severity)} sev-text">${esc(c.severity)}</span>` : '', c.class ? esc(c.class) : '', c.cwe ? `<a href="https://cwe.mitre.org/data/definitions/${c.cwe.split('-')[1]}.html">${c.cwe}</a>` : '', c.detail ? esc(c.detail) : '', c.via ? `via ${esc(c.via.replace(/^Reported /, '').replace(/^directly to /, ''))}` : ''].filter(Boolean).join('<span class="dot">·</span>')}
      </p>
      <p class="refs"><a href="${c.vendorUrl}">${c.id.startsWith('GHSA-') ? 'GitHub advisory' : 'Advisory'}</a>${c.id.startsWith('CVE-') ? `<a href="https://nvd.nist.gov/vuln/detail/${c.id}">NVD</a>` : ''}</p>
    </li>`).join('')}
  </ol>
</section>`).join('');
  const acks = site.acknowledgements.map((a) => `
    <li class="cve">
      <div class="cve-head"><span class="id plain">${esc(a.vendor)}</span><span class="prod">${esc(a.product)}</span></div>
      <p class="impact">${md.renderInline(a.impact)}</p>
      <p class="facts">${esc(a.detail)}</p>
      <p class="refs"><a href="${a.url}">Release notes</a></p>
    </li>`).join('');
  const body = `
<div class="page cves-page">
  <header class="page-head">
    <h1>CVEs</h1>
    <p class="dek">Publicly disclosed vulnerabilities credited to me, grouped by vendor. Severity is the vendor’s own rating.</p>
  </header>
  <p class="cve-total"><b>${nCve}</b> CVEs${nGhsa ? ` and <b>${nGhsa}</b> GitHub ${nGhsa === 1 ? 'advisory' : 'advisories'}` : ''} across ${cveGroups.length} vendors</p>
  ${groups}
  <section class="vendor">
    <h2 id="other">Other acknowledgements <span class="count">${site.acknowledgements.length}</span></h2>
    <ol class="cve-list">${acks}</ol>
  </section>
</div>`;
  write('cves/index.html', layout({ title: 'CVEs', description: `Publicly disclosed vulnerabilities credited to ${site.author}.`, url: '/cves/', current: '/cves/', body, bodyClass: 'is-cves', image: '/og/cves.png' }));
}

// ---------- reading ----------
{
  const kindLabel = { book: 'Book', paper: 'Paper', post: 'Post', talk: 'Talk' };
  const fmtMonth = (ym) => { const [y, m] = String(ym).split('-').map(Number); return m ? `${MONTHS[m - 1]} ${y}` : String(y); };
  const entry = (r, showDate) => `<li>
      <span class="when">${showDate && r.finished ? fmtMonth(r.finished) : esc(kindLabel[r.kind] || '')}</span>
      <div class="entry">${r.url ? `<a href="${esc(r.url)}">${esc(r.title)}</a>` : `<span class="t">${esc(r.title)}</span>`}<span class="by">${esc(r.author || '')}${showDate && r.kind ? ` · ${esc(kindLabel[r.kind] || r.kind)}` : ''}</span>${r.note ? `<p>${md.renderInline(r.note)}</p>` : ''}</div>
    </li>`;
  const now = reading.reading || [];
  const done = [...(reading.read || [])].sort((a, b) => String(b.finished || '').localeCompare(String(a.finished || '')));
  const byYear = {};
  for (const r of done) (byYear[String(r.finished || '').slice(0, 4) || 'Earlier'] ||= []).push(r);
  const doneHtml = Object.keys(byYear).sort().reverse().map((y) => `
    <section class="year"><h3 class="year-label">${esc(y)}</h3><ol class="shelf">${byYear[y].map((r) => entry(r, true)).join('')}</ol></section>`).join('');
  const body = `
<div class="page reading-page">
  <header class="page-head"><h1>Reading</h1><p class="dek">Books, papers and posts I’m reading or have read.</p></header>
  <section class="block" aria-labelledby="h-now">
    <h2 id="h-now" class="label">Now <span class="count">${now.length}</span></h2>
    ${now.length ? `<ol class="shelf">${now.map((r) => entry(r, false)).join('')}</ol>` : '<p class="empty">Nothing on the go right now.</p>'}
  </section>
  <section class="block" aria-labelledby="h-read">
    <h2 id="h-read" class="label">Read <span class="count">${done.length}</span></h2>
    ${doneHtml || '<p class="empty">Nothing logged yet.</p>'}
  </section>
</div>`;
  write('reading/index.html', layout({ title: 'Reading', description: `Books, papers and posts ${site.author} is reading or has read.`, url: '/reading/', current: '/reading/', body, bodyClass: 'is-reading' }));
}

// ---------- about ----------
{
  const exp = site.experience.map((e) => `
    <li>
      <span class="when">${esc(e.when)}</span>
      <div><span class="org">${e.url ? `<a href="${e.url}">${esc(e.org)}</a>` : esc(e.org)}${e.note ? ` <span class="note">${esc(e.note)}</span>` : ''}</span>${e.role ? `<span class="role">${esc(e.role)}</span>` : ''}${e.desc ? `<p>${esc(e.desc)}</p>` : ''}</div>
    </li>`).join('');
  const body = `
<div class="page about-page prose">
  <header class="page-head"><h1>About</h1>${site.aboutDek ? `<p class="dek">${esc(site.aboutDek)}</p>` : ''}</header>
  ${site.about.map((p) => `<p>${md.renderInline(p)}</p>`).join('\n  ')}
  <h2 id="experience">Experience</h2>
  <ol class="timeline">${exp}</ol>
</div>`;
  write('about/index.html', layout({ title: 'About', description: (site.aboutTitle ? `${site.author} — ${site.aboutTitle}` : `About ${site.author}.`), url: '/about/', current: '/about/', body, bodyClass: 'is-about' }));
}

// ---------- link-preview images ----------
{
  const nCve = allCves.filter((c) => c.id.startsWith('CVE-')).length;
  const nGhsa = allCves.length - nCve;
  const ogSite = (site.url || '').replace(/^https?:\/\//, '');
  write('og/site.png', await ogImage({ title: site.ogTitle || site.description, site: ogSite, name: site.author }));
  write('og/cves.png', await ogImage({ title: 'CVEs', meta: `${nCve} CVEs and ${nGhsa} GitHub advisories`, site: ogSite, name: site.author }));
  for (const p of posts) {
    write(`og/posts/${p.slug}.png`, await ogImage({ title: stripTags(md.renderInline(p.title)), meta: `${fmtLong(p.date)} · ${p.minutes} min read`, site: ogSite, name: site.author }));
  }
}

// ---------- 404 ----------
write('404.html', layout({ title: 'Not found', url: '/404.html', body: `<div class="page prose"><header class="page-head"><h1>Not found</h1><p class="dek">There’s nothing at this address. The <a href="/">front page</a> lists everything.</p></header></div>` }));

// ---------- feed, sitemap, robots, redirects ----------
const absolutize = (html) => html.replace(/(href|src)="\/(?!\/)/g, `$1="${site.url}/`);
write('feed.xml', `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
<title>${esc(site.title)}</title>
<link>${site.url}/</link>
<atom:link href="${site.url}/feed.xml" rel="self" type="application/rss+xml"/>
<description>${esc(site.description)}</description>
<language>en</language>
${posts.filter((p) => !p.draft).map((p) => `<item>
<title>${esc(stripTags(md.renderInline(p.title)))}</title>
<link>${site.url}${p.url}</link>
<guid>${site.url}${p.url}</guid>
<pubDate>${toDate(p.date).toUTCString()}</pubDate>
<description>${esc(p.summary || p.excerpt)}</description>
<content:encoded><![CDATA[${absolutize(p.html.replace(/<a class="h-anchor"[^>]*>#<\/a> ?/g, '').replace(/ tabindex="-1"/g, ''))}]]></content:encoded>
</item>`).join('\n')}
</channel>
</rss>
`);
const urls = ['/', '/cves/', '/reading/', '/about/', ...posts.filter((p) => !p.draft).map((p) => p.url)];
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${site.url}${u}</loc></url>`).join('\n')}
</urlset>
`);
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${site.url}/sitemap.xml\n`);
write('_redirects', [
  '/about.html /about/ 301',
  '/cves.html /cves/ 301',
  '/research.html /cves/ 301',
  '/index.html / 301',
  '/posts/2026-09-04-hello-world.html / 301',
  '/posts/hello-world/ / 301',
  '/posts/ / 301',
].join('\n') + '\n');
write('_headers', `/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n`);

console.log(`built ${posts.length} post(s)${DRAFTS ? ' (including drafts)' : ''} -> dist/`);
