/* global jQuery, mjml */
// Settings-page helper: paste a full <mjml> document, split it into the theme's
// Styles / Header / Footer fields at a [BLOCKS] placeholder, and render a sample
// preview. Purely an authoring aid — it only populates the existing form fields,
// which submit through the normal theme-save flow unchanged.
jQuery( function ( $ ) {

	// Only run on the theme editor form (not the themes list / export-import view).
	if ( ! $( '#mjml-eb-import-src' ).length ) return;

	var $styles = $( '#mjml-eb-styles' );
	var $header = $( '#mjml-eb-header' );
	var $footer = $( '#mjml-eb-footer' );
	var $msg    = $( '#mjml-eb-import-msg' );

	// A representative example of every block type, arranged into two sections so the
	// navbar shows multiple links and the whole theme is exercised. Each entry mirrors
	// how the editor's renderBlockToMjml emits that block type.
	var SAMPLE_BLOCKS = [

		// Welcome block (Text with the theme's `welcome` section class)
		'<mj-section css-class="welcome" padding="0"><mj-column>' +
			'<mj-text><p>Welcome! Sample welcome text so you can see how the theme styles introductory copy.</p></mj-text>' +
		'</mj-column></mj-section>',

		// Update block (highlight box with a link)
		'<mj-section><mj-column>' +
			'<mj-spacer height="10px" />' +
			'<mj-text mj-class="error_header" align="left"><p><strong>UPDATE:</strong> Sample correction notice with a <a href="#section-two" style="color:#FFFFFF">link</a>.</p></mj-text>' +
			'<mj-spacer height="20px" />' +
		'</mj-column></mj-section>',

		// Navbar (links to both sections) with a 15px spacer below it.
		'<mj-section><mj-column><mj-navbar base-url="">' +
			'<mj-navbar-link text-decoration="none"><strong>Also in this email:</strong></mj-navbar-link>' +
			'<mj-navbar-link href="#section-one">Welcome &amp; Updates</mj-navbar-link>' +
			'<mj-navbar-link href="#section-two">Shabbat &amp; Community</mj-navbar-link>' +
		'</mj-navbar></mj-column></mj-section>' +
		'<mj-section padding="0"><mj-column><mj-spacer height="15px"></mj-spacer></mj-column></mj-section>',

		// ══ Section one ══
		'<mj-section padding="0"><mj-column><mj-text mj-class="section_header">' +
			'<h3><!-- htmlmin:ignore --><a name="section-one"></a><!-- htmlmin:ignore -->Welcome &amp; Updates</h3>' +
		'</mj-text></mj-column></mj-section>',

		// Text paragraph with a link
		'<mj-section padding="0"><mj-column>' +
			'<mj-text><p>Sample paragraph text to preview body styling, including a <a href="https://example.com">sample link</a>.</p></mj-text>' +
		'</mj-column></mj-section>',

		// Button
		'<mj-section padding="10px 0"><mj-column>' +
			'<mj-button href="https://example.com" background-color="#0047B2">Sample Button</mj-button>' +
		'</mj-column></mj-section>',

		// Two-Col Images
		'<mj-section padding="0">' +
			'<mj-column><mj-image src="https://placehold.co/300x200?text=Left" href="https://example.com" /></mj-column>' +
			'<mj-column><mj-image src="https://placehold.co/300x200?text=Right" href="https://example.com" /></mj-column>' +
		'</mj-section>',

		// Feature (image + text/button)
		'<mj-section>' +
			'<mj-column>' +
				'<mj-text><h3>Sample Feature</h3><p>Short description of the group, with the date/time of the next meeting.</p></mj-text>' +
				'<mj-button href="https://example.com">Sign up to the Sample Feature</mj-button>' +
			'</mj-column>' +
			'<mj-column><mj-image src="https://placehold.co/300x200?text=Feature" /></mj-column>' +
		'</mj-section>',

		// Spacer
		'<mj-section padding="0"><mj-column><mj-spacer height="20px"></mj-spacer></mj-column></mj-section>',

		// Image (placed before the Shabbat & Community section)
		'<mj-section padding="0"><mj-column>' +
			'<mj-image src="https://placehold.co/600x200?text=Image+Block"></mj-image>' +
		'</mj-column></mj-section>',

		// ══ Section two ══
		'<mj-section padding="0"><mj-column><mj-text mj-class="section_header">' +
			'<h3><!-- htmlmin:ignore --><a name="section-two"></a><!-- htmlmin:ignore -->Shabbat &amp; Community</h3>' +
		'</mj-text></mj-column></mj-section>',

		// Shabbat Times
		'<mj-section><mj-column>' +
			'<mj-text padding-bottom="0"><h3>Parshat Sample<br /><span style="font-weight:normal">Subtitle</span></h3><p>1 - 2 May 2026<br />15 Iyar 5786</p></mj-text>' +
		'</mj-column><mj-column>' +
			'<mj-text><ul><li>Earliest Lighting <em>Plag HaMincha</em> 6.51pm</li><li><strong>Community Candle Lighting</strong> 7.30pm</li><li><strong>Shabbat Begins</strong> 8.09pm</li><li><strong>Shabbat Ends</strong> 9.19pm</li></ul><br /></mj-text>' +
		'</mj-column></mj-section>',

		// Service List
		'<mj-section><mj-column><mj-text padding-top="0" padding-bottom="0">' +
			'<h3>Friday Night</h3>' +
			'<ul><li><strong class="croxdale">Croxdale</strong> 7.00pm</li><li><strong class="yavneh">Yavneh</strong> 7.00pm</li></ul>' +
			'<br /></mj-text></mj-column></mj-section>',

		// Two-Col Services
		'<mj-section padding-top="0">' +
			'<mj-column><mj-text><h3 class="croxdale">Croxdale</h3><ul><li><strong>Hashkama</strong> 8.00am</li><li><strong>Shacharit</strong> 9.30am</li></ul></mj-text></mj-column>' +
			'<mj-column><mj-text><h3 class="yavneh">Yavneh</h3><ul><li><strong>Shacharit</strong> 9.15am</li></ul></mj-text></mj-column>' +
		'</mj-section>',

		// Notice List
		'<mj-section padding="0"><mj-column><mj-text padding-top="0" padding-bottom="0">' +
			'<p class="title">Mazal Tov to</p><ul><li><strong>Name</strong> on the simcha.</li></ul>' +
		'</mj-text></mj-column></mj-section>',

		// Yahrzeit List (two columns)
		'<mj-section><mj-column>' +
			'<mj-spacer height="10px" /><mj-text mj-class="small"> Person Name, Father Joe Bloggs<br /></mj-text><mj-spacer height="20px" />' +
		'</mj-column><mj-column>' +
			'<mj-spacer height="10px" /><mj-text mj-class="small"> Person Name, Mother Jane Bloggs<br /></mj-text><mj-spacer height="20px" />' +
		'</mj-column></mj-section>',

		// Raw MJML
		'<mj-section><mj-column><mj-text>Raw MJML block</mj-text></mj-column></mj-section>'

	].join( '\n' );

	function esc( str ) {
		return $( '<span>' ).text( str == null ? '' : String( str ) ).html();
	}

	function showMsg( lines, kind ) {
		if ( ! lines || ! lines.length ) { hideMsg(); return; }
		var items = lines.map( function ( l ) { return '<li>' + esc( l ) + '</li>'; } ).join( '' );
		$msg
			.attr( 'class', 'notice notice-' + ( kind || 'info' ) )
			.html( '<ul style="margin:0;padding-left:18px;list-style:disc">' + items + '</ul>' )
			.prop( 'hidden', false );
	}

	function hideMsg() {
		$msg.prop( 'hidden', true ).empty();
	}

	// Forgiving regex extraction (mirrors extractStyleCss in admin.js): MJML uses
	// custom tags, so a real XML/HTML parser is more trouble than it's worth here.
	function parseMjml( src ) {
		var warnings = [];

		var headM  = /<mj-head\b[^>]*>([\s\S]*?)<\/mj-head>/i.exec( src );
		var styles = headM ? headM[1].trim() : '';
		if ( ! headM ) warnings.push( 'No <mj-head> found — Global Styles left empty.' );

		var bodyM = /<mj-body\b([^>]*)>([\s\S]*?)<\/mj-body>/i.exec( src );
		if ( ! bodyM ) {
			warnings.push( 'No <mj-body> found — nothing was changed. Paste a full <mjml> document.' );
			return { ok: false, warnings: warnings };
		}

		var bodyAttrs = bodyM[1].trim();
		var bodyInner = bodyM[2];
		if ( bodyAttrs ) {
			warnings.push( 'Note: <mj-body> attributes (' + bodyAttrs + ') are not stored by themes and were dropped.' );
		}

		var hits = bodyInner.match( /\[BLOCKS\]/gi ) || [];
		var header, footer;
		if ( hits.length === 0 ) {
			warnings.push( 'No [BLOCKS] placeholder found — the whole body was used as the Header; Footer left empty.' );
			header = bodyInner.trim();
			footer = '';
		} else {
			if ( hits.length > 1 ) warnings.push( 'Multiple [BLOCKS] placeholders found — splitting at the first; the rest were removed.' );
			var idx = bodyInner.search( /\[BLOCKS\]/i );
			header = bodyInner.slice( 0, idx ).trim();
			// Strip every [BLOCKS] from the remainder so no literal placeholder survives.
			footer = bodyInner.slice( idx ).replace( /\[BLOCKS\]/gi, '' ).trim();
		}

		return { ok: true, styles: styles, header: header, footer: footer, warnings: warnings };
	}

	$( '#mjml-eb-split-btn' ).on( 'click', function () {
		var src = ( $( '#mjml-eb-import-src' ).val() || '' ).trim();
		if ( ! src ) { showMsg( [ 'Paste a full <mjml> document first.' ], 'error' ); return; }

		var parsed = parseMjml( src );
		if ( ! parsed.ok ) { showMsg( parsed.warnings, 'error' ); return; }

		// Splitting overwrites the three fields — confirm if any has existing content.
		var hasContent = ( $styles.val() || $header.val() || $footer.val() ).trim().length > 0;
		if ( hasContent && ! window.confirm( 'Replace the current Styles, Header and Footer fields with the split content?' ) ) {
			return;
		}

		$styles.val( parsed.styles );
		$header.val( parsed.header );
		$footer.val( parsed.footer );

		if ( parsed.warnings.length ) {
			showMsg( [ 'Fields updated.' ].concat( parsed.warnings ), 'warning' );
		} else {
			showMsg( [ 'Fields updated from the pasted MJML.' ], 'success' );
		}
	} );

	// Compile the current Styles/Header/Footer fields + the sample blocks and render
	// the result. `auto` suppresses error/empty messaging for the on-load run.
	function runPreview( auto ) {
		if ( typeof window.mjml !== 'function' ) {
			if ( ! auto ) showMsg( [ 'MJML library not loaded yet — try again in a moment.' ], 'error' );
			return;
		}

		var doc =
			'<mjml>\n  <mj-head>\n' + ( $styles.val() || '' ) + '\n  </mj-head>\n' +
			'  <mj-body>\n' +
			( $header.val() || '' ) + '\n' +
			SAMPLE_BLOCKS + '\n' +
			( $footer.val() || '' ) + '\n' +
			'  </mj-body>\n</mjml>';

		var result;
		try {
			result = window.mjml( doc, {
				validationLevel: 'soft',
				minify:          true,
				minifyOptions:   { collapseWhitespace: true, removeEmptyAttributes: true, minifyCSS: false },
			} );
		} catch ( err ) {
			if ( ! auto ) showMsg( [ err.message || String( err ) ], 'error' );
			return;
		}

		if ( result.errors && result.errors.length ) {
			showMsg( result.errors.map( function ( e ) {
				return e.formattedMessage || e.message || String( e );
			} ), 'warning' );
		} else if ( ! auto ) {
			hideMsg();
		}

		// Strip <script> tags: the sandboxed iframe blocks them anyway, and leaving
		// them in triggers a console "Blocked script execution" warning.
		var html = result.html.replace( /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '' );
		document.getElementById( 'mjml-eb-preview-frame' ).srcdoc = html;
		$( '#mjml-eb-preview-panel' ).prop( 'hidden', false );
	}

	$( '#mjml-eb-preview-btn' ).on( 'click', function () { runPreview( false ); } );

	// mjml-browser loads from a CDN in the footer, so window.mjml may not exist yet on
	// DOMReady. Poll briefly for it before the auto-preview gives up.
	function whenMjmlReady( cb, tries ) {
		if ( typeof window.mjml === 'function' ) { cb(); return; }
		if ( tries <= 0 ) return;
		setTimeout( function () { whenMjmlReady( cb, tries - 1 ); }, 200 );
	}

	// Existing theme = at least one saved field has content (a brand-new theme is empty).
	var hasExisting = ( ( $styles.val() || '' ) + ( $header.val() || '' ) + ( $footer.val() || '' ) ).trim().length > 0;

	// On load, seed the import box from an existing theme's saved fields — the inverse
	// of a split — so it can be viewed/edited as one document (with a [BLOCKS] marker
	// between header and footer) and re-split. New themes keep the placeholder.
	( function prefillImport() {
		var $src = $( '#mjml-eb-import-src' );
		if ( ( $src.val() || '' ).trim() ) return; // don't clobber anything already typed
		if ( ! hasExisting ) return;
		$src.val(
			'<mjml>\n  <mj-head>\n' + ( $styles.val() || '' ) + '\n  </mj-head>\n' +
			'  <mj-body>\n' + ( $header.val() || '' ) + '\n    [BLOCKS]\n' + ( $footer.val() || '' ) + '\n  </mj-body>\n</mjml>'
		);
	} )();

	// Auto-generate the preview for existing themes so opening one shows it straight away.
	if ( hasExisting ) {
		whenMjmlReady( function () { runPreview( true ); }, 25 ); // ~5s max wait
	}

} );
