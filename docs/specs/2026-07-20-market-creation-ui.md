# Market Creation UI Specification

## Availability correction

Category presentation must follow the [oracle capability specification](./2026-07-20-oracle-capability-gating.md). A category card may be shown for discovery, but it must be disabled unless the exact template has an active network capability enforced by the deployment path. UI guidance cannot be treated as resolver support.

## Objective

Make market creation clear, category-driven, responsive, and trustworthy without changing the existing Stellar deployment flow.

## Problems

- Price and event categories are presented as one flat list.
- Large asset sets are difficult to scan, especially on mobile.
- Event questions, sources, YES rules, and void rules have no visible hierarchy.
- The preview does not clearly summarize category, resolution method, timing, collateral, or readiness.
- Interactive controls need larger targets, semantic labels, selected states, and reduced-motion support.

## Experience

### Category selection

- Split categories into Price feeds and Event outcomes.
- Show every category as a vector-icon card with a short resolution description.
- Keep the selected category visible through icon, border, text, and `aria-pressed` state.
- Switching categories must preserve a stable layout and update category-specific guidance immediately.

### Price markets

- Show the supported asset set for the selected price category.
- Use official token icons where available and a consistent monogram fallback for fiat and gold.
- Show the current public feed value when available and allow it to fill the strike price.
- Identify the active free Reflector feed and make clear that the market settles against USD.

### Event markets

- Use category-specific question, source, YES rule, and void rule guidance.
- Separate outcome definition from resolution evidence.
- Require one primary source and one to three distinct backup sources.
- Show a live readiness checklist without blocking input or showing premature errors.

### Timing and funding

- Present settlement timing as three large selectable controls.
- Summarize the exact USDC creator subsidy, wallet readiness, and testnet status.
- Keep wallet, trustline, balance, resume, deploy, progress, success, and recovery states intact.

### Preview

- Keep a sticky summary on desktop and a natural inline summary on mobile.
- Show the market question, category, collateral, settlement window, resolution path, and current readiness.
- Show the live chart for price markets and the YES and void rules for event markets.

## Interaction and accessibility

- All controls have at least a 44px target.
- Inputs use real labels, descriptions, stable IDs, and invalid states after an attempted submission.
- Category and option controls expose selected state to assistive technology.
- Focus rings remain visible.
- Motion uses 150ms to 300ms opacity, color, and border transitions.
- Reduced-motion preferences disable nonessential transitions.
- The layout must work at 375px, tablet, desktop, and wide desktop widths.

## Success criteria

- Users can distinguish price and event creation before entering details.
- Every supported category can be selected and displays the correct creation guidance.
- Price and event markets retain the existing validation and deployment behavior.
- Desktop and mobile browser tests cover category switching, asset coverage, source requirements, and selected states.
- Type checks, unit tests, browser tests, and the production build pass.

## Non-goals

- No contract, oracle, fee, or settlement changes.
- No new paid service or icon dependency.
- No merge to main or production deployment before user verification.
