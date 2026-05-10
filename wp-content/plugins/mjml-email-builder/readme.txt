=== MJML Email Builder ===
Contributors: moonty
Tags: mjml, email, templates, newsletter
Requires at least: 5.8
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 2.1.0
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
* **Live preview** — sticky preview panel renders the compiled HTML in a sandboxed iframe.
* **Section-aware navbar** — section headers can opt in to the navigation menu; an optional override sets a different label; the navbar lead-in text and spacers are configurable.
* **Author + archive** — list view shows the author and supports archiving emails to a separate Archived tab.
* **Export / Import** — JSON export bundles every theme plus the 10 most recently modified emails; import overrides themes and appends emails (5 MB upload cap).

= How it works =

1. Compose a template by adding blocks. Each block produces an `<mj-section>` (or equivalent) when compiled.
2. Click **Compile to HTML** (or wait for the auto-save) to render the full MJML document — themes wrap your blocks with their styles, header, and footer.
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

= 2.1.0 =
* New "Template" post status with a Templates tab — save any email as a template, then create new emails from it via "Use this template".
* Per-block "Clear content" button and a "Clear all content" topbar action that blank user content while keeping structure.
* Services × 2 block: drag rows to reorder within and across columns, plus a duplicate-row button.
* Service List footnote no longer wraps in a redundant `<p>`, removing extra blank lines in compiled HTML.

= 2.0.0 =
* First public release.
