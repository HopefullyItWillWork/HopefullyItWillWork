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

THE CUSTOM DOMAIN (hopefullyitwill.work)
If the browser says "uses an unsupported protocol" or
ERR_SSL_VERSION_OR_CIPHER_MISMATCH, the domain is not pointed at Netlify.
Check it with a lookup:

  nslookup hopefullyitwill.work

Pointed correctly, that answers with a Netlify address. As of this writing it
answers 207.207.210.107 and 207.207.210.229, and www is a CNAME to
pixie.porkbun.com - those are Porkbun's parking servers, where the domain sits
by default after registration. Parking holds no certificate for the domain, so
the TLS handshake fails before any page is served. That is the whole error: it
is DNS, not the site. Nothing in index.html can fix it, and redeploying will
not either.

To fix it, in this order:

1. Netlify - Site configuration, Domain management, Add a domain. Enter
   hopefullyitwill.work. Netlify then lists the apex and the www version, and
   shows the exact DNS records it wants. Use the values from that screen, not
   from memory - they change.

2. Porkbun - the DNS records page for the domain. DELETE the parking records
   first (the A / ALIAS / CNAME entries pointing at porkbun.com hosts). Leaving
   them in place keeps the domain on parking no matter what else is added.
   Then add what Netlify asked for: an A or ALIAS record on the apex, and a
   CNAME on www pointing at <your-site>.netlify.app.

   The alternative is to hand the whole domain to Netlify: set the Porkbun
   nameservers to the four Netlify gives you. Fewer records to get wrong, but
   any other DNS for this domain (email especially) has to be recreated there.

3. Wait for the change to propagate, then back in Netlify, Domain management,
   HTTPS - provision the certificate. Netlify issues a free Let's Encrypt one
   automatically once DNS resolves to it. The browser error persists until this
   step completes, even after DNS is right.

If the certificate will not issue, check for a CAA record on the domain at
Porkbun. A CAA record that does not name letsencrypt.org blocks issuance.

Do not turn on HSTS until the site loads over https. HSTS tells browsers to
refuse http for the domain, and they remember it - switching it on while the
certificate is broken locks people out of the site until the header expires.

WHY IT LOADS ON SOME DEVICES AND NOT OTHERS
Any device that works is almost certainly opening the .netlify.app address
rather than hopefullyitwill.work. That address has always had a valid
certificate. Check the URL in the address bar on the machine where it works -
if the two differ, that confirms the domain, not the device, is the problem.
