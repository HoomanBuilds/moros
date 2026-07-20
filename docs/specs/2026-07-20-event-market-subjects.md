# Event Market Subjects and Media Specification

## Objective

Make non-crypto markets first-class throughout Moros. Event markets must identify what the prediction is about and show a relevant visual instead of pretending every market is a token.

## Subject model

Every event market requires a short subject name. The field adapts by category:

- Equities: company or ticker
- Commodities: commodity or benchmark
- Sports: team, player, league, or event
- Economics: indicator and geography
- Weather: location or station
- Politics: candidate, office, jurisdiction, or measure
- Technology: company, product, project, or standard
- Entertainment: event, title, artist, or nominee
- Other: primary subject

The subject is display metadata. Resolution remains controlled by the hashed question, source hierarchy, YES rule, and void rule.

## Visual sources

Use sources in this order:

1. Existing Web3Icons assets for supported crypto price markets.
2. Existing Lucide category icons as the universal event fallback.
3. A creator-provided JPEG, PNG, or WebP image that the creator owns or has permission to use.
4. A selected Wikimedia Commons image with its source, author, and license preserved.

Do not scrape arbitrary search-engine images or copy an image without provenance.

## Wikimedia Commons flow

- Search only after a user action.
- Request a small result set from the official MediaWiki API.
- Show thumbnail, title, author, and license before selection.
- Accept only HTTPS thumbnails hosted by `upload.wikimedia.org`.
- Download the selected thumbnail into the existing `market-banners` Supabase bucket after deployment.
- Store the Commons file page, attribution, license name, and license URL.
- Display the credit on the market About panel.

## Creator upload flow

- Accept JPEG, PNG, and WebP only.
- Maximum file size is 5 MB.
- Preview locally before deployment.
- Explain that the creator must own the image or have permission to use it.
- Upload only after wallet authentication and successful market deployment.
- A failed optional image upload must not hide or invalidate a successfully deployed market.

## Display behavior

- Market creation preview shows the selected subject image immediately.
- Grid cards show event artwork or a category fallback banner.
- List rows and market headers show a square subject visual.
- Featured event markets show event artwork instead of a broken asset-price chart.
- Price markets continue to use token, fiat, or gold visuals and price charts.
- Market search includes question, category, and subject.
- Market browsing exposes category filters for both price and event markets.

## Accessibility and safety

- Every subject image has descriptive alt text.
- Decorative category icons remain hidden from assistive technology.
- Image search has loading, empty, error, selected, and removal states.
- Remote image URLs are allowlisted and validated before download.
- Uploaded files are validated before storage.
- Attribution links open the original Commons file and license pages.

## Success criteria

- Users can create a Sports, Politics, Equities, or other event market with a named subject and image.
- Event visuals persist through the public registry and appear across market discovery and detail pages.
- Every event remains visually complete when no custom image is selected.
- All metadata fallbacks continue working against databases that have not yet applied the newest migration.
- Unit tests, browser tests, TypeScript, and the production build pass.
