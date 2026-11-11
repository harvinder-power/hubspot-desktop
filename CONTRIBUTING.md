# Contributing

Thank you for your help. This project is an unofficial desktop client for HubSpot.
It is not affiliated with, endorsed by, or sponsored by HubSpot, Inc.

## Setup

You need Node.js and npm.

```sh
git clone https://github.com/harvinder-power/hubspot-desktop.git
cd hubspot-desktop
npm install
```

## Commands

| Command | What it does |
|---|---|
| `npm start` | Runs the app. |
| `npm test` | Runs the unit tests. |
| `npm run test:e2e` | Runs the end-to-end tests against the local fixture. |

## Branches

- `next` is the integration branch. Open every pull request against `next`.
- `main` is the release branch. Do not open pull requests against `main`.

## Pull requests

- Keep each pull request small, with one concern.
- Split a large change into a stack of small pull requests.
- Fill in the pull request template, including how you verified the change.

## Tests

- Tests run against the local fixture only.
- Never run tests against a real HubSpot portal.
- Never put real tokens, cookies, or customer data in tests, fixtures, or issues.

## Assets and trademarks

- Do not add HubSpot logos, icons, or other HubSpot trademarks to `assets/` or anywhere else.
- Do not use a name that reads as an official HubSpot product.

## Security

Report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## Code of conduct

This project follows the [code of conduct](CODE_OF_CONDUCT.md).

## Licence

By contributing, you agree that your contribution is licensed under the [MIT licence](LICENSE).
