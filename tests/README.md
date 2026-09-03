# Tests

CLAUDE.md is explicit that `node --check` proves nothing — the worst bugs in this
project parsed perfectly. These run the app.

```
node tests/test.js                 # the working tree's deploy/index.html
node tests/test.js path/to/old.html # any other build, e.g. to check a test is not vacuous
```

- `dom.js` — a DOM stub with enough behaviour to execute the real script: ids are
  scraped out of assigned `innerHTML`, `querySelectorAll` understands the
  attribute selectors the app uses and **memoises its results** so handlers bound
  to those elements survive, `value` coerces to a string like a real input, and
  every `document` click listener is kept rather than only the last.
- `run.js` — extracts the `<script>` block, runs it in a vm with a stubbed
  `window`, `localStorage` and an offline `fetch`, then exposes the top-level
  `let`/`const` bindings (which do not land on the vm global) as `ctx.__X`.
- `test.js` — the assertions.

If you add a test, check it fails against the previous build before trusting it.
