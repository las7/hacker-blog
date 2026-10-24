(() => {
  const root = document.documentElement;
  const wide = matchMedia('(min-width: 75rem)');

  // Theme: cycles the opposite of whatever is currently showing; remembered per browser.
  const toggle = document.querySelector('.theme-toggle');
  if (toggle) toggle.addEventListener('click', () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (e) {}
  });

  const post = document.querySelector('.post');
  if (!post) return;

  // Reading progress
  const bar = document.createElement('div');
  bar.className = 'progress';
  bar.setAttribute('aria-hidden', 'true');
  document.body.prepend(bar);
  let ticking = false;
  const update = () => {
    const r = post.getBoundingClientRect();
    const total = r.height - innerHeight;
    const p = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 1;
    bar.style.setProperty('--p', p.toFixed(4));
    ticking = false;
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  update();

  // Contents: expanded in the margin on wide screens, collapsed above the post otherwise.
  const tocDetails = document.querySelector('.toc details');
  const wideToc = matchMedia('(min-width: 82rem)');
  if (tocDetails) { tocDetails.open = wideToc.matches; wideToc.addEventListener('change', (e) => { tocDetails.open = e.matches; }); }

  // Contents scroll-spy
  const links = [...document.querySelectorAll('.toc a')];
  if (links.length) {
    const map = new Map(links.map((a) => [decodeURIComponent(a.hash.slice(1)), a]));
    const heads = [...map.keys()].map((id) => document.getElementById(id)).filter(Boolean);
    const spy = () => {
      let cur = heads[0];
      for (const h of heads) if (h.getBoundingClientRect().top < innerHeight * 0.3) cur = h;
      links.forEach((a) => a.classList.toggle('active', map.get(cur.id) === a));
    };
    addEventListener('scroll', () => requestAnimationFrame(spy), { passive: true });
    spy();
  }

  // Footnote refs: toggle the note inline on narrow screens, highlight it in the margin on wide ones.
  document.querySelectorAll('.footnote-ref a').forEach((a) => {
    const note = document.getElementById(a.getAttribute('aria-describedby'));
    if (!note) return;
    a.setAttribute('aria-expanded', 'false');
    a.addEventListener('click', (e) => {
      if (wide.matches) return;
      e.preventDefault();
      const open = note.classList.toggle('open');
      a.setAttribute('aria-expanded', String(open));
    });
    a.parentElement.addEventListener('mouseenter', () => note.classList.add('hl'));
    a.parentElement.addEventListener('mouseleave', () => note.classList.remove('hl'));
  });

  // Copy buttons on code blocks
  document.querySelectorAll('.code').forEach((block) => {
    const pre = block.querySelector('pre');
    if (!pre || !navigator.clipboard) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'copy';
    b.textContent = 'Copy';
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(pre.innerText); b.textContent = 'Copied'; }
      catch (e) { b.textContent = 'Failed'; }
      setTimeout(() => { b.textContent = 'Copy'; }, 1500);
    });
    block.append(b);
  });
})();
