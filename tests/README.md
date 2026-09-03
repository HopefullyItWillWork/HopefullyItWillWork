# Tests

CLAUDE.md is explicit that `node --check` proves nothing — the worst bugs in this
project parsed perfectly. These run the app.

```
node tests/test.js                  # the app, against the working tree's deploy/index.html
node tests/test.js path/to/old.html # any other build, to check a test is not vacuous
node tests/smoke.js                 # renders every view as signed-out, commissioner, each GM
node tests/mail.test.js             # the mail functions' pure logic
```

- `dom.js` — a DOM stub with enough behaviour to execute the real script: ids are
  scraped out of assigned `innerHTML`, `querySelectorAll` understands the
  attribute selectors the app uses and **memoises its results** so handlers bound
  to those elements survive, `value` coerces to a string like a real input, and
  every `document` click listener is kept rather than only the last.
- `run.js` — extracts the `<script>` block, runs it in a vm with a stubbed
  `window`, `localStorage` and an offline `fetch`, then exposes the top-level
  `let`/`const` bindings (which do not land on the vm global) as `ctx.__X`.
- `test.js` — the app's assertions.
- `smoke.js` — renders every view for every sign-in state; catches the whole class
  of "the page loads styled and completely inert" bugs.
- `mail.test.js` — imports `deploy/netlify/functions/lib/format.mjs` directly. That
  module imports nothing, so this needs no Netlify runtime and no `@netlify/blobs`
  installed. It covers the timezone bucketing, which is the part of the mail code
  most likely to be quietly wrong.

If you add a test, check it fails against the previous build before trusting it.
