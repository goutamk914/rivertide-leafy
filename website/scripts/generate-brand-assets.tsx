/**
 * Generates the site's icons and Open Graph image from Leafy's pixel data.
 *   npm run assets -w website
 * Writes app/icon.svg (favicon), app/apple-icon.png and public/og.png (Open Graph). The outputs are
 * committed; re-run only when Leafy's art or the tagline changes.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ImageResponse } from 'next/og';
import { frameFromPose, frameToSvg, getPose } from '@rivertide/leafy';

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const FONT_DIR = fileURLToPath(new URL('../../node_modules/@fontsource/atkinson-hyperlegible-next/files/', import.meta.url));

const INK = '#f2f4f1';
const MUTED = 'rgba(242, 244, 241, 0.6)';
const BG = '#0b0c0b';
const ISLAND = '#000000';

const leafySvg = (scale: number) => frameToSvg(frameFromPose(getPose('happy')), { scale });
const dataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

async function writeImage(path: string, response: ImageResponse) {
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
  console.info(`wrote ${path}`);
}

async function main() {
  await writeFile(`${APP_DIR}icon.svg`, frameToSvg(frameFromPose(getPose('happy')), { title: 'Rivertide' }));
  console.info('wrote app/icon.svg');

  const regular = await readFile(`${FONT_DIR}atkinson-hyperlegible-next-latin-400-normal.woff`);
  const bold = await readFile(`${FONT_DIR}atkinson-hyperlegible-next-latin-700-normal.woff`);
  const fonts = [
    { name: 'Atkinson', data: regular, weight: 400 as const, style: 'normal' as const },
    { name: 'Atkinson', data: bold, weight: 700 as const, style: 'normal' as const },
  ];

  await writeImage(
    `${APP_DIR}apple-icon.png`,
    new ImageResponse(
      (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: BG }}>
          <img src={dataUri(leafySvg(5))} width={120} height={140} alt="" />
        </div>
      ),
      { width: 180, height: 180 },
    ),
  );

  await writeImage(
    `${PUBLIC_DIR}og.png`,
    new ImageResponse(
      (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '72px 80px', background: BG, fontFamily: 'Atkinson' }}>
          <div style={{ display: 'flex', alignItems: 'center', alignSelf: 'flex-start', gap: 14, padding: '10px 22px 10px 14px', borderRadius: 999, background: ISLAND }}>
            <img src={dataUri(leafySvg(2))} width={48} height={56} alt="" />
            <span style={{ color: INK, fontSize: 30, fontWeight: 700 }}>Rivertide</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column', fontSize: 76, lineHeight: 1.08, letterSpacing: -2 }}>
              <span style={{ color: INK }}>You speak naturally.</span>
              <span style={{ color: MUTED }}>Rivertide writes clearly.</span>
              <span style={{ color: MUTED, fontSize: 28, marginTop: 28, letterSpacing: 0 }}>Free for Mac, from Code the Cure</span>
            </div>
            <img src={dataUri(leafySvg(8))} width={192} height={224} alt="" />
          </div>
        </div>
      ),
      { width: 1200, height: 630, fonts },
    ),
  );
}

main().catch((error: unknown) => {
  console.error('Could not generate brand assets:', error);
  process.exitCode = 1;
});
