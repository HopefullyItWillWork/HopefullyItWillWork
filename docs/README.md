# Docs

## League-Ledger-GM-Guide.docx

The tutorial to send to the GMs. It covers every tab a GM can see, with a
summary and a how-to for each, and the screenshots are taken from the real app.

**It deliberately contains no commissioner functionality.** The capture script
signs in as a plain GM — never the commissioner, and never a deputy — so a
screen a GM cannot reach cannot end up in a screenshot by accident.

Numbers in the screenshots are the `SEED` data, not the live league. The guide
says so in its closing section.

### Rebuilding it

Both scripts need `npm i playwright-core docx` somewhere on `NODE_PATH`, and
the sandbox Chromium (override with `CHROME=/path/to/chrome`).

```
node docs/capture-screenshots.js     # retake docs/images/*.jpg from deploy/index.html
node docs/build-gm-guide.js          # rebuild the .docx from those images
```

Retake the screenshots whenever a screen changes shape; the guide references
them by name, so a rebuild picks the new ones up automatically. If you add a
screenshot, `build-gm-guide.js` will fail loudly rather than silently omit it.

`capture-screenshots.js` runs each tab in the season phase it belongs to —
Auction, Free agent classes and Rookie draft are offseason-only, Quick sign is
in-season-only — and seeds the screens that are empty in a fresh league (the
transaction log, a live auction lot, a filled lineup, the what-if roster) so
the pictures show something worth looking at.
