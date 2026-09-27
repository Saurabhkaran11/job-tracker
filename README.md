# Job Tracker

- A local-first React app for tracking job applications — one card per company, each holding its application links, a resume file, and free-form custom fields.
- Built with Vite 8 + React 19, styled with Tailwind CSS v4 plus a hand-written motion layer in `src/App.css`.
- No backend and no accounts — everything persists to `localStorage` under the key `job-tracker-data`.

---

## Quick start

- `npm install` — install dependencies.
- `npm run dev` — start the Vite dev server with HMR.
- `npm run build` — produce a production build in `dist/`.
- `npm run preview` — serve the production build locally.
- `npm run lint` — run Oxlint over the source.
- `npm test` — run the full test suite once.
- `npm run test:watch` — re-run tests as files change.

---

## Completed — data layer

- `localStorage` persistence via `loadCompanies()` and `persist()`, both wrapped in `try/catch` so a quota error or corrupt payload degrades to an empty list instead of a white screen.
- TanStack Query as the in-memory cache, configured with `staleTime: Infinity` and `gcTime: Infinity` so reads never refetch.
- A single `useCompanies()` hook exposing `{ companies, isLoading, setCompanies }`.
- `setCompanies` accepts either a value or an updater function, writes through to `localStorage`, then invalidates the `['companies']` query key.
- Zod schemas for validation — `companySchema` caps a company name at 1–100 characters, `linkSchema` rejects anything that is not a valid URL.
- React Hook Form wired to Zod through `@hookform/resolvers`.
- A 2 MB file-size ceiling (`MAX_FILE_SIZE`) enforced on resume upload.
- Every record is keyed by `crypto.randomUUID()`.

---

## Completed — screens

- Two routes registered in `App`, using `react-router-dom` v7.
- `/` renders `HomePage`.
- `/company/:id` renders `CompanyPage`.
- Provider stack wraps the router in this order — `QueryClientProvider`, `ThemeProvider`, `CssBaseline`, `ToastProvider`, `BrowserRouter`.

### HomePage

- Gradient title block with a briefcase icon.
- A single combined input that both searches existing companies and adds a new one.
- Duplicate-name guard — adding a name that already exists (case-insensitive) raises a warning toast instead of creating a second record.
- Live client-side filtering on company name as you type.
- Card-style switcher offering two looks — **Compact** and **Detailed**.
- `Compact` — dense list row, numbered badge, link count and a resume chip.
- `Detailed` — roomy card with accent border, link preview chips, corner accent dots and a resume block.
- A **Hide / Show Job Links Tracker** toggle for the dashboard table, independent of Collapse List.
- A **Dark mode** toggle (sun/moon) switching the whole app between light and dark.
- A **Sample data** icon opening a panel that lists every feature with the sample value demonstrating it, and loads that data in one click.
- A **Bulk add** toggle opening one form that creates a whole application in a single submit — company, role title, several job links and any of the preset toggles.
- Collapsible section state via the `collapsed` flag.
- Summary stats memoised with `useMemo` — total companies, total links, and count of companies with a resume attached.
- Dashboard table with **Status** and **Priority** columns reading straight off those toggles.
- Status chips are colour-coded per stage — Offer green, Interviewing purple, Rejected red, On Hold grey, Applied blue, Phone Screen indigo, Take-home amber.
- Priority chips are colour-coded — High red, Medium amber, Low grey.
- An unset Status or Priority shows a dash, so a blank cell reads as "not recorded" rather than broken.
- The table can be hidden and brought back without touching the company cards below it.
- A **Load sample data** button on an empty tracker seeds four companies exercising every toggle type.
- Inline rename on a card, committed on blur or Enter and cancelled on Escape.
- Delete guarded by a `window.confirm()` prompt.

### CompanyPage

- Sub-tab navigation across `links`, `resume`, `custom`, plus one tab per user-defined custom field name.
- `CompanyLinks` — add, inline-edit, and remove application links, each with an optional label.
- `CompanyResume` — upload, download, and remove a resume file, with a 2 MB ceiling.
- `CompanyCustom` — create named fields and edit their values, scoped to the selected role.
- **Multiple roles per company** — one employer can hold several applications, each with its own recruiter, status, dates, salary, **job links and resume**.
- A role strip on the company page switches between them, and roles can be added, removed and **reordered by dragging**.
- Alt+Left / Alt+Right moves the focused role, so reordering does not require a mouse.
- The order is persisted and drives the role strip, the All-roles comparison columns and the dashboard chips alike.
- **Each role remembers its own layout** — Compact, Detailed or Table — so switching roles also switches to the layout that role was last read in.
- `Compact` — one section at a time behind the sub-tab strip.
- `Detailed` — every section stacked on one page, no tabs.
- `Table` — all toggles as a dense, still-editable two-column table with the role's links underneath.
- **All roles** — a comparison view putting every role side by side, one column each, so two applications can be read against each other without switching.
- Records saved before roles existed are migrated on read into a single role, so nothing is lost.
- Fourteen one-click preset toggles covering what a job application actually needs — Status, Priority, Applied Date, Interview Date, Offer Deadline, Role, Location, Salary, Recruiter, Referral, Contact Email, Portal Login, Next Step, Notes.
- Each preset renders the input its data deserves rather than a bare text box.
- `Status` — dropdown: Applied, Phone Screen, Interviewing, Take-home, Offer, Rejected, On Hold.
- `Priority` — dropdown: High, Medium, Low.
- `Applied Date`, `Interview Date`, `Offer Deadline` — native date pickers.
- `Contact Email` — email input.
- `Portal Login` — URL input.
- `Next Step`, `Notes` — multi-line text areas.
- Everything else, including any name typed by hand, falls back to a plain text box.
- Presets already on a company drop out of the list, so the chips only ever offer what is missing.
- Picking a preset creates the field, opens its tab and puts the cursor on it in one step.
- A free-text box remains for anything the presets do not cover.
- Panels swap by re-mounting a single `motion.div` keyed on the active tab, so each switch fades the new panel in.

---

## Completed — UI system

- MUI theme built per mode by `buildTheme(mode)` — accent `#9333ea` in light, `#a855f7` in dark, 12px base radius, Inter typeface.
- `ThemeModeProvider` owns the mode, mirrors it onto `<html class="dark">` and persists it under `job-tracker-theme`.
- A first visit follows the OS `prefers-color-scheme`; after that the saved choice wins.
- Tailwind's `dark:` variant is redefined in `index.css` to follow that class rather than the media query.
- `App.css` carries a dark block overriding only surfaces, borders and text — the accent ramp, easing and motion are shared, so both modes read as the same design.
- Status and Priority chips carry both themes; the light pastels glare on charcoal, so each has a translucent dark counterpart.
- Toast system built on a React context — `ToastProvider`, `ToastContainer`, and the `useToast()` hook.
- Toasts animate in and out from the right edge and support `success` and `warn` variants.
- A central `iconMap` with 21 named icons, consumed through one `<Icon name="..." />` wrapper so icon choices are swappable in one place.
- Inter loaded with antialiasing hints in `src/index.css`.

---

## Completed — motion layer (`src/App.css`)

- `.card-link` / `.card` — link reset plus the `perspective: 1000px` and `preserve-3d` context that every 3D hover depends on.
- `.card-compact` — grey pill card, 8px radius, border shifts to violet on hover.
- `.card-detailed` — 16px radius, white-to-lavender gradient, paired with `.card-flowing` for its accent edge.
- `.card-featured` — violet-tinted gradient with a solid `#c4b5fd` border and a deeper hover lift.
- `.card-flowing` — animated gradient border ring, fading in on hover.
- `.card-perspective` — `rotateY(2deg) rotateX(-1deg) scale(1.02)` tilt on hover.
- `.card-magnetic` — 4px lift with a violet-tinted shadow.
- `.magnetic-snap` — 2px diagonal nudge toward the cursor.
- `.card-shimmer` — white highlight sweeping left to right on a 2s loop.
- `.masked-text` — violet underline that wipes in from the right and out to the left.
- `.magnetic-dot-1/2/3` — three accent dots that fade in on featured-card hover.
- `.workspace-bg` — three soft violet and blue radial gradients behind the page.
- `.card-grid-perspective` — shared 1200px perspective so tilted cards in a grid share one vanishing point.
- `.compact-number` — 24px square numbered badge.
- `.tab-nav` — gradient underline indicator on the active sub-tab.
- `.panel-container` — positioning context for the animated panels.

### Design tokens held consistent across the file

- One easing curve everywhere — `cubic-bezier(0.23, 1, 0.32, 1)`.
- One accent ramp — violet `#9333ea` into blue `#3b82f6`.
- Borders — `#e2e8f0` at rest, `#c4b5fd` on hover.
- Shadows are always violet-tinted `rgba(147, 51, 234, …)`, never neutral black.
- Light theme only — there is no dark-mode variant.

---

## Closed out in the latest pass

- `.card-flowing` was referenced by the `detailed` and `featured` card variants in `App.jsx` but had no rule at all — now implemented as a masked conic-gradient border ring.
- `.tab-nav button.active::after` never rendered, because the button had no `position: relative` for the absolutely-positioned underline to anchor to — the positioning context is now declared.
- `.tab-nav` was re-declaring `display: flex`, `gap: 0`, and a bottom border that Tailwind already sets on the same element, with `gap: 0` fighting the `gap-1.5` utility — the duplicates are gone and `.tab-nav` is now purely the hook for the indicator.
- `.card-masked-type` and its `maskShift` keyframes were dead and duplicated `.masked-text` — removed.
- `.card-float` and its `float` keyframes were dead — removed.
- `.flow-path` and its `dashFlow` keyframes were dead — removed.
- `.compact-indicator` and `.compact-body` described sub-elements that were never rendered — removed.
- The `/* Panel transition */` comment promised CSS that did not exist, since framer-motion owns those transitions — the comment now says what the rule actually does.
- `.card-detailed::before` and `.card-shimmer::before` both targeted the same pseudo-element on the `detailed` variant, so they merged instead of stacking and the shimmer overwrote the conic sweep entirely — the unreachable sweep and its `flowingBorder` keyframes are gone, with `.card-flowing` supplying that motion instead.
- Every rule in the file now carries an explanatory comment and a worked `className` example showing how it is actually applied in `App.jsx`.

### Two crashes in `src/App.jsx`, found while verifying the above

- `CompanyPage` referenced `customNames` and `customFields` but never declared either, so `/company/:id` threw `ReferenceError: customNames is not defined` and rendered a white screen — both are now derived from `company.customFields` before first use.
- `CompanyPage` called `useCallback` for `setCB` *below* the `if (!company) return` early bail-out, so a found company ran 53 hooks and a missing one ran 52 — React threw `Rendered more hooks than during the previous render` and blanked the page. The hook now sits above the early return, as the Rules of Hooks require.
- Both are fixed and verified in the browser: `/company/:id` renders, the sub-tab strip shows `Job Links / Resume / Recruiter / Add Custom`, and the gradient tab indicator now measures 94.6px under a 95px button.

### The add/search box on HomePage did nothing

- `TextField` passed `InputProps`, which MUI v9 removed — it fell through to the DOM as `inputprops="[object Object]"` and both adornments were silently dropped, so the search icon and the **Add button never rendered at all**. Replaced with `slotProps={{ input: … }}`.
- `useForm`'s `register` was never applied to the input, so `handleSubmit` always received `name: ''`, failed `companySchema`'s `.min(1)`, and swallowed every add with no feedback. The field is now validated directly with `companySchema.safeParse({ name: query })`, giving one source of truth for the box that both searches and adds.
- `size="large"` is not a valid `TextField` size (only `small` and `medium`), and produced a `MuiInputBase-sizeLarge` class with no styles behind it.
- Enter did not submit, because the only submit button sits inside an `InputAdornment` rather than as a direct child of the form — an explicit `onKeyDown` handler now runs the same `onSubmit`.
- Verified: clicking Add appends the company and clears the box, Enter does the same, the duplicate guard and the empty/whitespace guard both reject without adding, and typing still filters the list live.

### Sweeping the rest of `App.jsx` turned up four more broken interactions

- **Sub-tab switching did nothing at all.** `AnimatePresence mode="wait"` was given several sibling conditionals, but `mode="wait"` expects exactly one child — it holds the incoming child until the outgoing one exits, and with siblings it could not pair them. The first panel to mount (Job Links) never exited, so Resume, Add Custom and every custom-field tab highlighted the tab but left the Links panel on screen. Now a single `motion.div` keyed by `activeSubTab`.
- **Adding a custom field was impossible.** The Add button called `setShowCustomInput(true)`, but the name box was gated on `expandedCustom['__add']` — a key nothing ever wrote. The two pieces of state were never connected, so the input never appeared. Both now read `showCustomInput`.
- **Custom fields loaded from storage never rendered.** Field rows were gated on `expandedCustom[cn]`, which starts `{}` and is only written for names added during the current session — so a `Recruiter` field restored from `localStorage` was invisible. Now shown unless explicitly collapsed.
- **The Add Custom button was invisible.** Its `motion.div` had `initial={{ opacity: 0 }}` and no `animate`, so framer-motion never faded it in — the button rendered at full size (992×52px) at `opacity: 0`, an invisible click target where the only entry point for custom fields should be.
- **The add-link form never cleared.** `CompanyPage` held a second `useForm` whose `resetLink` was called after each add, but the rendered form is `CompanyLinks`' own instance — and `CompanyLinks` also kept local `label`/`url` state that shadowed the form values. That duplicate `useForm` also sat below the not-found early return, a third Rules-of-Hooks violation. Removed; `CompanyLinks` now resets the form it actually renders.
- Verified end to end: all four tabs swap panels, a custom field can be created and its value persists to `localStorage`, a new tab appears for it, link add clears both inputs, and an invalid URL is rejected with an `Invalid URL` helper message.

### Lint cleanup, and what it turned up

- **There was no way to delete a company.** `removeCompany` was fully implemented in `HomePage` — confirm dialog, toast, the lot — and passed to `CompanyCard` as `onRemove`, but no control ever called it. Oxlint had been reporting it as an unused parameter. Added the missing bin button, matching the one already on links; it calls `preventDefault()`/`stopPropagation()` so the click does not navigate into the card's `<Link>`.
- **Panel swapping wedged again after the first fix.** Keying a single child inside `AnimatePresence mode="wait"` still hung: the outgoing panel's exit never resolved — these panels contain their own nested motion components — so the incoming one was held back indefinitely and the Links panel stayed on screen permanently. Replaced with a plain keyed re-mount and no exit animation, removing the dependency on an exit ever completing. Verified across 12 consecutive tab switches with no failures.
- Removed `IconButton` and eight unused `@mui/icons-material` imports; only `AddIconMUI` was ever used.
- Removed the `setCB` prop threaded into `CompanyLinks`, `CompanyResume` and `CompanyCustom` — none of them touched it, since every write goes through a narrower callback.
- Removed the `expandedCustom` state entirely. Once storage-loaded fields were made visible, nothing could ever set a field to collapsed, so the guard was always true and the state was dead.
- `npm run lint` is now completely silent — no warnings, no errors.

### Three reported bugs fixed

- **Resume upload did nothing.** The `<input type="file">` was nested inside a `<motion.button>`. A button swallows the click, and a `<label>` never activates a control nested inside one, so the picker never opened — confirmed with a click listener on the input that never fired. The label is now the clickable target with the input as its direct child.
- **The Resume panel's Links stat was hardcoded to `0`**, so it always claimed a company had no links. It now reads `company.links.length`.
- **One company could only hold one recruiter.** Toggles lived in a flat `customFields` map on the company, so a second interview at the same employer for a different role overwrote the first one's recruiter, status and dates. Toggles now live on a **role**, and a company owns a list of them.
- **Loading sample data destroyed existing companies.** `loadSampleData` assigned `SAMPLE_COMPANIES` straight over the list — confirmed by seeding "My Own Company" and watching it disappear.
- **Then the fix for that created the opposite bug.** Merging by company *name* meant that once samples existed the loader refused with "already loaded", so anyone who had loaded them before the sample shape changed could never get the current version — their Anthropic stayed role-less with no recruiter. Reproduced directly against the built app.
- Both are settled by matching on the stable `sample-` id: the sample companies are dropped and re-inserted with today's definitions, while anything the user created keeps its `crypto.randomUUID()` id and is never touched. The toast says **Added** on a first load and **Refreshed** afterwards.

### Reordering roles

- The drag source is held in a **ref**, not state. `dragstart` and `drop` can land in the same tick, and a state update has not re-rendered by then, so a state-based handler read `null` and silently did nothing — it passed in jsdom, where each event is flushed, and failed in a real browser. State is kept only for the drag-in-flight styling.
- The grip glyph sits outside the chip's `<button>`: inside, it became part of the button's accessible name and broke matching a role by its label.
- Keyboard reordering is provided alongside the drag, since a drag alone is unusable by keyboard and screen-reader users.

### Role views

- `role.view` holds the layout, so it persists and differs between roles; `normaliseRoles()` defaults it for records saved before it existed.
- `All roles` is not a role view — it is a page mode, so it lives in component state rather than being written to any one role.
- The panel's `key` carries the role, the layout and the sub-tab, so every switch is a clean re-mount and no previous role's values linger.
- The section wrapper used by the Detailed layout is defined at module scope: a component created during render gets a new identity each time, remounting its subtree and dropping focus out of whatever field is being typed in.

### Bulk add

- One form writes a whole application: the company, its role title, its job links and any preset toggle, in a single submit.
- Links are typed one per line, optionally `Label | url`; a bare domain is prefixed with `https://`.
- A company that already exists gains a role rather than being duplicated; a duplicate role title at the same company is refused.
- The role title falls back to the `Role` toggle, then to `General application`.
- Untouched toggles are left out rather than written as empty fields.
- The toggle grid is memoised, so a keystroke in the links box does not re-render all fourteen inputs.

### Roles

- `company.roles` is `[{ id, title, links, resume, customFields }]`; the company-level `links`, `resume` and `customFields` are all legacy.
- `normaliseRoles()` migrates a legacy record on read into one role titled after its `Role` field, or `General application` when it has none, carrying its links and resume across — so no storage version bump was needed.
- `allLinks()` and `hasAnyResume()` aggregate across roles for the dashboard's company-level counts.
- Every write goes through `updateActiveRole()`, which rewrites only the selected role and leaves the company's other roles untouched.
- The dashboard shows one Status and Priority chip **per role**, each titled with the role name, and a company card carries an `N roles` badge when it has more than one.
- The panel remounts on a role change, so switching roles cannot leave the previous role's values on screen.
- A company always keeps at least one role; the remove control is hidden when only one remains.

### Sample data panel

- `FEATURE_SAMPLES` is derived from `SAMPLE_COMPANIES` rather than written out separately, so the panel cannot claim a sample the Load button does not actually insert.
- Rows are grouped — Dashboard, Company page, and one group per toggle field type.
- The icon sits in the dashboard control row and is available even with no companies, unlike the empty-state button.

### Card styles merged

- The four card styles were really two. `default` and `compact` both rendered `.card-compact` and differed only in which hover class they carried; `detailed` and `featured` both rendered the same link-preview block and differed only in gradient.
- Each pair is now one style keeping the better half of both — `Compact` takes the numbered badge and resume chip, `Detailed` takes the accent border, corner dots, preview chips and resume block.
- The default view is now `Compact`.

### Company page trimmed

- Removed the **Company Status** block (Links / Resume / Custom counts) from the bottom of `/company/:id`.
- Removed the **Quick Notes** block from the bottom of `/company/:id`.
- Removed the per-panel summary cards too — **Link Summary**, **Resume Note** and **Custom Fields Note**.
- The dashboard's own Quick Notes on `/` is untouched.
- The space the notes occupied in the custom panel now carries the preset toggle chips, which are actionable rather than descriptive.

### Preset toggles

- `PRESET_TOGGLES` holds each preset as `{ name, type, options? }`; adding to that one array is all a new preset needs.
- A single `CustomFieldInput` component serves both the Add Custom panel and the field's own tab, so the two cannot drift apart.
- Storage is unchanged by typing — `customFields` stays a flat `{ [name]: string }` map, so records saved before types existed still load.
- Presets and free text share a single `addCustomFieldNamed(name)` path, so neither is a special case.
- Adding a name that already exists warns instead of silently overwriting the stored value.
- Verified: the chips render minus what the company already has, clicking `Salary` stores `{ Recruiter: 'Sam', Salary: '' }` and switches to the new `Salary` tab, typing `180k` persists, `Salary` then disappears from the chips, and re-adding it by hand warns and leaves `180k` intact.
- Verified per type: `Status` renders a combobox and storing `Offer` persists, `Applied Date` renders `input[type=date]` and `2026-09-15` persists, `Portal Login` renders `input[type=url]`, `Contact Email` renders `input[type=email]`, `Notes` renders a `textarea`, and a hand-typed `Visa Sponsorship` falls back to `input[type=text]`.
- The field label column was widened from 100px to 140px; the longer preset names were being clipped mid-word.

---

## Known gaps / not built

- No export or import of the tracked data — clearing browser storage loses everything.
- Resumes are held as data URLs in `localStorage`, so the practical ceiling is the ~5 MB origin quota, not the 2 MB per-file limit.
- No application-status field — there is nothing yet for `applied` / `interviewing` / `offer` / `rejected`.
- Deleting a company is immediate with no undo — only the `window.confirm` prompt guards it.
- No CI pipeline yet, though `npm test` runs the full suite locally.
- `react-router-dom` is on `BrowserRouter`, so a static host needs a rewrite rule for deep links to `/company/:id`.
- Several UI libraries ship in `dependencies` but are unused at runtime — Chakra, Grommet, PrimeReact, Phosphor, react-icons — and are worth pruning before a production build.

---

## Testing

- One consolidated suite in `src/App.test.jsx` — **133 tests, all passing**.
- Runner is Vitest with jsdom and Testing Library; config lives in `vitest.config.js`, setup in `src/setupTests.js`.
- Everything is driven through the rendered UI, so a passing test means a user could actually do that thing.
- Assertions mostly read `localStorage` back, since that is the app's source of truth.

### What it covers

- Adding a company by button and by Enter, and the box clearing afterwards.
- Duplicate names rejected case-insensitively, and empty/whitespace names rejected.
- The search icon and Add button both rendering.
- Live search filtering, the no-match message, and that searching never deletes anything.
- Deleting with the confirm accepted, with it cancelled, and that the bin never navigates into the card.
- The sample-data button appearing only on an empty tracker, and the data it loads.
- Status and Priority column headers, their values, and the dash shown when unset.
- The Job Links Tracker toggle hiding the table, bringing it back, and leaving the company cards visible while hidden.
- Dark mode starting light, switching both ways, persisting the choice, restoring a saved preference on load, and being reachable on an empty tracker.
- The sample-data panel staying closed until clicked, listing every feature, showing real sample values rather than placeholders, loading the data, closing after a load, and closing without loading from the close button.
- A sample row existing for all fourteen preset toggles.
- Exactly two card styles being offered, Compact being the default, and Detailed keeping the corner dots, preview chips and resume block that the old Featured style had.
- The not-found route for an unknown company id.
- One tab per custom field plus the fixed tabs, and switching to every one of them.
- Repeated tab switching, which is how the `AnimatePresence` wedge was caught.
- The removed Company Status, Quick Notes and per-panel note cards staying removed.
- Adding a link, both inputs clearing, invalid URLs rejected, bare domains prefixed, and removing a link.
- Resume upload: the file input being reachable rather than buried in a button, a real file being accepted and stored, the uploaded state with its download control, the 2 MB rejection, and the link count no longer hardcoded.
- Roles: legacy migration with and without a `Role` field, adding a role, rejecting a duplicate title, removing one, refusing to remove the last, a separate recruiter surviving per role, a toggle landing only on the selected role, one dashboard chip per role, and the `N roles` card badge.
- Sample data merging rather than replacing, not duplicating on a second load, refreshing stale samples saved in an older shape, never removing a company the user created, and shipping a two-role company with two different recruiters.
- Reordering roles: the chips being draggable, moving a role forward and backward, the strip repainting, a drop where it started writing nothing, each role's links/toggles/view staying attached through a move, Alt+Arrow moving a role, the first and last roles refusing to move out of bounds, the comparison columns following the new order, and the order surviving a reload.
- Per-role views: the three layouts being offered, Compact being the start, the sub-tabs disappearing in Detailed, toggles listed as rows in Table, the layout saving onto the role, two roles holding different layouts at once, the layout surviving a reload, editing a toggle from the Table layout, All roles appearing only with more than one role, the comparison putting both roles' values side by side, and picking a layout leaving comparison mode.
- Links and resume per role: legacy company-level links migrating onto the first role, only the selected role's links showing, a link landing on the selected role only, a resume attaching to one role and not the other, and the dashboard counting links across every role.
- Bulk add: the toggle being present, the form staying hidden until opened, one submit creating a company with links and toggles, bare domains being prefixed, filled toggles being written and untouched ones skipped, appending a role to an existing company, refusing a duplicate role, requiring a company name, the `Role` fallback for the title, closing after submit, and everything written showing up on the company page.
- Preset chips rendering, hiding presets already on the company, and adding one creating its tab.
- Adding a toggle by hand, the duplicate warning, and typed values persisting.
- Every field type — dropdowns for Status and Priority, date pickers for all three dates, email, url, two multi-line boxes, plain text for Referral, and the text fallback for an unknown name.
- Every Status dropdown option being offered, and choosing one persisting.
- Surviving a remount, recovering from corrupt stored JSON, and treating a missing `customFields` map as empty.

### Notes on the suite

- Two setup details were needed: the jsdom build here does not expose `localStorage`, so `setupTests.js` supplies a spec-compatible in-memory `Storage`; and the `QueryClient` uses `staleTime: Infinity`, so it was moved to `src/queryClient.js` and is cleared before each test — otherwise one test's data would be served to every later one.
- `mount()` waits for the query to settle before returning, because TanStack Query resolves asynchronously even though `loadCompanies()` is synchronous — without it, assertions race the first paint.
- Absence assertions first prove the containing element rendered, so they cannot pass vacuously against a blank page.
- `testTimeout` is raised to 20s: every test mounts the whole app, and the bulk-add cases fill fifteen controls, which sat close enough to Vitest's 5s default to time out intermittently on a loaded machine.
- Long text is entered with `paste` rather than per-character `type`, which raced the controlled re-render and produced interleaved text.
- Verified stable across eight consecutive full runs.

## Project layout

- `src/App.jsx` — the whole application: providers, both routes, and every component.
- `src/App.test.jsx` — the consolidated test suite.
- `src/setupTests.js` — test setup: jest-dom matchers, storage shim, per-test reset.
- `src/queryClient.js` — the shared TanStack QueryClient, in its own module so Fast Refresh keeps working.
- `vitest.config.js` — Vitest config, kept separate from the app build.
- `src/App.css` — the card and motion layer described above.
- `src/index.css` — Tailwind import, body reset, Inter font stack.
- `src/main.jsx` — React root.
- `tailwind.config.js` — Tailwind v4 config.
- `vite.config.js` — Vite config with the React and Tailwind plugins.
