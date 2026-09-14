# Mobile Admin Polish

This pass tightens the CajunSites admin experience on phones and tablets without changing application workflows.

## Changes

- Prevent accidental page-level horizontal overflow.
- Respect top, bottom, left, and right safe areas for modern phones.
- Tighten mobile header, drawer, grouped navigation, and content spacing.
- Reduce card and metric padding on narrow screens.
- Collapse dense page grids to a single column where two-column layouts became cramped.
- Preserve intentional horizontal scrolling for lifecycle and pipeline tracks while containing it to those components.
- Convert admin tables into compact labeled mobile records without wrapper overflow.
- Improve wrapping for long domains, URLs, metadata, notes, and table values.
- Tighten Design Studio conversation/composer layouts on mobile.
- Refine Overview spacing and make KPIs single-column on very narrow devices.
- Add a 360px fallback for particularly narrow phones.

## Guardrails

Mobile responsiveness invariants now assert that the dedicated mobile polish stylesheet is loaded, safe-area support remains present, accidental horizontal overflow is suppressed, intentional scroll regions remain contained, and narrow-phone fallbacks remain implemented.
