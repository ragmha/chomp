---
name: secure-web-app
description: Apply CHOMP's web security standard. Use whenever writing to the DOM, handling player input, adding a dependency, loading an asset, or changing the build or deploy configuration.
---

# Secure web app

CHOMP ships as static files to GitHub Pages and has no backend, so the whole
attack surface is the browser. The standard is deliberately strict because a
40KB game has no reason to need any of the things it forbids.

## Rules

1. **Never write markup from data.** No `innerHTML`, `outerHTML`,
   `insertAdjacentHTML`, `document.write`, or assigning to `element.srcdoc`.
   Use `textContent` for text and `document.createElement` for structure.

   The high-score name field is the live example: it is player-controlled text
   rendered back to the page. `scoreEl.innerHTML = name` is a DOM XSS, and
   CodeQL flags it as `js/xss-through-dom`.

   ```ts
   // ✗ injection
   nameEl.innerHTML = playerName;
   // ✓
   nameEl.textContent = playerName;
   ```

2. **No dynamic code.** No `eval`, no `new Function`, no `setTimeout` with a
   string body. The CSP below blocks these anyway; don't write code that needs
   an exception.

3. **Self-host everything.** No third-party CDN for scripts, fonts or styles.
   Every byte served is a byte in this repository, which is what makes the
   build attestation meaningful.

4. **Content Security Policy.** `index.html` must carry:

   ```
   default-src 'self'; script-src 'self'; style-src 'self';
   img-src 'self' data:; connect-src 'self'; object-src 'none';
   base-uri 'none'; frame-ancestors 'none'
   ```

   Note there is no `'unsafe-inline'`. If a change needs it, the change is
   wrong.

5. **Validate player input at the boundary.** The name field accepts at most 12
   characters matching `/^[\p{L}\p{N} _-]*$/u`. Reject rather than sanitise —
   silently stripping characters hides bugs.

6. **Nothing sensitive in storage.** `localStorage` holds high scores and key
   bindings only. No tokens, ever. This repo has push protection enabled and a
   committed secret will be blocked at `git push`.

7. **Pin the supply chain.** GitHub Actions are pinned to a full commit SHA
   with a version comment. Every workflow declares an explicit least-privilege
   `permissions:` block.

   ```yaml
   permissions:
     contents: read
   steps:
     - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
   ```

## Verify

```bash
npm run lint && npm run build
```

Lint fails the build on `no-danger` violations. CodeQL runs
`security-extended` on every PR, and Copilot Autofix proposes patches for what
it finds. Report any new CodeQL alert in your summary rather than merging past
it.
