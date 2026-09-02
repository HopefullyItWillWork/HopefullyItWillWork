LEAGUE LEDGER - deploying

Drag this WHOLE FOLDER onto the Production deploys box in Netlify.
Not index.html on its own - the folder, so the function goes with it.
You must be LOGGED IN, or Netlify skips the build and the function is never created.

  index.html                    the site
  netlify/functions/state.mjs   shared storage, backed by Netlify Blobs
  package.json                  installs @netlify/blobs
  netlify.toml                  build settings

STORAGE LAYOUT
League data is split across five independent Blobs keys, so writes to one
never clobber another:

  settings   cap, tax, roster size, season phase   rarely written
  rosters    contracts, cuts, PINs                 low traffic
  auction    the live block                        written constantly in a draft
  trades     open offers                           low traffic
  log        transaction history                   APPEND ONLY, cannot lose entries

Bidding touches only the auction key. The log is appended rather than rewritten,
so two GMs recording moves at the same instant both survive.

Per-GM projections are NOT stored here. They stay in each GM's own browser.

CHECK IT WORKED
Open the site and look at the status chip in the header:
  "shared - N transactions"  the league database is live
  "this device only"         the function did not deploy; check the Deploys log
