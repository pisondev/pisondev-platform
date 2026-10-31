# Design

## Meeting

[Meeting UI](meeting-ui.md) documents the independent responsive availability feature,
its interaction states, and synthetic screenshots. Product analysis and implementation
contracts are in [Meeting availability](../docs/meeting.md).

## Assistant documentation

Reviewed on 20 Oct 2026 for `assistant.pisondev.com`. Start here before building or
changing an assistant page:

| Guide | Use it for |
|---|---|
| [Assistant design system](assistant-design-system.md) | Current tokens, scaled units, layout, typography, colors, component contracts, data states, and a new-page recipe |
| [Assistant UI/UX audit](assistant-uiux-audit.md) | Route inventory, synthetic visual references, measured findings, accessibility/state gaps, and priorities |
| [Assistant motion and loading](assistant-motion.md) | Proposed interactions, chart animation, exact skeleton geometry, custom dropdowns, overlay lifecycle, reduced motion, and implementation checks |

The design system records the implemented baseline. The audit and motion guide identify
proposed improvements; this documentation does not implement them. Public screenshots in
[`assets/assistant/`](assets/assistant/) use synthetic data. Raw Figma exports remain
private and ignored.

## Figma source

Source: Figma file "Personal Platform", page 1, mobile frames 1080 px wide:

| Frame | Route |
|---|---|
| Home Dashboard | `/finance` |
| Subscriptions (page, chart and table cases) | `/finance/subscriptions` |
| Weekly Spending Quota (page, progress bar cases) | `/finance/quota` |
| Cash Flow detail (no Figma frame; reuses Finance parts) | `/finance/cashflow` |

The home hub `/` and the login page are not in Figma; they reuse the same tokens.

## Tokens

Defined in `apps/assistant-web/src/app/globals.css`.

- One Tailwind spacing unit = one Figma pixel, scaled to the screen; the column stops at
  480 px. Text never goes below 11 to 24 px depending on its role.
- Font: Kaisei Opti 500/700. Chevrons: Bruno Ace SC.
- Surfaces: page `#FAFAFA`, panel `#F0F0F0`, card `#FAFAFA`, track `#E9E9E9`.
- Card radius: 18 scaled design units (6.5 CSS px at 390 px; 8 CSS px at 480 px).
- Text: ink `#1A1A1A`, muted `#787878`, green `#165D23`, blue `#2A5FC2`, gold `#866633`,
  maroon `#810F0F`, wine `#5D1616`, pink `#DB4B6F`.
- Title gradient `#03310A` to `#866633`.
- Progress fills: green `#59CEBA`→`#5CD38A`, yellow `#CEA159`→`#D3C95C`, red `#CE5959`→`#D37C5C`.

Small changes from the file: typos fixed ("Subscription"), a Back link on the Finance
dashboard, and the subscription table follows the Monthly/Yearly switch.

## Exports

`design/figma/` holds raw exports (`nodes.json` with every layer's geometry, fills and
text styles, and PNGs of every frame). It is git-ignored because the mockups show real
finance figures. To refresh it, open the file in the browser and, in the developer
console, read the `figma` object: serialize `figma.root` to JSON and call
`node.exportAsync({ format: "PNG" })` on each frame.
