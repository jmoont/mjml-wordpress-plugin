=== MJML Email Builder ===
Contributors: moonty
Tags: mjml, email, templates, newsletter
Requires at least: 5.8
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 2.4.23
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Build MJML email templates with a visual block editor and compile them to HTML in the browser. No API key. No external service.

== Description ==

MJML Email Builder is a self-contained WordPress admin plugin for composing responsive email templates with the [MJML](https://mjml.io/) framework.

Developed by **Josh Moont — BES Chair**.

Compilation happens entirely in your browser using `mjml-browser`, so the plugin works offline and never sends your content to a third-party API.

= Features =

* **Block builder** — drag-and-drop reorderable blocks: Navbar, Section Header, Text (WYSIWYG with Visual/Text tabs and a theme-class Formats dropdown), Image, Button, Divider, Spacer, Raw MJML, plus Shabbat-bulletin blocks (Shabbat Times, Service List, Two-Col Services, Notice List, Yahrzeit List).
* **Browser-side compile** — uses the bundled `mjml-browser` CDN library; no API key required.
* **Multiple themes** — bundle global styles, header, and footer into named themes; pick one per email or change the default. The active theme drives the WYSIWYG Format dropdown so its classes are one click away.
* **Auto-save with undo** — debounced 1.5 s auto-save with conflict-free retry, an `unload` beacon so changes survive a tab close, and an Undo button that walks back through the last 10 revisions (title, blocks, and theme).
* **Live preview** — sticky preview panel renders the compiled HTML in a sandboxed iframe, in a draggable split you can resize (the width is remembered), and it scrolls to the block you're editing on each re-render.
* **Section-aware navbar** — section headers can opt in to the navigation menu; an optional override sets a different label; the navbar lead-in text and spacers are configurable.
* **Author + archive** — list view shows the author and supports archiving emails to a separate Archived tab.
* **Export / Import** — JSON export bundles every theme plus the 10 most recently modified emails; import overrides themes and appends emails (5 MB upload cap).

= How it works =

1. Compose a template by adding blocks. Each block produces an `<mj-section>` (or equivalent) when compiled.
2. Click **Render Preview** (or wait for the auto-save) to render the full MJML document — themes wrap your blocks with their styles, header, and footer.
3. Click **Copy HTML** to grab the rendered HTML for use in your sending tool.

= Storage model =

* Email body blocks → `post_content` (JSON) on the `mjml_template` custom post type.
* Cached compiled HTML → post meta (`mjml_compiled_html`).
* Themes → `mjml_eb_themes` option (id-keyed array).
* Default theme → `mjml_eb_default_theme` option.
* Per-email theme assignment → `mjml_eb_theme` post meta.

== Installation ==

1. Upload the `mjml-email-builder` folder to `/wp-content/plugins/` (or install the .zip via **Plugins → Add New → Upload Plugin**).
2. Activate the plugin from the **Plugins** screen.
3. Visit **MJML Builder → Settings** to set up your default theme (global styles, header, footer).
4. Visit **MJML Builder → Emails** to create your first email.

== Frequently Asked Questions ==

= Does this need an MJML API key? =

No. The plugin loads `mjml-browser` from a public CDN and compiles everything client-side.

= Where are emails stored? =

Each email is a `mjml_template` custom post type entry. The block JSON lives in `post_content`; the compiled HTML is cached in post meta.

= Can I have different themes for different emails? =

Yes. Create as many themes as you like in **Settings**. Each email has a Theme dropdown in its top bar that overrides the default for that email only.

= Can I move my emails between sites? =

Use **Settings → Export** to download a JSON bundle containing your themes plus the 10 most recently modified emails. On the destination site, **Settings → Import** the JSON file: themes are replaced and emails are added (existing emails are not modified).

= Is the preview iframe sandboxed? =

Yes. The preview iframe runs with `sandbox="allow-same-origin"` only — scripts inside the email cannot execute. Email clients don't run scripts either, so this matches real-world behaviour.

== Changelog ==

= 2.4.23 =
* Two-Col Services: service lists can now be broken into sub-sections. Each column has a "+ Add sub-heading" button that inserts a heading row (text plus optional site colour); it closes the running list and starts a fresh one beneath it, so a column can read e.g. "Mincha & Ma'ariv" → Sunday times → "Mincha Only" → weekday times → "Ma'ariv Only" → weekday times. Sub-headings drag, duplicate, hide and delete like any other row, and "Clear content" keeps them since they are structure. The single-column Service List block gained the same button.
= 2.4.22 =
* Undo joins the floating bar, so it reads Undo · Render Preview · Copy HTML wherever you are in a long email. It drives the same action as the topbar button and greys out with it when there's nothing left to undo.
* The post-undo prompt ("Showing previous version — Render Preview or edit to save") now also appears as a toast, in amber, for seven seconds — previously it was only in the topbar status line, which you couldn't see if you'd undone while scrolled down.

= 2.4.21 =
* Fix: after an Undo, the status line still told you to click "Compile" — a button that no longer exists under that name. It now says "Showing previous version — Render Preview or edit to save", matching the renamed button.

= 2.4.20 =
* "Compile to HTML" is now called **Render Preview** (the status text says "Rendering…" to match) — it's what the button actually does, since the HTML is produced on every auto-save regardless.
* **Copy HTML** is now the primary (blue) button and sits last in the topbar, with Render Preview beside it in plain styling.
* Both buttons now float in a small bar at the top-right of the screen whenever the topbar is scrolled out of view, so you can render or copy from anywhere in a long email without scrolling back up. They drive exactly the same actions, and the floating Render Preview greys out alongside the topbar one while a render is in progress.
* Fix: copying silently did nothing if the browser's clipboard API rejected the write (an unfocused document or a denied permission). It now falls back to the older copy method and, if that fails too, says so in the status bar and toast.

= 2.4.19 =
* The save toast now tracks the whole save: it appears as "Saving…" with a spinner the moment a save starts, then turns into "All changes saved" in place when it finishes (and fades out a couple of seconds later), so you can see that a save is happening rather than only that it happened. A save in progress can't be clicked away; a completed save or an error can. Starting a new edit clears the toast, so what's on screen always reflects the current state.

= 2.4.18 =
* Save confirmations now appear as a toast in the bottom-right corner, so you can see that an edit saved without scrolling back up to the topbar status text. It fades out after a couple of seconds, or click it to dismiss. Errors use the same toast in red and stay for eight seconds, so a failed save or compile is no longer easy to miss on a long email.

= 2.4.17 =
* Fix: a failure while compiling could silently wedge auto-save for the rest of the session. jQuery skips the handler that clears the "saving" flag when an earlier callback throws, so one compile error left the editor stuck on "Unsaved changes", never saving again and giving no clue why. Compiling is now contained: the error is reported in the status bar (and logged to the browser console) and saving carries on.
* Fix: a missing preview iframe no longer takes compiling and saving down with it — the email still saves and caches, and the skipped preview is logged.

= 2.4.16 =
* Fix: the per-block preview markers added in 2.4.15 could corrupt a Raw MJML block's opening tag — a self-closing `<mj-section ... />` became `<mj-section ... / css-class="…">`, and a tag using single-quoted `css-class='…'` ended up with the attribute twice. Both now tag correctly, so Raw MJML blocks compile as before.
* Hardening: positioning the preview after a re-render can no longer interrupt compiling or auto-saving, and a stale scroll handler from an earlier compile is discarded instead of firing against the new render.

= 2.4.15 =
* Editor layout: the block builder and the preview are now a draggable split — drag the divider between them to trade width, double-click it to reset, or focus it and use the arrow keys. The width is remembered in your browser. The two columns also stay side by side much further down (they only stack below 900px wide, rather than 1480px).
* Editor topbar: "Copy HTML" has moved up from the preview panel header to sit next to "Compile to HTML", and the two secondary actions ("Copy MJML" and "Clear all content") now live behind an ellipsis (⋮) menu at the end of the row.
* Adding a block now inserts it directly after the block you were last working in (including when you were typing in a WYSIWYG), instead of after the last expanded block.
* The preview now scrolls to the block you're editing when it re-renders. Clicking "Compile to HTML" always re-centres that block; a background auto-save compile only scrolls when you've moved to a different block, so it never undoes your own scrolling mid-edit. The markers that make this work are stripped from the HTML you copy or that gets cached, so the output is unchanged.

= 2.4.14 =
* Image block: new optional "Width in pixels" field. Leave it blank for the existing full-width behaviour, or enter a pixel width to emit `width="…"` on the `<mj-image>`. The value is always normalised to px (`300`, `300px` and `300 px` all compile to `width="300px"`) because `mj-image` only handles pixel widths reliably; anything non-numeric is ignored. The block summary shows the width when one is set.

= 2.4.13 =
* Yahrzeits block: simple inline formatting in the names textarea — wrap text in `*asterisks*` for bold or `_underscores_` for italic (e.g. a `*Tuesday 23 June*` heading at the top of the list). Blank lines now insert an extra line break instead of being silently dropped, so you can group entries visually. Auto-split into two columns now counts non-blank lines so columns stay balanced when blanks are interspersed.

= 2.4.12 =
* Settings: new "Import full MJML" helper on the theme editor. Paste a complete `<mjml>` document and click "Split into fields" to auto-populate Global Styles (from `<mj-head>`), Header, and Footer. A literal `[BLOCKS]` placeholder inside `<mj-body>` marks where per-email content goes: everything before it becomes the Header, everything after becomes the Footer. When you open an existing theme, the import box is auto-filled with the reconstructed full document (header, `[BLOCKS]`, footer) so you can view/edit it whole and re-split, and the preview is generated automatically. The "Preview" renders the theme in a sandboxed iframe with sample blocks laid out across two sections — welcome, update, navbar, section headers, text, button, two-col images, feature, spacer, image, shabbat times, service lists, notices, yahrzeits and raw — so you can see the theme fully exercised without building an email. Note: `<mj-body>` attributes (e.g. background-color) aren't stored by themes and are dropped with a warning on split.

= 2.4.6 =
* Update block: link recolouring now reads the highlight style's own text colour from Settings (the `color` on the matching `<mj-class>`, e.g. error_header → #FFF) instead of always using white. This means custom highlight styles with a different text colour are supported — links match whatever the style defines. If a style sets no colour, links are left as-is.

= 2.4.5 =
* Update block: section links are no longer saved with a hard-coded white colour (which made them invisible in the WYSIWYG box, since the editor has a white background). Links now stay the normal link colour while editing and are recoloured white automatically at compile time, so they remain visible against the highlight background in the sent email. A manually coloured link is left untouched.

= 2.4.4 =
* New "Update" block — a simple WYSIWYG highlight box for call-out announcements (e.g. corrections to a previous email). Compiles to an `mj-text` styled with the `error_header` theme class (overridable per block) wrapped in 10px/20px spacers. Includes an "Insert link to section" picker: select some text, choose any Section Header block, and it drops in a white in-email anchor link (`<a href="#…">`).
* Section Header blocks now always emit their `<a name>` anchor (previously only when "Include in nav" was ticked), so any section can be targeted by an Update-block link or a manual `#anchor` link.

= 2.4.3 =
* Disabled the "Save as template" / "Use this template" feature. The Templates tab, the editor buttons, and the list row-actions are all removed — the feature was causing confusion and is superseded by the per-block hide toggle (added in 2.4.0). Existing template posts are left untouched in the database; only the UI entry points are gone.

= 2.4.2 =
* Vibes block: renamed the toolbar label from "Vibes" to "Feature" for a more generic name. (Internal block type unchanged, so existing templates are unaffected.)

= 2.4.1 =
* Service List and Two-Col Services: each service item now has its own eye-icon hide toggle. Hidden items stay in the editor (dimmed/striped) but are skipped when the block compiles, so you can park individual service rows without deleting them.

= 2.4.0 =
* New "Hide block" toggle (eye icon) in every block header. Hidden blocks stay in the editor (dimmed with diagonal stripes) but are excluded from the compiled MJML/HTML, the Copy MJML output, and the navbar (a hidden section_header won't show up in the nav links). Useful for stashing draft content without deleting it.

= 2.3.1 =
* Block lock: locking now also hides the drag handle (preventing reorder of that block) and the clear-content button. Unlock to access any of the destructive/move controls.

= 2.3.0 =
* Compile now produces minified HTML (collapsed whitespace, removed empty attributes). "Copy HTML" and the cached preview HTML both use the minified output, so the copied markup is significantly smaller. CSS inside `<style>` is left untouched to avoid email-client quirks.

= 2.2.9 =
* Fix: "Copy HTML" button now works on page load (when the preview iframe is showing the server-cached HTML). Previously it silently did nothing until you clicked Compile first. The JS clipboard variable is now seeded from the cached HTML at boot.

= 2.2.8 =
* Pin MJML browser compiler to v4.18.0 (was floating on the `@4` tag). Prevents surprise behavioural changes when a new 4.x patch ships on the CDN. Bump manually to test v5 when ready.

= 2.2.7 =
* Fix: emails with block content that contained HTML entities (e.g. `&quot;` from pasted Word/Outlook markup with `data-*` JSON attributes) would appear empty on reload. Root cause: `wp_localize_script()` runs `html_entity_decode()` on every scalar, which corrupted the embedded blocks JSON. Switched to `wp_add_inline_script()` so the JSON survives intact. Existing content is unaffected — the data was always saved correctly, just rendered as empty.
* Preview iframe: strip `<script>` tags from the compiled HTML before previewing (real email clients block JS anyway). Silences the "Blocked script execution in 'about:srcdoc'" console warning.

= 2.2.6 =
* Block lock: each block now has a padlock icon in its header. Click to lock the block; while locked, the trash icon is hidden so the block can't be accidentally deleted. Unlock to delete.

= 2.2.5 =
* WYSIWYG paste cleanup: pasting from Word, Google Docs, web pages, etc. now strips all styles, fonts, classes, and stray markup, keeping only basic formatting (bold, italic, underline, lists, links, paragraphs, line breaks).

= 2.2.4 =
* Image picker: the sidebar Size dropdown now defaults to "Full Size" instead of WordPress's global default (typically Medium).

= 2.2.3 =
* Vibes block: new "Show divider below this block" toggle (defaults to on) to suppress the trailing divider.
* New "Two-Col Images" block: two side-by-side images, each with its own optional link URL.

= 2.2.2 =
* Image picker: the WordPress media modal now shows the native Size dropdown (Thumbnail / Medium / Large / Full plus any custom registered sizes) so the chosen size's URL is inserted instead of always the original.

= 2.2.1 =
* Vibes block: image and button URLs now default to https://tinyurl.com/besvibesgroups; Name field starts blank.
* Vibes block: button text auto-fills to "Sign up to the [name]" when the Name field loses focus (only if button text is empty or still matches the auto pattern).
* Vibes block: new optional "Top image URL" field that renders a linkless image above the main image.

= 2.2.0 =
* New "Vibes" block: Name + image + WYSIWYG description + button in a two-column layout, with an "Image on the right" toggle that flips the image to the left (via `direction="rtl"`). Includes a trailing divider matching the bulletin's Vibes group pattern.

= 2.1.2 =
* Yahrzeit List: a line containing only `--` now forces the column split point, overriding the automatic halving.

= 2.1.1 =
* Maintenance release.

= 2.1.0 =
* New "Template" post status with a Templates tab — save any email as a template, then create new emails from it via "Use this template".
* Per-block "Clear content" button and a "Clear all content" topbar action that blank user content while keeping structure.
* Services × 2 block: drag rows to reorder within and across columns, plus a duplicate-row button.
* Service List footnote no longer wraps in a redundant `<p>`, removing extra blank lines in compiled HTML.

= 2.0.0 =
* First public release.
