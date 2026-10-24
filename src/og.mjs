// Link-preview images (1200×630 PNG), rendered at build time in the site's own type and colours.
import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const ROOT = path.resolve(import.meta.dirname, '..');
const font = (w) => fs.readFileSync(path.join(ROOT, `node_modules/@fontsource/schibsted-grotesk/files/schibsted-grotesk-latin-${w}-normal.woff`));
const FONTS = [
  { name: 'Schibsted Grotesk', data: font(400), weight: 400, style: 'normal' },
  { name: 'Schibsted Grotesk', data: font(600), weight: 600, style: 'normal' },
];

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const h = (type, style, children) => ({ type, props: { style, children } });

// Long titles step down so they never run past three lines.
const titleSize = (t) => (t.length > 70 ? 60 : t.length > 40 ? 72 : 88);

export async function ogImage({ title, meta = '', site = '', name = '' }) {
  const tree = h('div', {
    width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    background: '#ffffff', color: '#000000', padding: '72px 80px', fontFamily: 'Schibsted Grotesk',
  }, [
    h('div', { display: 'flex', fontSize: 30, fontWeight: 600, letterSpacing: '-0.01em' }, name),
    h('div', { display: 'flex', fontSize: titleSize(title), fontWeight: 600, lineHeight: 1.06, letterSpacing: '-0.035em', maxWidth: 1000 }, title),
    h('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: '2px solid #000000', paddingTop: 24, fontSize: 26, color: '#555555' }, [
      h('div', { display: 'flex' }, meta),
      h('div', { display: 'flex', color: '#000000' }, site),
    ]),
  ]);
  const svg = await satori(tree, { width: OG_WIDTH, height: OG_HEIGHT, fonts: FONTS });
  return new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH } }).render().asPng();
}
