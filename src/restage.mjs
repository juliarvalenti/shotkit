// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mycelium Contributors

/**
 * A take on the tech-demo stage: record first, tilt after.
 *
 * Tilting each frame as it arrives would put a render in the pump's beat, and a
 * render is slower than a beat, so the take would stutter or fall behind. So
 * the take is spooled to disk as it is recorded, with the pump none the wiser,
 * and once it ends each frame goes through one held stage page and on to the
 * real encoder. That costs a pass after the take (tens of milliseconds a frame)
 * and buys two things a live tilt could not: frames that are all there, and a
 * camera that can move across the whole take, since its length is known.
 *
 * The pump writes the same buffer on every beat while the page is still, so the
 * spool keeps one file per distinct frame and an index of which beat showed
 * which; with the angle held still, a still stretch is also rendered once.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driftAt, fitScale, stageDocument, tiltTransform, STAGE_DEFAULTS } from "./stage.mjs";

/**
 * An encoder-shaped sink that keeps the take on disk. Same surface the pump
 * drives a real encoder through: `write`, `frames`, `saturated`, `failure`,
 * `finish`.
 */
export function startSpool() {
  const dir = mkdtempSync(join(tmpdir(), "shotkit-take-"));
  /** @type {number[]} which distinct frame each beat showed */
  const order = [];
  let distinct = 0;
  let last = null;
  let failed = null;
  return {
    dir,
    order,
    get frames() {
      return order.length;
    },
    saturated: false,
    get failure() {
      return failed;
    },
    write(buf) {
      if (failed) return false;
      try {
        if (buf !== last) {
          writeFileSync(join(dir, `${distinct}.jpg`), buf);
          distinct += 1;
          last = buf;
        }
        order.push(distinct - 1);
      } catch (err) {
        failed = err;
      }
      return true;
    },
    async finish() {
      if (failed) throw failed;
      if (!order.length) throw new Error("no frames were captured");
      return { frames: order.length };
    },
    read(i) {
      return readFileSync(join(dir, `${i}.jpg`));
    },
    remove() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Put every spooled frame on the stage and encode the result.
 *
 * @param {import("./engine.mjs").Engine} eng
 * @param {ReturnType<typeof startSpool>} spool
 * @param {{stage: Record<string, any>, drift: number, theme: "dark"|"light", art?: string,
 *          frameWidth: number, frameHeight: number, quality?: number,
 *          encoder: (size: {width:number, height:number}) => any,
 *          log?: (m: string) => void}} o
 * @returns {Promise<{frames:number, width:number, height:number, rendered:number}>}
 */
export async function restage(eng, spool, o) {
  const log = o.log ?? (() => {});
  const width = o.stage.width ?? STAGE_DEFAULTS.width;
  const height = o.stage.height ?? STAGE_DEFAULTS.height;
  const layout = { ...o.stage, imgWidth: o.frameWidth, imgHeight: o.frameHeight };
  const k = fitScale(layout);

  // A render is one beat's distinct (frame, angle) pair; consecutive beats that
  // share one share the render. With the angle held, a still stretch is one.
  /** @type {{frame:number, transform:string}[]} */
  const renders = [];
  /** @type {number[]} which render each beat shows */
  const beats = [];
  const total = spool.order.length;
  let prevKey = null;
  for (let i = 0; i < total; i++) {
    const frame = spool.order[i];
    const { tilt, zoom } = driftAt(o.stage.tilt, o.drift, total > 1 ? i / (total - 1) : 0);
    const transform = tiltTransform(tilt, k * zoom, o.stage.perspective);
    const key = `${frame}|${transform}`;
    if (key !== prevKey) renders.push({ frame, transform });
    prevKey = key;
    beats.push(renders.length - 1);
  }

  // Several stage pages rendering side by side: a render is mostly waiting on
  // the compositor and the JPEG encoder, which a single page leaves idle.
  const first = await eng.staticPage({ width, height, scale: 1, theme: o.theme });
  const pages = [first];
  for (let i = 1; i < Math.min(RESTAGE_PAGES, renders.length); i++) pages.push(await first.context().newPage());
  const doc = stageDocument({ ...layout, frame: "window", theme: o.theme, art: o.art });
  await Promise.all(pages.map((p) => p.setContent(doc, { waitUntil: "load" })));
  // A clipped page screenshot rather than a locator's: the stage fills the page
  // exactly, and the locator's visibility and stability checks are a cost paid
  // on every frame for nothing.
  const shoot = { type: /** @type {"jpeg"} */ ("jpeg"), quality: o.quality ?? 92, clip: { x: 0, y: 0, width, height } };
  const render = async (p, r) => {
    const src = `data:image/jpeg;base64,${spool.read(r.frame).toString("base64")}`;
    await p.evaluate(([s, tr]) => window.__stage.set(s, tr), [src, r.transform]);
    return p.screenshot(shoot);
  };

  const encoder = o.encoder({ width, height });
  let beat = 0;
  let lastLog = Date.now();
  try {
    for (let start = 0; start < renders.length; start += pages.length) {
      const batch = renders.slice(start, start + pages.length);
      const bufs = await Promise.all(batch.map((r, j) => render(pages[j], r)));
      // Write every beat whose render is now in hand, in order.
      while (beat < total && beats[beat] < start + batch.length) {
        if (!encoder.write(bufs[beats[beat] - start])) await drained(encoder);
        if (encoder.failure) throw encoder.failure;
        beat += 1;
      }
      if (Date.now() - lastLog > 2000) {
        log(`staging ${beat}/${total}`);
        lastLog = Date.now();
      }
    }
    await encoder.finish();
  } catch (err) {
    await encoder.finish(5_000).catch(() => {});
    throw err;
  } finally {
    await Promise.all(pages.slice(1).map((p) => p.close().catch(() => {})));
  }
  return { frames: total, width, height, rendered: renders.length };
}

/** Stage pages rendering at once. Past four, they mostly queue on one GPU process. */
const RESTAGE_PAGES = 4;

/** Wait for an encoder that reported backpressure to catch up. */
async function drained(encoder) {
  for (let i = 0; i < 400 && encoder.saturated && !encoder.failure; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
}
