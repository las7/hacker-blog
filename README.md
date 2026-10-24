# Hacker Blog

A minimal personal-site template for security researchers: Markdown in, static HTML out, deployed to Cloudflare Workers in one command. Ships with a CVE/disclosure ledger and a reading list alongside the writing and about pages. Live example: [ssakur.ai](https://ssakur.ai).

- No framework, no client-side bundle — one build script (`src/build.mjs`, ~450 lines) you can read in an afternoon
- Shiki syntax highlighting with automatic light/dark themes
- Build-time OG images (1200×630) rendered in the site's own type
- Footnotes become margin notes on wide screens
- Four pages driven by JSON: writing index, a CVE/disclosure ledger, a reading list, an about page with a timeline
- MIT licensed — yours to modify

## Setup

```
git clone https://github.com/las7/hacker-blog.git my-site
cd my-site
npm install
npm run dev        # build with drafts + local server at http://localhost:8787
```

Edit `data/site.json` first — `title`, `author`, `url`, `intro`, `about`, and `experience` drive everything except posts.

## Writing

- `content/posts/*.md` — front matter: `title`, `date`, `summary`, optional `updated`, `slug`, `draft: true`
- `drafts/` — parking lot; the build never reads it. Move a file to `content/posts/` when ready.
- Footnotes (`[^1]`) render as margin notes on wide screens. Posts with ≥3 `##` sections get a contents list.

## Data pages

- `data/cves.json` — disclosure ledger. Array of `{ vendor, items: [...] }`; each item wants `id`, `product`, `impact`, `vendorUrl`, and optionally `severity`, `class`, `detail`, `date`.
- `data/reading.json` — `reading` (on the go now) and `read` (finished, newest first). Fields: `title`, `author`, optional `url`, `kind` (book | paper | post | talk), `finished` (YYYY-MM, read only), optional one-line `note`.
- If you don't want one of these pages, delete the data and remove its entry from `NAV` in `src/build.mjs`.

## Deploy

```
npm run deploy
```

Requires a Cloudflare account. Point the routes in `wrangler.jsonc` at your domain (or delete them to get a `*.workers.dev` URL by default) and run `npx wrangler deploy`. First time: `npx wrangler login`.

## License

MIT — see [LICENSE](LICENSE). Your content is yours; the template code is free for anything.
