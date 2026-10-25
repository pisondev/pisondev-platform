# assistant-web

Private web app for `assistant.pisondev.com`. Next.js 16 (App Router), React 19,
Tailwind 4. Mobile first, built from the Figma frames described in
[design/README.md](../../design/README.md).

For new pages and shared components, follow the
[design system](../../design/assistant-design-system.md), review the
[UI/UX audit](../../design/assistant-uiux-audit.md), and use the
[motion/loading specification](../../design/assistant-motion.md) for planned interactions.
The guides distinguish current behavior from proposed improvements and include synthetic
visual references.

```bash
pnpm install
pnpm dev        # http://localhost:3100, /api forwarded to API_ORIGIN (default :8100)
pnpm lint && pnpm exec tsc --noEmit && pnpm build
```

| Route | Screen |
|---|---|
| `/` | Assistant home |
| `/login` | Google sign-in |
| `/finance` | Balance, cash flow, links |
| `/finance/subscriptions` | Subscriptions chart and tables |
| `/finance/quota` | Weekly quota, recent expenses, savings, add transaction |
| `/links` | Short links on `go.pisondev.com`: create, copy, QR code, visits, edit, pause, delete |

`src/proxy.ts` sends visitors without a session cookie to `/login`; the API still checks
the session on every request.
