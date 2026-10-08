---
name: shotkit
description: Take a screenshot of a running web app or any URL, render CLI output or a source file as an image card, or record a short video of a UI flow with a visible cursor. Use when you need to SEE a UI (verify a frontend change, check a layout at phone/tablet/desktop widths, look at each step of a flow) or produce an image of terminal output or code for a PR or doc. Triggers on "screenshot", "what does it look like", "check the layout", "responsive", "capture the terminal", "record a video", "demo clip".
---

# shotkit

`shot` (repo: github.com/juliarvalenti/shotkit, checkout at
`~/Documents/GitHub/shotkit`) holds a browser open in a background daemon, so
the first shot costs ~2s and later ones ~150ms. It prints the absolute output
path on stdout and nothing else; read that file back to see the result.

If `shot` is not on PATH, use `node ~/Documents/GitHub/shotkit/bin/shot.mjs`.
If the checkout is missing: `git clone https://github.com/juliarvalenti/shotkit
~/Documents/GitHub/shotkit && cd ~/Documents/GitHub/shotkit && npm install &&
npm link`.

If the current repo has its own `screenshot` skill (mycelium does), use that
one instead.

## Where shots go

shotkit works on the git top-level of the current directory. Captures land in
`<project>/.shotkit/`. Make sure `.shotkit/` is in that project's `.gitignore`
before shooting, and never commit anything from it. `shot doctor` checks the
machine (browser, pty, ffmpeg, webfonts, a running app) if a shot fails.

To shoot another checkout (a `git worktree` of main, to verify a merged PR),
pass `--project <dir>`: it gets its own daemon and `--mock` server. The timing
line ends with the folder being served; if stderr says the app runs from a
different folder than the project, you are shooting the wrong code.

## Common shots

```bash
shot app /                                  # app on :3000-3002, found automatically
shot app /settings --base-url http://localhost:5173
shot url https://example.com --full-page
shot app / --responsive --sheet             # phone/tablet/laptop/wide + one contact sheet
shot app / --viewport 1280x800@2

shot term --cols 90 -- git log --oneline -10       # flags BEFORE the command
shot code src/server.ts --range 40:80
shot text build.log                                 # an ANSI capture you already have
```

Add `--offline` if an app shot takes more than a few seconds (the page is
waiting on an unreachable font CDN).

## Drive a flow

One capture with ordered steps:

```bash
shot app /settings --do click:Profile --do wait:.avatar
```

Use `--do click:X` rather than `--click X` when order matters: `--click` is
shorthand that always runs after every `--do` step.

Or hold a page open and look between steps:

```bash
shot open /settings --session s
shot do click:Profile --session s
shot shoot --session s --name profile
shot close --session s
```

A bare word or phrase is matched by accessible name, then visible text
(`click:Save changes` is a button). For a selector use `#id`, `.class`,
`role=button[name="Save"]`, `text=Save`, or `css=nav button`. `shot help shoot`
lists every verb.

`wait:<ms>` (a bare number) or `sleep:<ms>` pauses for a transition. A failure
is one line, last on stderr — `[shot] error: step 2, click:Save: …` — so
`| tail -1` keeps it; `--verbose` adds the stack.

**Run `shot flows` first.** A project can commit flows (`shotkit/flows/*.json`):
named steps, storage and a route for getting its UI into a state, like past a
first-run dialog or into a panel. Use them (`shot app --flow <name>`, also on
`video` and `open`, with your own `--do` steps after) instead of clicking
through yourself, and when you work out a flow the project will need again, add
it there. A config `setup` flow runs before every app capture (`--no-setup`
skips it).

For a page behind a sign-in dialog, seed what the app keeps in localStorage:
`--storage key=value` (repeatable; `app.storage` in `shotkit.config.json` sets
it for every shot), or `--storage-state <file>` for a saved Playwright login.
Prefer that to clicking a dialog away, which can leave a menu open over the
shot.

## Video

```bash
shot video /settings --do click:Profile --do wait:.avatar --auto-zoom
```

Same `--do` verbs, plus `zoom:<sel>`, `zoomout`, `hold:<ms>`, `caption:<text>`
and `speed:<n>`. Output is mp4 with a full ffmpeg on PATH, else webm. You can't
watch it: give the path to the user, or pull a frame out with ffmpeg to look
at. Keep takes short.

### Sound

```bash
shot video / --do click:Save --sound                      # clicks and keys, heard
shot video / --demo --do click:Save --sound --bed music.mp3
shot sound .shotkit/take.mp4 --bed music.mp3 --bed-db -9  # (re)mix an existing take
```

Every take writes `<video>.sounds.json` (each click and key at the second it
shows). `--sound` mixes a tock per click and ticks per keystroke over an
optional `--bed` file and muxes it in. `--bed-db` moves the bed alone (default
-6); `--target` sets the overall loudness (default -19 LUFS). Needs a full
ffmpeg (AAC/Opus); not for gif. You can't hear it either: report the LUFS and
true peak the command prints, and hand the file to the user. In code:
`import { addSound } from "shotkit/audio"`, with `bed` as a file or a rendered
`{ L, R }` pair.

## Framing for a PR or doc

```bash
shot app / --chrome --backdrop dusk          # browser window frame
shot app / --chrome --theme light --backdrop paper
```

Backdrops: `mycelium`, `dusk`, `ink`, `paper`, `none`, or any CSS. `--theme`
switches the app's own theme. `--backdrop canvas` paints the project's own
background (a docs site's animated scene, say) when `shotkit.config.json`
names its script in `backdrop.canvas`.

## Tech-demo framing (tilted, launch-page style)

```bash
shot app / --demo --chrome                    # tilted window on a dark stage
shot code src/x.ts --range 1:30 --tilt right --reflect
shot url https://example.com --tilt dutch     # flat dutch angle
shot term --tilt 10,-24,3 -- git status       # x,y,z degrees; one number = dutch only
shot video / --demo --do click:Save --drift 14
```

Presets: `hero` (the `--demo` default), `left`, `right`, `dutch`, `desk`,
`flat`. Extras: `--perspective <px>`, `--fit <0-1>`, `--stage WxH`,
`--no-glow`, `--reflect`, `--grid`, and for video `--drift <deg>` (default
10; `0` holds the angle). A staged video adds a staging pass after the take,
about 25ms a frame.

## Per-project setup

Optional `shotkit.config.json` at the project root: `app.dir` (where the
frontend lives), `app.mockScript` / `app.mockEnv` (what `--mock` boots and
keeps warm), `app.mockHeader` / `app.mockProbe` (how to tell the mock server
from a real one), `app.storage` (localStorage for every shot), `flows` /
`setup` (committed flows, and one to run first), `backdrop.canvas` / `backdrop.size` / `backdrop.pixelated`
(the `canvas` backdrop). `SHOTKIT_PROJECT=<dir>` points shotkit at a config
folder other than the git root, which lets you shoot a repo without adding a
file to it. See the shotkit README for the full list.

## Rules

- Don't hand-roll Playwright for a screenshot; if shotkit lacks something, add
  it to the shotkit repo.
- Leave the daemon running (it idles out after 15 minutes). `shot stop` only
  for a clean slate, and note it also stops a mock server the daemon started.
