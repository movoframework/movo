# {{projectName}}

A paid HTTP API that is **discoverable** — with the listing metadata derived from the resource
rather than written alongside it — plus a buyer script that finds and pays for it.

## Next commands, in order

```bash
npm install
cp .env.example .env      # then set MOVO_PAY_TO to your Stellar address
npx movo doctor           # checks everything before you need it
npx movo bazaar validate  # checks your discovery metadata specifically
npx movo dev              # starts the server
```

## Discovery, honestly

**Declaring metadata does not create a listing.** A listing is created by the facilitator you
configured, when a buyer pays and echoes your declaration, and only if that facilitator operates
a catalog at all. Movo cannot promise inclusion and does not.

What Movo does is make the *silent* failures loud. Upstream's posture is to drop an invalid field
and catalogue the rest — right for a facilitator, wrong for you, because the first you would
learn of it is a listing with no icon and nothing to search for. `movo bazaar validate` runs
upstream's own validators at build time and turns each silent drop into an error with a fix.

Try it: change `iconUrl` in `movo.config.ts` to `http://localhost:3000/icon.png` and run
`npx movo bazaar validate`. You get `MOVO_E_DISCOVERY_ICON_URL_INVALID`, because a catalog
fetches that URL and loopback addresses are an SSRF risk. Upstream would have dropped the field
without telling you.

## What is derived, not written

| Listing field | Comes from |
|---|---|
| route template | the resource's `path` |
| method, body type | the resource's `method` |
| `inputSchema` | the Zod schema on `input`, converted |
| description | the resource's `description` |
| serviceName, tags, iconUrl | `discovery` in `movo.config.ts` |

Nothing is duplicated, so the listing cannot advertise a path that no longer exists.

Schema derivation works for **Zod v4** (`import { z } from "zod/v4"`). Standard Schema describes
validation, not introspection, so there is no vendor-neutral way to produce JSON Schema from an
arbitrary validator. For anything else, set `discovery.inputSchema` explicitly — Movo warns
rather than guessing.

## The buyer

```bash
# in another terminal, with STELLAR_PRIVATE_KEY set to a funded testnet buyer seed
npm run buyer
```

Read `src/buyer.ts` for the budget. A 402 is a claim, not a fact: a server can name any `payTo`
and any amount, and the facilitator will settle whatever was signed. The buyer is the only party
that can refuse, and refusal happens **before** signing — so a refused offer leaves no signed
authorisation in existence.

## Files

```
movo.config.ts        configuration, including project-level discovery metadata
src/app.ts            every resource this API serves
src/resources/        route, price, schemas and handler in one declaration
src/server.ts         the production server
src/buyer.ts          discover, then pay, with a budget
src/weather.test.ts   compiles, validates discovery, and asserts the 402 — no network
```

## Telemetry

None. Movo collects nothing, reports nothing, and phones nowhere.
