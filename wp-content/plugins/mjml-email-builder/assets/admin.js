/* global jQuery, mjmlEb, mjml, wp */
jQuery( function ( $ ) {

	// ── State ────────────────────────────────────────────────────────────────
	var blocks = [];
	try { blocks = JSON.parse( mjmlEb.blocksJson || '[]' ); } catch(e) {}

	// ── Themes ───────────────────────────────────────────────────────────────
	var themes      = ( mjmlEb.themes && mjmlEb.themes.length ) ? mjmlEb.themes : [ { id: 'default', name: 'Default', styles: '', header: '', footer: '' } ];
	var activeTheme = themes.find( function(t) { return t.id === mjmlEb.activeTheme; } ) || themes[0];

	function populateThemeSelect() {
		var $sel = $( '#mjml-theme-select' );
		if ( ! $sel.length ) return;
		$sel.empty();
		themes.forEach( function(t) {
			$sel.append( $( '<option>' ).val( t.id ).text( t.name ) );
		} );
		$sel.val( activeTheme.id );
	}
	populateThemeSelect();

	$( '#mjml-theme-select' ).on( 'change', function() {
		var id = $( this ).val();
		var t  = themes.find( function(x) { return x.id === id; } );
		if ( ! t ) return;
		activeTheme = t;
		// Tear down + re-init any open editors (text + inline) so their Format
		// dropdown + content preview reflect the new theme's classes.
		syncAllEditors();
		Object.keys( expandedTextBlocks ).forEach( function( id ) {
			if ( typeof wp !== 'undefined' && wp.editor ) wp.editor.remove( 'mjml-text-' + id );
			setTimeout( function() { initTextEditor( id ); }, 50 );
		} );
		var openInlineIds = {};
		Object.keys( inlineWysiwygs ).forEach( function( editorId ) {
			openInlineIds[ inlineWysiwygs[ editorId ].blockId ] = true;
			removeInlineWysiwyg( editorId );
		} );
		Object.keys( openInlineIds ).forEach( function( bid ) {
			var b = blocks.find( function(x) { return x.id === bid; } );
			if ( b ) setTimeout( function() { initInlineEditorsForBlock( b ); }, 50 );
		} );
		injectThemeCssForMenu();
		markDirty();
	} );

	// Inject theme-class CSS into the parent doc on first load so the format
	// dropdown previews show colours from the start.
	if ( $( '#mjml-theme-select' ).length ) injectThemeCssForMenu();

	// TinyMCE doesn't add the format's class to the dropdown DOM, so our
	// `.mce-menu .{classname}` CSS has nothing to match. Watch for menus being
	// added and tag each .mce-menu-item with the matching theme class so the
	// previews actually colour-up.
	if ( typeof MutationObserver !== 'undefined' && $( '#mjml-theme-select' ).length ) {
		var themeClassNames = {};
		var refreshClassMap = function() {
			themeClassNames = {};
			parseThemeClasses( activeTheme.styles ).forEach( function( c ) { themeClassNames[ c.name ] = true; } );
		};
		refreshClassMap();
		$( '#mjml-theme-select' ).on( 'change', refreshClassMap );

		var tagMenuItems = function( menu ) {
			menu.querySelectorAll( '.mce-menu-item' ).forEach( function( item ) {
				var textEl = item.querySelector( '.mce-text' );
				if ( ! textEl ) return;
				var name = textEl.textContent.trim();
				if ( themeClassNames[ name ] && ! item.classList.contains( name ) ) {
					item.classList.add( name );
				}
			} );
		};

		new MutationObserver( function( mutations ) {
			mutations.forEach( function( mut ) {
				mut.addedNodes.forEach( function( node ) {
					if ( node.nodeType !== 1 ) return;
					if ( node.classList && node.classList.contains( 'mce-menu' ) ) {
						tagMenuItems( node );
					} else if ( node.querySelectorAll ) {
						node.querySelectorAll( '.mce-menu' ).forEach( tagMenuItems );
					}
				} );
			} );
		} ).observe( document.body, { childList: true, subtree: true } );
	}

	// ── Undo (revisions) ─────────────────────────────────────────────────────
	// `undoRevisions` is the cached newest-first list of revisions for this post.
	// `undoIndex` is which one we're currently viewing (-1 = current saved state).
	// Editing anything resets both — the next undo refetches.
	var undoRevisions = null;
	var undoIndex     = -1;
	var isUndoing     = false;

	function refreshUndoButton() {
		var $btn   = $( '#mjml-undo-btn' );
		var postId = $( '#mjml-post-id' ).val();
		if ( ! postId || postId === '0' ) { $btn.prop( 'disabled', true ); return; }
		// We only know the count after fetching once; until then assume we can try.
		var disabled = ( undoRevisions !== null && undoIndex >= undoRevisions.length - 1 );
		$btn.prop( 'disabled', disabled );
	}

	function fetchRevisions( cb ) {
		var postId = $( '#mjml-post-id' ).val();
		$.post( mjmlEb.ajaxUrl, {
			action:  'mjml_get_revisions',
			nonce:   mjmlEb.nonces.undo,
			post_id: postId,
		} ).done( function(r) {
			cb( r && r.success ? r.data.revisions : [] );
		} ).fail( function() { cb( [] ); } );
	}

	function applyRevisionData( data ) {
		isUndoing = true;
		// Cancel any pending auto-save so the undo doesn't race with an in-flight
		// save of the previous editor state.
		clearTimeout( autoSaveTimer );

		// Replace current state with the loaded revision.
		$( '#mjml-title' ).val( data.title );
		try { blocks = JSON.parse( data.blocks_json || '[]' ); } catch(e) { blocks = []; }
		migrateBlocks( blocks );
		if ( data.theme_id ) {
			var t = themes.find( function(x) { return x.id === data.theme_id; } );
			if ( t ) { activeTheme = t; $( '#mjml-theme-select' ).val( t.id ); }
		}
		renderAll();
		// Don't markDirty — undo navigation shouldn't auto-save (each save would
		// burn a revision slot and prune the oldest, capping you at ~5 useful
		// undoes). Editor state is replaced, but we leave isDirty=false. Click
		// Compile to commit the rolled-back state, or just keep typing — the
		// next user edit will fire markDirty and the auto-save will persist
		// the undone-then-edited state.
		isUndoing = false;
		isDirty   = false;
		refreshUndoButton();
	}

	function loadRevision( revId ) {
		setStatus( 'Loading…', 'saving' );
		$.post( mjmlEb.ajaxUrl, {
			action: 'mjml_load_revision',
			nonce:  mjmlEb.nonces.undo,
			rev_id: revId,
		} ).done( function(r) {
			if ( r && r.success ) {
				applyRevisionData( r.data );
				setStatus( 'Showing previous version — Compile or edit to save', 'unsaved' );
			} else {
				setStatus( 'Could not load revision', 'error' );
			}
		} ).fail( function() { setStatus( 'Could not load revision', 'error' ); } );
	}

	// Enable the button on page load if we already have a saved post.
	refreshUndoButton();

	$( '#mjml-undo-btn' ).on( 'click', function( e ) {
		e.preventDefault();
		var attempt = function() {
			if ( ! undoRevisions || ! undoRevisions.length ) return;
			var nextIdx = undoIndex + 1;
			if ( nextIdx >= undoRevisions.length ) return;
			undoIndex = nextIdx;
			loadRevision( undoRevisions[ nextIdx ].id );
		};
		if ( undoRevisions === null ) {
			fetchRevisions( function( list ) {
				undoRevisions = list;
				attempt();
				refreshUndoButton();
			} );
		} else {
			attempt();
		}
	} );

	// Run on every loaded blocks array (page load and revision restore) so old
	// data picks up new fields and renamed types without manual intervention.
	function migrateBlocks( arr ) {
		arr.forEach( function(b) {
			if ( b.type === 'html' ) b.type = 'text';
			if ( b.type === 'section_header' ) {
				if ( b.padding_top === undefined )    b.padding_top    = '20px';
				if ( b.padding_bottom === undefined ) b.padding_bottom = '20px';
			}
			if ( b.type === 'navbar' ) {
				if ( b.label === undefined )          b.label          = 'Also in this email:';
				if ( b.padding_top === undefined )    b.padding_top    = '10px';
				if ( b.padding_bottom === undefined ) b.padding_bottom = '10px';
			}
			// notice_list moved from textarea (items_text) to WYSIWYG (content).
			if ( b.type === 'notice_list' && b.content === undefined ) {
				var lines = ( b.items_text || '' ).split( /\n/ )
					.map( function(l) { return l.trim(); } )
					.filter( function(l) { return l.length; } );
				b.content = lines.length
					? '<ul>' + lines.map( function(l) { return '<li>' + l + '</li>'; } ).join( '' ) + '</ul>'
					: '';
				delete b.items_text;
			}
		} );
	}
	migrateBlocks( blocks );

	var nextId = 1;
	blocks.forEach( function(b) {
		var num = parseInt( (b.id || '').replace( /\D/g, '' ), 10 );
		if ( num >= nextId ) nextId = num + 1;
	} );

	function makeId() { return 'b' + ( nextId++ ); }

	// ── Theme-styles parsing (drives the TinyMCE Format dropdown + content preview) ─
	function extractStyleCss( stylesMjml ) {
		// Pull the inner CSS out of every <mj-style ...> ... </mj-style> tag.
		var out  = '';
		var re   = /<mj-style[^>]*>([\s\S]*?)<\/mj-style>/gi;
		var m;
		while ( ( m = re.exec( stylesMjml || '' ) ) !== null ) out += '\n' + m[1];
		return out;
	}

	function parseThemeClasses( stylesMjml ) {
		var css     = extractStyleCss( stylesMjml );
		var classes = {}; // name -> {decls: 'a:b;c:d;'}
		// Strip CSS comments.
		css = css.replace( /\/\*[\s\S]*?\*\//g, '' );
		// Walk each rule block.
		var ruleRe = /([^{}]+)\{([^{}]*)\}/g;
		var rule;
		while ( ( rule = ruleRe.exec( css ) ) !== null ) {
			var selectors = rule[1].split( ',' );
			var body      = rule[2].trim().replace( /\s+/g, ' ' );
			selectors.forEach( function( sel ) {
				var classRe = /\.([A-Za-z_][\w-]*)/g;
				var cm;
				while ( ( cm = classRe.exec( sel ) ) !== null ) {
					var name = cm[1];
					if ( ! classes[ name ] ) classes[ name ] = '';
					classes[ name ] += body + ( body && body.slice( -1 ) !== ';' ? ';' : '' );
				}
			} );
		}
		// Convert to TinyMCE style_formats entries.
		return Object.keys( classes ).sort().map( function( name ) {
			return { name: name, declarations: classes[ name ] };
		} );
	}

	function declsToObject( decls ) {
		var out = {};
		( decls || '' ).split( ';' ).forEach( function( d ) {
			var i = d.indexOf( ':' );
			if ( i < 1 ) return;
			var prop = d.slice( 0, i ).trim();
			var val  = d.slice( i + 1 ).trim().replace( /\s*!important$/, '' );
			if ( prop && val ) out[ prop ] = val;
		} );
		return out;
	}

	// Properties that count as "text formatting" — a class has to declare at least
	// one of these to qualify for the WYSIWYG dropdown. Keeps layout-only helpers
	// like `.welcome` (padding/margin) from cluttering the format list.
	var TEXT_FORMAT_PROPS = [ 'color', 'font-size', 'font-weight', 'font-style', 'font-family', 'text-decoration', 'background', 'background-color' ];

	function isTextFormattingClass( declarations ) {
		var d = ( declarations || '' ).toLowerCase();
		return TEXT_FORMAT_PROPS.some( function( prop ) {
			return new RegExp( '(?:^|;|\\s)' + prop + '\\s*:' ).test( d );
		} );
	}

	function buildStyleFormats() {
		return parseThemeClasses( activeTheme.styles )
			.filter( function( c ) { return isTextFormattingClass( c.declarations ); } )
			.map( function( c ) {
				return {
					title:    c.name,
					// `selector` makes TinyMCE add the class to an existing matching element
					// inside the selection (so a <strong> stays a <strong>) instead of always
					// wrapping in a new <span>. If nothing matches, `inline` is the fallback.
					selector: 'span,strong,em,b,i,u,a,p,h1,h2,h3,h4,h5,h6,li,div',
					inline:   'span',
					classes:  c.name,
					// No `styles:` — applying the class is enough; the visual styling comes
					// from the theme CSS injected via `content_style`. Including styles here
					// would add a redundant `style="..."` attribute on every applied element.
				};
			} );
	}

	function buildContentStyle() {
		// Inject the theme's CSS into the editor iframe so the user sees what classes look like.
		return extractStyleCss( activeTheme.styles );
	}

	function injectThemeCssForMenu() {
		// The TinyMCE Format dropdown items live in the parent document, so
		// content_style (which only loads inside the iframe) doesn't colour them.
		// Mirror per-class declarations into the parent doc, scoped under
		// .mce-menu so they only colour dropdown items (a MutationObserver tags
		// each item with its corresponding theme class so these rules match).
		var rules = parseThemeClasses( activeTheme.styles ).map( function( c ) {
			return '.mce-menu .' + c.name + ' { ' + c.declarations + ' }';
		} );
		var styleEl = document.getElementById( 'mjml-eb-menu-style' );
		if ( ! styleEl ) {
			styleEl = document.createElement( 'style' );
			styleEl.id = 'mjml-eb-menu-style';
			document.head.appendChild( styleEl );
		}
		styleEl.textContent = rules.join( '\n' );
	}

	// ── TinyMCE helpers ──────────────────────────────────────────────────────
	var expandedTextBlocks = {}; // { blockId: true } — tracks which text blocks have open editors

	function initTextEditor( blockId ) {
		var editorId = 'mjml-text-' + blockId;
		if ( ! document.getElementById( editorId ) ) return;
		if ( typeof wp === 'undefined' || typeof wp.editor === 'undefined' ) return;
		if ( typeof tinymce !== 'undefined' && tinymce.get( editorId ) ) return;

		var styleFormats = buildStyleFormats();

		wp.editor.initialize( editorId, {
			tinymce: {
				toolbar1:           'bold italic underline | styleselect | alignleft aligncenter alignright | link | bullist numlist | removeformat',
				plugins:            'lists,link',
				menubar:            false,
				statusbar:          false,
				height:             250,
				style_formats_merge: false,
				style_formats:      styleFormats.length ? styleFormats : [ { title: '— No theme classes defined —', inline: 'span', classes: '' } ],
				content_style:      buildContentStyle(),
				setup: function( editor ) {
					editor.on( 'change input keyup NodeChange', function() {
						var block = blocks.find( function(b) { return b.id === blockId; } );
						if ( block ) block.content = editor.getContent();
						markDirty();
					} );
				},
			},
			quicktags:    true,
			mediaButtons: false,
		} );
	}

	function removeTextEditor( blockId ) {
		var editorId = 'mjml-text-' + blockId;
		if ( typeof wp !== 'undefined' && wp.editor ) {
			wp.editor.remove( editorId );
		}
		delete expandedTextBlocks[ blockId ];
	}

	function syncAllTextEditors() {
		blocks.forEach( function(b) {
			if ( b.type !== 'text' ) return;
			var ed = typeof tinymce !== 'undefined' ? tinymce.get( 'mjml-text-' + b.id ) : null;
			if ( ed && ! ed.isHidden() ) {
				b.content = ed.getContent();
			} else {
				var $ta = $( '#mjml-text-' + b.id );
				if ( $ta.length ) b.content = $ta.val();
			}
		} );
	}

	// ── Inline WYSIWYG editors (e.g. service_list intro/footnote) ────────────
	// Each one is a small TinyMCE bound to a specific {blockId, fieldKey}.
	var inlineWysiwygs = {}; // editorId -> {blockId, fieldKey}

	function inlineEditorId( blockId, fieldKey ) {
		return 'mjml-wysiwyg-' + blockId + '-' + fieldKey;
	}

	function initInlineWysiwyg( blockId, fieldKey ) {
		var editorId = inlineEditorId( blockId, fieldKey );
		if ( ! document.getElementById( editorId ) ) return;
		if ( typeof wp === 'undefined' || typeof wp.editor === 'undefined' ) return;
		if ( typeof tinymce !== 'undefined' && tinymce.get( editorId ) ) return;

		inlineWysiwygs[ editorId ] = { blockId: blockId, fieldKey: fieldKey };

		var styleFormats = buildStyleFormats();

		wp.editor.initialize( editorId, {
			tinymce: {
				toolbar1:           'bold italic underline | styleselect | link | bullist numlist | removeformat',
				plugins:            'lists,link',
				menubar:            false,
				statusbar:          false,
				height:             140,
				style_formats_merge: false,
				style_formats:      styleFormats.length ? styleFormats : [ { title: '— No theme classes defined —', inline: 'span', classes: '' } ],
				content_style:      buildContentStyle(),
				setup: function( editor ) {
					editor.on( 'change input keyup NodeChange', function() {
						var block = blocks.find( function(b) { return b.id === blockId; } );
						if ( block ) block[ fieldKey ] = editor.getContent();
						markDirty();
					} );
				},
			},
			quicktags:    true,
			mediaButtons: false,
		} );
	}

	function removeInlineWysiwyg( editorId ) {
		if ( typeof wp !== 'undefined' && wp.editor ) wp.editor.remove( editorId );
		delete inlineWysiwygs[ editorId ];
	}

	function removeInlineWysiwygsForBlock( blockId ) {
		Object.keys( inlineWysiwygs ).forEach( function( editorId ) {
			if ( inlineWysiwygs[ editorId ].blockId === blockId ) removeInlineWysiwyg( editorId );
		} );
	}

	function syncAllInlineWysiwygs() {
		Object.keys( inlineWysiwygs ).forEach( function( editorId ) {
			var info  = inlineWysiwygs[ editorId ];
			var block = blocks.find( function(b) { return b.id === info.blockId; } );
			if ( ! block ) return;
			var ed = typeof tinymce !== 'undefined' ? tinymce.get( editorId ) : null;
			if ( ed && ! ed.isHidden() ) {
				block[ info.fieldKey ] = ed.getContent();
			} else {
				var $ta = $( '#' + editorId );
				if ( $ta.length ) block[ info.fieldKey ] = $ta.val();
			}
		} );
	}

	function inlineEditorFieldsFor( block ) {
		if ( ! block ) return [];
		if ( block.type === 'service_list' )     return [ 'intro', 'footnote' ];
		if ( block.type === 'service_list_two' ) return [ 'intro' ];
		if ( block.type === 'notice_list' )      return [ 'content' ];
		return [];
	}

	function initInlineEditorsForBlock( block ) {
		inlineEditorFieldsFor( block ).forEach( function( field ) {
			initInlineWysiwyg( block.id, field );
		} );
	}

	function blockHasInlineEditors( block ) {
		return inlineEditorFieldsFor( block ).length > 0;
	}

	// Sync every WYSIWYG (text-block + inline) back to the blocks array.
	function syncAllEditors() {
		syncAllTextEditors();
		syncAllInlineWysiwygs();
	}

	// ── Auto-save ────────────────────────────────────────────────────────────
	var autoSaveTimer = null;
	var isSaving      = false;
	var isDirty       = false;
	var pendingSave   = false;

	function markDirty() {
		isDirty = true;
		// A fresh edit invalidates the undo chain so the next click refetches the
		// up-to-date revisions list. While we're applying an undo we set
		// isUndoing=true so this side-effect is skipped.
		if ( ! isUndoing ) {
			undoRevisions = null;
			undoIndex     = -1;
		}
		clearTimeout( autoSaveTimer );
		setStatus( mjmlEb.i18n.unsaved, 'unsaved' );
		autoSaveTimer = setTimeout( doSave, 1500 );
	}

	function doSave( onDone ) {
		syncAllEditors();
		if ( isSaving ) {
			pendingSave = true;
			return;
		}
		var $titleInput = $( '#mjml-title' );
		var title = $titleInput.val().trim();
		if ( ! title ) {
			// Auto-fill so a new post always gets persisted; user can rename later.
			title = 'Untitled email';
			$titleInput.val( title );
		}

		isSaving = true;
		isDirty  = false; // capture current state — re-flagged below if save fails or new edits arrive
		setStatus( mjmlEb.i18n.saving, 'saving' );

		$.post( mjmlEb.ajaxUrl, {
			action:   'mjml_save_template',
			nonce:    mjmlEb.nonces.save,
			title:    title,
			blocks:   JSON.stringify( blocks ),
			post_id:  $( '#mjml-post-id' ).val(),
			theme_id: activeTheme.id,
		} )
		.done( function( resp ) {
			if ( resp.success ) {
				if ( ! isDirty ) setStatus( mjmlEb.i18n.saved, 'saved' );
				$( '#mjml-post-id' ).val( resp.data.post_id );
				if ( window.history && window.history.replaceState ) {
					window.history.replaceState( {}, '', resp.data.edit_url );
				}
				doCompile( true );
				refreshUndoButton();
				if ( typeof onDone === 'function' ) onDone();
			} else {
				isDirty = true;
				setStatus( mjmlEb.i18n.error + resp.data.message, 'error' );
			}
		} )
		.fail( function() {
			isDirty = true;
			setStatus( mjmlEb.i18n.error + 'Request failed.', 'error' );
		} )
		.always( function() {
			isSaving = false;
			// If new edits arrived during the request (or this one failed), save again
			if ( pendingSave || isDirty ) {
				pendingSave = false;
				doSave( onDone );
			}
		} );
	}

	// Warn before navigating away with unsaved changes — and flush via sendBeacon
	// so the data still hits the server even if the user clicks "Leave" or the
	// in-flight XHR gets aborted by the navigation.
	window.addEventListener( 'beforeunload', function( e ) {
		if ( ! ( isDirty || isSaving || pendingSave ) ) return;

		if ( navigator.sendBeacon ) {
			syncAllEditors();
			var title = ( $( '#mjml-title' ).val() || '' ).trim() || 'Untitled email';
			var data  = new FormData();
			data.append( 'action',   'mjml_save_template' );
			data.append( 'nonce',    mjmlEb.nonces.save );
			data.append( 'title',    title );
			data.append( 'blocks',   JSON.stringify( blocks ) );
			data.append( 'post_id',  $( '#mjml-post-id' ).val() );
			data.append( 'theme_id', activeTheme.id );
			navigator.sendBeacon( mjmlEb.ajaxUrl, data );
		}

		e.preventDefault();
		e.returnValue = '';
		return '';
	} );

	function setStatus( msg, state ) {
		var $s = $( '#mjml-status' );
		$s.text( msg ).attr( 'data-state', state || '' );
	}

	// Title changes trigger auto-save
	$( '#mjml-title' ).on( 'input', markDirty );

	// ── Block defaults ───────────────────────────────────────────────────────
	var DEFAULTS = {
		navbar:         function() { return { type: 'navbar', id: makeId(), label: 'Also in this email:', padding_top: '10px', padding_bottom: '10px' }; },
		section_header: function() { return { type: 'section_header', id: makeId(), title: 'Section Title', anchor_id: 'section-title', include_in_nav: true, padding_top: '20px', padding_bottom: '20px' }; },
		text:           function() { return { type: 'text', id: makeId(), content: '<p>Your content here.</p>', css_class: '' }; },
		image:          function() { return { type: 'image', id: makeId(), src: '', href: '' }; },
		button:         function() { return { type: 'button', id: makeId(), text: 'Click Here', href: '#', background_color: '#0047B2' }; },
		divider:        function() { return { type: 'divider', id: makeId(), border_color: '#12142F' }; },
		spacer:         function() { return { type: 'spacer', id: makeId(), height: '20px' }; },
		raw:            function() { return { type: 'raw', id: makeId(), mjml: '<mj-section><mj-column><mj-text>Raw MJML here</mj-text></mj-column></mj-section>' }; },

		shabbat_times: function() { return {
			type: 'shabbat_times', id: makeId(),
			parsha: 'Shabbat Name', subtitle: '', dates: '1 - 2 May 2026', hebrew_date: '15 Iyar 5786',
			times: [
				{ label: 'Earliest Lighting', detail: 'Plag HaMincha', time: '6.51pm', bold: false },
				{ label: 'Community Candle Lighting', detail: '', time: '7.30pm', bold: true },
				{ label: 'Shabbat Begins', detail: '', time: '8.09pm', bold: true },
				{ label: 'Shabbat Ends', detail: '', time: '9.19pm', bold: true },
			],
		}; },

		service_list: function() { return {
			type: 'service_list', id: makeId(),
			title: 'Friday Night',
			intro: '', footnote: '',
			items: [
				{ label: 'Croxdale', color: 'croxdale', time: '7.00pm', notes: '' },
				{ label: 'Yavneh',   color: 'yavneh',   time: '7.00pm', notes: '' },
			],
		}; },

		service_list_two: function() { return {
			type: 'service_list_two', id: makeId(),
			title: '', intro: '',
			left:  { title: 'Croxdale', title_color: 'croxdale', items: [
				{ label: 'Hashkama', color: '', time: '8.00am', notes: '' },
				{ label: 'Shacharit', color: '', time: '9.30am', notes: '' },
			] },
			right: { title: 'Yavneh', title_color: 'yavneh', items: [
				{ label: 'Shacharit', color: '', time: '9.15am', notes: '' },
			] },
		}; },

		notice_list: function() { return {
			type: 'notice_list', id: makeId(),
			title: 'Mazal Tov to',
			content: '<ul><li><strong>Name</strong> on the simcha.</li></ul>',
		}; },

		yahrzeit_list: function() { return {
			type: 'yahrzeit_list', id: makeId(),
			items_text: 'Person Name, Father Joe Bloggs\nPerson Name, Mother Jane Bloggs',
		}; },
	};

	var LABELS = {
		navbar: 'Navbar', section_header: 'Section Header', text: 'Text',
		image: 'Image', button: 'Button', divider: 'Divider', spacer: 'Spacer', raw: 'Raw MJML',
		shabbat_times: 'Shabbat Times', service_list: 'Service List',
		service_list_two: 'Services × 2', notice_list: 'Notice List', yahrzeit_list: 'Yahrzeits',
	};

	function slugify( str ) {
		return str.toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' );
	}

	// ── Block rendering ──────────────────────────────────────────────────────
	function renderBlock( block ) {
		var label   = LABELS[ block.type ] || block.type;
		var summary = blockSummary( block );

		var $row = $( '<div class="mjml-block-row" data-id="' + block.id + '"></div>' );

		var clearBtn = blockHasClearableContent( block.type )
			? '<button class="mjml-clear-block-content button-link" title="Clear this block\'s content (keep structure)"><span class="dashicons dashicons-editor-removeformatting"></span></button>'
			: '';

		var $header = $(
			'<div class="mjml-block-header">' +
				'<span class="mjml-drag-handle dashicons dashicons-move" title="Drag to reorder"></span>' +
				'<span class="mjml-block-badge mjml-type-' + block.type + '">' + label + '</span>' +
				'<span class="mjml-block-summary"></span>' +
				'<button class="mjml-block-toggle button-link" aria-label="Toggle"><span class="dashicons dashicons-arrow-down-alt2"></span></button>' +
				clearBtn +
				'<button class="mjml-delete-block button-link" title="Delete block"><span class="dashicons dashicons-trash"></span></button>' +
			'</div>'
		);
		$header.find( '.mjml-block-summary' ).text( summary );

		if ( block.type === 'image' ) {
			$header.find( '.mjml-block-summary' ).after(
				'<button class="mjml-image-info button-link" type="button" aria-label="Preview image">' +
					'<span class="dashicons dashicons-visibility"></span>' +
					'<span class="mjml-image-thumb"><img alt=""></span>' +
				'</button>'
			);
		}

		$row.append( $header );

		var $fields = $( '<div class="mjml-block-fields"></div>' ).hide();
		$fields.append( buildFields( block ) );
		$row.append( $fields );

		return $row;
	}

	// Block types whose content can be blanked while keeping their structure.
	function blockHasClearableContent( type ) {
		return type !== 'navbar' && type !== 'divider' && type !== 'spacer';
	}

	// Wipe user-authored content from a block while preserving its structural
	// fields (column counts, colours, titles that act as labels). Used by the
	// per-block clear button and the "Clear all content" topbar action.
	function clearBlockContent( block ) {
		switch ( block.type ) {
			case 'section_header':
				block.title = '';
				block.anchor_id = '';
				return;
			case 'text':
				block.content = '<p></p>';
				return;
			case 'image':
				block.src = '';
				block.href = '';
				return;
			case 'button':
				block.text = '';
				return;
			case 'raw':
				block.mjml = '';
				return;
			case 'shabbat_times':
				block.parsha = '';
				block.subtitle = '';
				block.dates = '';
				block.hebrew_date = '';
				( block.times || [] ).forEach( function( row ) { row.time = ''; } );
				return;
			case 'service_list':
				block.intro = '';
				block.footnote = '';
				( block.items || [] ).forEach( function( item ) {
					item.time = '';
					item.notes = '';
				} );
				return;
			case 'service_list_two':
				block.intro = '';
				[ 'left', 'right' ].forEach( function( side ) {
					if ( ! block[ side ] ) return;
					( block[ side ].items || [] ).forEach( function( item ) {
						item.time = '';
						item.notes = '';
					} );
				} );
				return;
			case 'notice_list':
				block.content = '<ul><li></li></ul>';
				return;
			case 'yahrzeit_list':
				block.items_text = '';
				return;
		}
	}

	function blockSummary( block ) {
		switch ( block.type ) {
			case 'navbar':           return '(auto-generated from section headers)';
			case 'section_header':   return block.title;
			case 'text':             return $( '<div>' ).html( block.content ).text().substring( 0, 80 ) + '…';
			case 'image':            return block.src || '(no image set)';
			case 'button':           return block.text;
			case 'divider':          return 'border: ' + block.border_color;
			case 'spacer':           return 'height: ' + block.height;
			case 'raw':              return '(raw MJML)';
			case 'shabbat_times':    return block.parsha + ' · ' + block.dates;
			case 'service_list':     return block.title + ' (' + ( block.items || [] ).length + ' items)';
			case 'service_list_two': return ( block.title ? block.title + ' — ' : '' ) + ( block.left.title || '?' ) + ' / ' + ( block.right.title || '?' );
			case 'notice_list':      return block.title + ' — ' + $( '<div>' ).html( block.content || '' ).text().substring( 0, 60 ) + '…';
			case 'yahrzeit_list':    return ( block.items_text || '' ).split( /\n/ ).filter( function(l) { return l.trim(); } ).length + ' yahrzeits';
		}
		return '';
	}

	function field( label, $input ) {
		var $p = $( '<p class="mjml-field-row"></p>' );
		var $label = $( '<label></label>' ).append( '<span class="mjml-field-label">' + label + '</span>' ).append( $input );
		return $p.append( $label );
	}

	function textInput( key, val, placeholder ) {
		return $( '<input type="text" class="regular-text mjml-field">' )
			.attr( { 'data-key': key, placeholder: placeholder || '' } ).val( val || '' );
	}

	function colorInput( key, val ) {
		return $( '<input type="color" class="mjml-field">' ).attr( 'data-key', key ).val( val || '#000000' );
	}

	function areaInput( key, val, rows ) {
		return $( '<textarea class="large-text code mjml-field"></textarea>' )
			.attr( { 'data-key': key, rows: rows || 5 } ).val( val || '' );
	}

	function inlineWysiwygField( label, blockId, fieldKey, value ) {
		var $row = $( '<div class="mjml-field-row mjml-inline-wysiwyg-row"></div>' );
		$row.append( '<span class="mjml-field-label">' + label + '</span>' );
		$row.append( $( '<textarea class="mjml-inline-wysiwyg"></textarea>' )
			.attr( 'id', inlineEditorId( blockId, fieldKey ) )
			.val( value || '' ) );
		return $row;
	}

	function buildFields( block ) {
		var $f = $( '<div></div>' );

		switch ( block.type ) {
			case 'navbar':
				$f.append( '<p class="mjml-field-note">The navbar links are automatically built from Section Header blocks with "Include in nav" checked.</p>' );
				$f.append( field( 'Lead-in label', textInput( 'label', block.label, 'e.g. Also in this email:' ) ) );
				$f.append( field( 'Spacer above (0 to remove)', textInput( 'padding_top', block.padding_top, '10px' ) ) );
				$f.append( field( 'Spacer below (0 to remove)', textInput( 'padding_bottom', block.padding_bottom, '10px' ) ) );
				$f.append( '<div class="mjml-navbar-preview"></div>' );
				updateNavbarPreview( $f );
				break;

			case 'section_header':
				$f.append( field( 'Title', textInput( 'title', block.title ) ) );
				$f.append( field( 'Spacer above (0 to remove)', textInput( 'padding_top', block.padding_top, '20px' ) ) );
				$f.append( field( 'Spacer below (0 to remove)', textInput( 'padding_bottom', block.padding_bottom, '20px' ) ) );
				$f.append( $( '<p class="mjml-field-row"></p>' ).append(
					$( '<label class="mjml-checkbox-label"></label>' ).append(
						$( '<input type="checkbox" class="mjml-field">' )
							.attr( 'data-key', 'include_in_nav' )
							.prop( 'checked', block.include_in_nav )
					).append( ' Include in navigation menu' )
				) );
				$f.append(
					field( 'Navigation label (optional)', textInput( 'nav_label', block.nav_label, 'Defaults to title' ) )
						.addClass( 'mjml-nav-label-row' )
						.toggle( !! block.include_in_nav )
				);
				break;

			case 'text':
				$f.append( $( '<textarea class="mjml-text-editor"></textarea>' )
					.attr( 'id', 'mjml-text-' + block.id )
					.val( block.content || '' ) );
				$f.append( field( 'Section CSS class (optional)', textInput( 'css_class', block.css_class, 'e.g. welcome' ) ) );
				break;

			case 'image':
				var $srcWrap = $( '<p class="mjml-field-row"></p>' );
				var $srcLabel = $( '<label></label>' ).append( '<span class="mjml-field-label">Image URL</span>' );
				var $srcInput = $( '<input type="text" class="regular-text mjml-field">' )
					.attr( { 'data-key': 'src' } ).val( block.src || '' );
				var $pickBtn = $( '<button class="button mjml-media-pick" type="button">Choose Image</button>' );
				$srcLabel.append( $srcInput ).append( ' ' ).append( $pickBtn );
				$srcWrap.append( $srcLabel );
				$f.append( $srcWrap );
				$f.append( field( 'Link URL', textInput( 'href', block.href ) ) );
				break;

			case 'button':
				$f.append( field( 'Button text', textInput( 'text', block.text ) ) );
				$f.append( field( 'Link URL', textInput( 'href', block.href ) ) );
				$f.append( field( 'Background colour', colorInput( 'background_color', block.background_color ) ) );
				break;

			case 'divider':
				$f.append( field( 'Border colour', colorInput( 'border_color', block.border_color ) ) );
				break;

			case 'spacer':
				$f.append( field( 'Height', textInput( 'height', block.height, '20px' ) ) );
				break;

			case 'raw':
				$f.append( field( 'Raw MJML (<mj-section> level)', areaInput( 'mjml', block.mjml, 8 ) ) );
				break;

			case 'shabbat_times':
				$f.append( field( 'Parsha / heading', textInput( 'parsha', block.parsha ) ) );
				$f.append( field( 'Subtitle (optional)', textInput( 'subtitle', block.subtitle ) ) );
				$f.append( field( 'Dates (secular)', textInput( 'dates', block.dates ) ) );
				$f.append( field( 'Hebrew date',     textInput( 'hebrew_date', block.hebrew_date ) ) );
				$f.append( buildShabbatTimesEditor( block ) );
				break;

			case 'service_list':
				$f.append( field( 'Title', textInput( 'title', block.title ) ) );
				$f.append( inlineWysiwygField( 'Intro (optional)', block.id, 'intro', block.intro ) );
				$f.append( buildServiceItemsEditor( block, 'items' ) );
				$f.append( inlineWysiwygField( 'Footnote (optional)', block.id, 'footnote', block.footnote ) );
				break;

			case 'service_list_two':
				$f.append( field( 'Title (optional)', textInput( 'title', block.title ) ) );
				$f.append( inlineWysiwygField( 'Intro (optional)', block.id, 'intro', block.intro ) );
				$f.append( buildTwoColServicesEditor( block ) );
				break;

			case 'notice_list':
				$f.append( field( 'Title (e.g. Mazal Tov to)', textInput( 'title', block.title ) ) );
				$f.append( inlineWysiwygField( 'Content', block.id, 'content', block.content ) );
				break;

			case 'yahrzeit_list':
				$f.append( field( 'Names (one per line — auto-split into two columns)', areaInput( 'items_text', block.items_text, 12 ) ) );
				break;
		}

		return $f;
	}

	// ── Repeating-item editors ───────────────────────────────────────────────
	var SITE_COLORS = [
		{ value: '',         label: '— none —' },
		{ value: 'bes',      label: 'BES (navy)' },
		{ value: 'yavneh',   label: 'Yavneh (teal)' },
		{ value: 'croxdale', label: 'Croxdale (purple)' },
		{ value: 'youth',    label: 'Youth (green)' },
		{ value: 'kids',     label: 'Kids (red)' },
		{ value: 'women',    label: 'Women (orange)' },
	];

	function colorSelect( val ) {
		var $sel = $( '<select class="mjml-svc-color"></select>' );
		SITE_COLORS.forEach( function(c) {
			$sel.append( $( '<option>' ).val( c.value ).text( c.label ).prop( 'selected', c.value === ( val || '' ) ) );
		} );
		return $sel;
	}

	function buildShabbatTimesEditor( block ) {
		var $wrap = $( '<div class="mjml-repeat" data-key="times"></div>' );
		$wrap.append( '<p class="mjml-field-label">Times</p>' );
		var $list = $( '<div class="mjml-repeat-list"></div>' );
		( block.times || [] ).forEach( function(t, i) {
			var $row = $( '<div class="mjml-repeat-row"></div>' ).attr( 'data-index', i );
			$row.append( $( '<input type="text" class="mjml-svc-label" placeholder="Label">' ).val( t.label || '' ) );
			$row.append( $( '<input type="text" class="mjml-svc-detail" placeholder="Detail (italic)">' ).val( t.detail || '' ) );
			$row.append( $( '<input type="text" class="mjml-svc-time" placeholder="Time">' ).val( t.time || '' ) );
			$row.append( $( '<label class="mjml-svc-bold-label"><input type="checkbox" class="mjml-svc-bold"> Bold</label>' ).find( 'input' ).prop( 'checked', !! t.bold ).end() );
			$row.append( $( '<button type="button" class="button-link mjml-svc-del" title="Remove">×</button>' ) );
			$list.append( $row );
		} );
		$wrap.append( $list );
		$wrap.append( '<button type="button" class="button mjml-svc-add">+ Add time</button>' );
		return $wrap;
	}

	function buildServiceItemsEditor( block, key ) {
		var $wrap = $( '<div class="mjml-repeat" data-key="' + key + '"></div>' );
		$wrap.append( '<p class="mjml-field-label">Service items</p>' );
		var $list = $( '<div class="mjml-repeat-list"></div>' );
		( block[ key ] || [] ).forEach( function(item, i) {
			var $row = $( '<div class="mjml-repeat-row"></div>' ).attr( 'data-index', i );
			$row.append( $( '<input type="text" class="mjml-svc-label" placeholder="Label (bold)">' ).val( item.label || '' ) );
			$row.append( colorSelect( item.color ) );
			$row.append( $( '<input type="text" class="mjml-svc-time" placeholder="Time">' ).val( item.time || '' ) );
			$row.append( $( '<input type="text" class="mjml-svc-notes" placeholder="Notes (after time)">' ).val( item.notes || '' ) );
			$row.append( $( '<button type="button" class="button-link mjml-svc-del" title="Remove">×</button>' ) );
			$list.append( $row );
		} );
		$wrap.append( $list );
		$wrap.append( '<button type="button" class="button mjml-svc-add">+ Add service</button>' );
		return $wrap;
	}

	function buildTwoColServicesEditor( block ) {
		var $wrap = $( '<div class="mjml-twocol-svc"></div>' );
		[ 'left', 'right' ].forEach( function(side) {
			var col = block[ side ] || ( block[ side ] = { title: '', title_color: '', items: [] } );
			var $col = $( '<div class="mjml-twocol-side"></div>' ).attr( 'data-side', side );
			$col.append( '<h4>' + ( side === 'left' ? 'Left column' : 'Right column' ) + '</h4>' );
			var $titleRow = $( '<div class="mjml-twocol-title-row"></div>' );
			$titleRow.append( $( '<input type="text" class="mjml-twocol-title" placeholder="Site/column title">' ).val( col.title || '' ) );
			$titleRow.append( colorSelect( col.title_color ).addClass( 'mjml-twocol-color' ) );
			$col.append( $titleRow );
			var $list = $( '<div class="mjml-repeat-list mjml-twocol-list"></div>' ).attr( 'data-side', side );
			( col.items || [] ).forEach( function(item, i) {
				// data-orig-side stamps the source column so a cross-column drag
				// can still locate the original item in block[side].items.
				var $row = $( '<div class="mjml-repeat-row"></div>' )
					.attr( 'data-index', i )
					.attr( 'data-orig-side', side );
				$row.append( '<span class="mjml-svc-drag dashicons dashicons-move" title="Drag to reorder or move between columns"></span>' );
				$row.append( $( '<input type="text" class="mjml-svc-label" placeholder="Label (bold)">' ).val( item.label || '' ) );
				$row.append( colorSelect( item.color ) );
				$row.append( $( '<input type="text" class="mjml-svc-time" placeholder="Time">' ).val( item.time || '' ) );
				$row.append( $( '<input type="text" class="mjml-svc-notes" placeholder="Notes">' ).val( item.notes || '' ) );
				$row.append( $( '<button type="button" class="button-link mjml-svc-dup" title="Duplicate"><span class="dashicons dashicons-admin-page"></span></button>' ) );
				$row.append( $( '<button type="button" class="button-link mjml-svc-del" title="Remove">×</button>' ) );
				$list.append( $row );
			} );
			$col.append( $list );
			$col.append( '<button type="button" class="button mjml-svc-add">+ Add service</button>' );
			$wrap.append( $col );
		} );
		return $wrap;
	}

	// jQuery UI sortable needs the element in the DOM, so call this after the
	// fields container is inserted/rebuilt. The two columns are connected so
	// items can be dragged across; on drop we re-derive both arrays from the DOM.
	function initTwoColSortables( blockId ) {
		var $row = $( '#mjml-blocks-list .mjml-block-row[data-id="' + blockId + '"]' );
		var block = blocks.find( function(b) { return b.id === blockId; } );
		if ( ! block || block.type !== 'service_list_two' ) return;

		// Scope connectWith to this block's lists so other service_list_two
		// blocks on the page don't accept drops from each other.
		var connectSelector = '.mjml-block-row[data-id="' + blockId + '"] .mjml-twocol-list';
		var rebuildScheduled = false;

		function syncFromDom() {
			// Coalesce update + receive into a single rebuild per drop.
			if ( rebuildScheduled ) return;
			rebuildScheduled = true;
			setTimeout( function() {
				rebuildScheduled = false;
				var newSides = { left: [], right: [] };
				$row.find( '.mjml-twocol-list' ).each( function() {
					var destSide = $( this ).attr( 'data-side' );
					$( this ).find( '> .mjml-repeat-row' ).each( function() {
						var origSide = $( this ).attr( 'data-orig-side' );
						var origIdx  = parseInt( $( this ).attr( 'data-index' ), 10 );
						var src      = block[ origSide ] && block[ origSide ].items;
						if ( src && src[ origIdx ] ) newSides[ destSide ].push( src[ origIdx ] );
					} );
				} );
				block.left.items  = newSides.left;
				block.right.items = newSides.right;
				rebuildBlockFields( block );
				markDirty();
			}, 0 );
		}

		$row.find( '.mjml-twocol-list' ).each( function() {
			var $list = $( this );
			if ( $list.data( 'ui-sortable' ) ) $list.sortable( 'destroy' );
			$list.sortable( {
				handle:               '.mjml-svc-drag',
				connectWith:          connectSelector,
				items:                '> .mjml-repeat-row',
				placeholder:          'mjml-sortable-placeholder',
				forcePlaceholderSize: true,
				tolerance:            'pointer',
				update:               syncFromDom,
			} );
		} );
	}

	function updateNavbarPreview( $container ) {
		var navHeaders = blocks.filter( function(b) { return b.type === 'section_header' && b.include_in_nav; } );
		var $preview   = $container.find( '.mjml-navbar-preview' );
		if ( ! $preview.length ) return;
		if ( ! navHeaders.length ) {
			$preview.html( '<em>No section headers marked for nav yet.</em>' );
		} else {
			$preview.html( '<strong>Nav preview:</strong> ' + navHeaders.map( function(b) {
				var label = ( b.nav_label && b.nav_label.length ) ? b.nav_label : b.title;
				return '<a href="#' + escAttr( b.anchor_id ) + '">' + $('<span>').text(label).html() + '</a>';
			} ).join( ' &nbsp;|&nbsp; ' ) );
		}
	}

	function escAttr( str ) {
		return $( '<span>' ).text( str || '' ).html().replace( /"/g, '&quot;' );
	}

	// ── Render all blocks ────────────────────────────────────────────────────
	function renderAll() {
		// Snapshot which inline-editor blocks were currently expanded so we can
		// re-open them after the DOM rebuild.
		var openInline = {};
		$( '#mjml-blocks-list .mjml-block-row' ).each( function() {
			var $row = $( this );
			if ( ! $row.find( '> .mjml-block-fields' ).is( ':visible' ) ) return;
			var b = blocks.find( function(x) { return x.id === $row.data( 'id' ); } );
			if ( b && blockHasInlineEditors( b ) ) openInline[ b.id ] = true;
		} );

		// Sync and tear down any active TinyMCE instances before clearing the DOM
		syncAllEditors();
		blocks.forEach( function(b) {
			if ( b.type === 'text' ) removeTextEditor( b.id );
			if ( blockHasInlineEditors( b ) ) removeInlineWysiwygsForBlock( b.id );
		} );

		var $list  = $( '#mjml-blocks-list' ).empty();
		var $empty = $( '#mjml-blocks-empty' );

		if ( ! blocks.length ) { $empty.show(); return; }
		$empty.hide();

		blocks.forEach( function(b) {
			$list.append( renderBlock(b) );
			if ( b.type === 'service_list_two' ) initTwoColSortables( b.id );
		} );

		// (Re-)initialise sortable
		if ( $list.data( 'ui-sortable' ) ) $list.sortable( 'destroy' );
		$list.sortable( {
			handle:      '.mjml-drag-handle',
			axis:        'y',
			placeholder: 'mjml-sortable-placeholder',
			forcePlaceholderSize: true,
			stop: function() {
				var newOrder = [];
				$list.find( '.mjml-block-row' ).each( function() {
					var id = $( this ).data( 'id' );
					var b  = blocks.find( function(x) { return x.id === id; } );
					if ( b ) newOrder.push( b );
				} );
				blocks = newOrder;
				markDirty();
			},
		} );

		// Re-open editors for text blocks that were expanded before renderAll
		blocks.forEach( function(b) {
			if ( b.type === 'text' && expandedTextBlocks[ b.id ] ) {
				var $row = $list.find( '[data-id="' + b.id + '"]' );
				$row.find( '.mjml-block-fields' ).show();
				$row.find( '.mjml-block-toggle .dashicons' )
					.removeClass( 'dashicons-arrow-down-alt2' ).addClass( 'dashicons-arrow-up-alt2' );
				initTextEditor( b.id );
			}
			if ( openInline[ b.id ] ) {
				var $row2 = $list.find( '[data-id="' + b.id + '"]' );
				$row2.find( '.mjml-block-fields' ).show();
				$row2.find( '.mjml-block-toggle .dashicons' )
					.removeClass( 'dashicons-arrow-down-alt2' ).addClass( 'dashicons-arrow-up-alt2' );
				initInlineEditorsForBlock( b );
			}
		} );
	}

	renderAll();

	// ── Block list interactions ──────────────────────────────────────────────
	$( '#mjml-blocks-list' )

		.on( 'click', '.mjml-block-toggle', function( e ) {
			e.stopPropagation();
			var $row    = $( this ).closest( '.mjml-block-row' );
			var blockId = $row.data( 'id' );
			var $fields = $row.find( '.mjml-block-fields' );
			var $icon   = $( this ).find( '.dashicons' );
			var opening = ! $fields.is( ':visible' );

			$fields.slideToggle( 150, function() {
				var visible = $fields.is( ':visible' );
				$icon.toggleClass( 'dashicons-arrow-up-alt2',   visible )
				     .toggleClass( 'dashicons-arrow-down-alt2', ! visible );
			} );

			var block = blocks.find( function(b) { return b.id === blockId; } );
			if ( block && block.type === 'text' ) {
				if ( opening ) {
					expandedTextBlocks[ blockId ] = true;
					// Slight delay so the textarea is visible before TinyMCE measures it
					setTimeout( function() { initTextEditor( blockId ); }, 200 );
				} else {
					var ed = typeof tinymce !== 'undefined' ? tinymce.get( 'mjml-text-' + blockId ) : null;
					if ( ed && ! ed.isHidden() ) {
						block.content = ed.getContent();
					} else {
						var $ta = $row.find( '#mjml-text-' + blockId );
						if ( $ta.length ) block.content = $ta.val();
					}
					delete expandedTextBlocks[ blockId ];
				}
			}
			if ( block && blockHasInlineEditors( block ) ) {
				if ( opening ) {
					setTimeout( function() { initInlineEditorsForBlock( block ); }, 200 );
				} else {
					syncAllInlineWysiwygs();
				}
			}
		} )

		.on( 'click', '.mjml-block-header', function( e ) {
			if ( $( e.target ).closest( 'button' ).length ) return;
			$( this ).find( '.mjml-block-toggle' ).trigger( 'click' );
		} )

		.on( 'change input', '.mjml-field', function() {
			var $row  = $( this ).closest( '.mjml-block-row' );
			var id    = $row.data( 'id' );
			var block = blocks.find( function(b) { return b.id === id; } );
			if ( ! block ) return;

			var key = $( this ).data( 'key' );
			var val = $( this ).is( ':checkbox' ) ? $( this ).is( ':checked' ) : $( this ).val();
			block[ key ] = val;

			if ( block.type === 'section_header' && key === 'title' ) {
				block.anchor_id = slugify( val );
			}

			if ( block.type === 'section_header' && key === 'include_in_nav' ) {
				$row.find( '.mjml-nav-label-row' ).toggle( !! val );
			}

			$row.find( '.mjml-block-summary' ).text( blockSummary( block ) );

			$( '.mjml-navbar-preview' ).each( function() {
				updateNavbarPreview( $( this ).closest( '.mjml-block-fields' ) );
			} );

			markDirty();
		} )

		.on( 'click', '.mjml-delete-block', function( e ) {
			e.stopPropagation();
			var id    = $( this ).closest( '.mjml-block-row' ).data( 'id' );
			var block = blocks.find( function(b) { return b.id === id; } );
			if ( block && block.type === 'text' )       removeTextEditor( id );
			if ( block && blockHasInlineEditors( block ) ) removeInlineWysiwygsForBlock( id );
			blocks = blocks.filter( function(b) { return b.id !== id; } );
			renderAll();
			markDirty();
		} )

		.on( 'click', '.mjml-clear-block-content', function( e ) {
			e.stopPropagation();
			var id    = $( this ).closest( '.mjml-block-row' ).data( 'id' );
			var block = blocks.find( function(b) { return b.id === id; } );
			if ( ! block ) return;
			// Tear down editors before mutating so they don't write stale content back.
			if ( block.type === 'text' )                 removeTextEditor( id );
			if ( blockHasInlineEditors( block ) )        removeInlineWysiwygsForBlock( id );
			clearBlockContent( block );
			renderAll();
			markDirty();
		} )

		.on( 'input', '.mjml-text-editor', function() {
			var $row  = $( this ).closest( '.mjml-block-row' );
			var id    = $row.data( 'id' );
			var block = blocks.find( function(b) { return b.id === id; } );
			if ( ! block ) return;
			var ed = typeof tinymce !== 'undefined' ? tinymce.get( 'mjml-text-' + id ) : null;
			if ( ed && ! ed.isHidden() ) return; // Visual mode — TinyMCE setup handler updates state
			block.content = $( this ).val();
			markDirty();
		} )

		.on( 'input', '.mjml-inline-wysiwyg', function() {
			// Mirror of the text-block handler: catch typing in QuickTags (Text) mode.
			var editorId = this.id;
			var info     = inlineWysiwygs[ editorId ];
			if ( ! info ) return;
			var ed = typeof tinymce !== 'undefined' ? tinymce.get( editorId ) : null;
			if ( ed && ! ed.isHidden() ) return; // Visual mode — TinyMCE setup handler updates state
			var block = blocks.find( function(b) { return b.id === info.blockId; } );
			if ( block ) block[ info.fieldKey ] = $( this ).val();
			markDirty();
		} )

		.on( 'click', '.mjml-media-pick', function( e ) {
			e.preventDefault();
			var $input = $( this ).siblings( 'input[data-key="src"]' );
			var frame  = wp.media( { title: 'Choose Image', button: { text: 'Use this image' }, multiple: false } );
			frame.on( 'select', function() {
				var att = frame.state().get( 'selection' ).first().toJSON();
				$input.val( att.url ).trigger( 'change' );
			} );
			frame.open();
		} )

		.on( 'mouseenter', '.mjml-image-info', function() {
			var $row  = $( this ).closest( '.mjml-block-row' );
			var id    = $row.data( 'id' );
			var block = blocks.find( function(b) { return b.id === id; } );
			if ( ! block || ! block.src ) return;
			var $thumb = $( this ).find( '.mjml-image-thumb' );
			$thumb.find( 'img' ).attr( 'src', block.src );
			$thumb.addClass( 'is-visible' );
		} )

		.on( 'mouseleave', '.mjml-image-info', function() {
			$( this ).find( '.mjml-image-thumb' ).removeClass( 'is-visible' );
		} )

		.on( 'click', '.mjml-image-info', function( e ) {
			e.preventDefault();
			e.stopPropagation();
		} )

		// ── Repeating-item editors (shabbat times, service lists) ────────────
		.on( 'input change', '.mjml-repeat-row input, .mjml-repeat-row select', function() {
			var $row   = $( this ).closest( '.mjml-block-row' );
			var block  = blocks.find( function(b) { return b.id === $row.data( 'id' ); } );
			if ( ! block ) return;
			var $entry = $( this ).closest( '.mjml-repeat-row' );
			var index  = parseInt( $entry.attr( 'data-index' ), 10 );
			var key    = $entry.closest( '.mjml-repeat' ).data( 'key' );
			var arr    = key ? block[ key ] : null;
			// Two-col services have items inside left/right
			if ( ! arr ) {
				var side = $entry.closest( '.mjml-twocol-side' ).data( 'side' );
				if ( side && block[ side ] ) arr = block[ side ].items;
			}
			if ( ! arr || ! arr[ index ] ) return;
			var item = arr[ index ];
			item.label  = $entry.find( '.mjml-svc-label'  ).val();
			item.detail = $entry.find( '.mjml-svc-detail' ).val();
			item.time   = $entry.find( '.mjml-svc-time'   ).val();
			item.notes  = $entry.find( '.mjml-svc-notes'  ).val();
			item.color  = $entry.find( '.mjml-svc-color'  ).val();
			if ( $entry.find( '.mjml-svc-bold' ).length ) {
				item.bold = $entry.find( '.mjml-svc-bold' ).is( ':checked' );
			}
			$row.find( '.mjml-block-summary' ).text( blockSummary( block ) );
			markDirty();
		} )

		.on( 'input', '.mjml-twocol-title, .mjml-twocol-color', function() {
			var $row  = $( this ).closest( '.mjml-block-row' );
			var block = blocks.find( function(b) { return b.id === $row.data( 'id' ); } );
			if ( ! block ) return;
			var side = $( this ).closest( '.mjml-twocol-side' ).data( 'side' );
			if ( ! block[ side ] ) return;
			if ( $( this ).hasClass( 'mjml-twocol-title' ) ) block[ side ].title = $( this ).val();
			else block[ side ].title_color = $( this ).val();
			$row.find( '.mjml-block-summary' ).text( blockSummary( block ) );
			markDirty();
		} )

		.on( 'click', '.mjml-svc-add', function( e ) {
			e.preventDefault();
			var $row  = $( this ).closest( '.mjml-block-row' );
			var block = blocks.find( function(b) { return b.id === $row.data( 'id' ); } );
			if ( ! block ) return;
			var side = $( this ).closest( '.mjml-twocol-side' ).data( 'side' );
			if ( side && block[ side ] ) {
				block[ side ].items.push( { label: '', color: '', time: '', notes: '' } );
			} else {
				var key = $( this ).closest( '.mjml-repeat' ).data( 'key' );
				if ( key === 'times' ) {
					block.times.push( { label: '', detail: '', time: '', bold: false } );
				} else {
					block[ key ].push( { label: '', color: '', time: '', notes: '' } );
				}
			}
			rebuildBlockFields( block );
			markDirty();
		} )

		.on( 'click', '.mjml-svc-del', function( e ) {
			e.preventDefault();
			var $row   = $( this ).closest( '.mjml-block-row' );
			var block  = blocks.find( function(b) { return b.id === $row.data( 'id' ); } );
			if ( ! block ) return;
			var $entry = $( this ).closest( '.mjml-repeat-row' );
			var index  = parseInt( $entry.attr( 'data-index' ), 10 );
			var side   = $entry.closest( '.mjml-twocol-side' ).data( 'side' );
			var key    = $entry.closest( '.mjml-repeat' ).data( 'key' );
			var arr    = side && block[ side ] ? block[ side ].items : block[ key ];
			if ( arr ) arr.splice( index, 1 );
			rebuildBlockFields( block );
			markDirty();
		} )

		.on( 'click', '.mjml-svc-dup', function( e ) {
			e.preventDefault();
			var $row   = $( this ).closest( '.mjml-block-row' );
			var block  = blocks.find( function(b) { return b.id === $row.data( 'id' ); } );
			if ( ! block ) return;
			var $entry = $( this ).closest( '.mjml-repeat-row' );
			var index  = parseInt( $entry.attr( 'data-index' ), 10 );
			var side   = $entry.closest( '.mjml-twocol-side' ).data( 'side' );
			if ( ! side || ! block[ side ] ) return;
			var arr = block[ side ].items;
			if ( ! arr || ! arr[ index ] ) return;
			arr.splice( index + 1, 0, JSON.parse( JSON.stringify( arr[ index ] ) ) );
			rebuildBlockFields( block );
			markDirty();
		} );

	// Re-render just the fields area for one block (used when repeating items change shape).
	function rebuildBlockFields( block ) {
		var $row    = $( '#mjml-blocks-list .mjml-block-row[data-id="' + block.id + '"]' );
		var $fields = $row.find( '.mjml-block-fields' );
		var wasOpen = $fields.is( ':visible' );
		$fields.empty().append( buildFields( block ) );
		if ( wasOpen ) $fields.show();
		$row.find( '.mjml-block-summary' ).text( blockSummary( block ) );
		if ( block.type === 'service_list_two' ) initTwoColSortables( block.id );
	}

	// ── Add block ────────────────────────────────────────────────────────────
	$( '.mjml-add-block' ).on( 'click', function() {
		var type = $( this ).data( 'type' );
		if ( ! DEFAULTS[ type ] ) return;

		var newBlock = DEFAULTS[ type ]();

		// If a block is currently expanded, insert the new block right after it
		var $expanded   = $( '#mjml-blocks-list .mjml-block-row' ).filter( function() {
			return $( this ).find( '> .mjml-block-fields' ).is( ':visible' );
		} ).last();
		var insertAfter = $expanded.length ? $expanded.data( 'id' ) : null;

		if ( insertAfter ) {
			var idx = blocks.findIndex( function(b) { return b.id === insertAfter; } );
			if ( idx >= 0 ) blocks.splice( idx + 1, 0, newBlock );
			else            blocks.push( newBlock );
		} else {
			blocks.push( newBlock );
		}

		renderAll();
		var $row = $( '#mjml-blocks-list .mjml-block-row[data-id="' + newBlock.id + '"]' );
		if ( $row.length ) {
			$row.find( '.mjml-block-fields' ).show();
			$row.find( '.mjml-block-toggle .dashicons' )
				.removeClass( 'dashicons-arrow-down-alt2' ).addClass( 'dashicons-arrow-up-alt2' );
			if ( newBlock.type === 'text' ) {
				expandedTextBlocks[ newBlock.id ] = true;
				setTimeout( function() { initTextEditor( newBlock.id ); }, 200 );
			}
			if ( blockHasInlineEditors( newBlock ) ) {
				setTimeout( function() { initInlineEditorsForBlock( newBlock ); }, 200 );
			}
			$row[0].scrollIntoView( { behavior: 'smooth', block: 'nearest' } );
		}
		markDirty();
	} );

	// Holds the last compiled HTML for copying
	var lastCompiledHtml = '';

	// ── Compile ──────────────────────────────────────────────────────────────
	function doCompile( silent ) {
		syncAllEditors();
		if ( typeof window.mjml !== 'function' ) {
			if ( ! silent ) setStatus( 'MJML library not loaded yet.', 'error' );
			return;
		}
		if ( ! silent ) setStatus( mjmlEb.i18n.converting, 'saving' );
		$( '#mjml-convert-btn' ).prop( 'disabled', true );

		var bodySections = blocks.map( renderBlockToMjml ).join( '\n' );
		var mjmlDoc =
			'<mjml>\n  <mj-head>\n' + ( activeTheme.styles || '' ) + '\n  </mj-head>\n' +
			'  <mj-body>\n' +
			( activeTheme.header || '' ) + '\n' +
			bodySections + '\n' +
			( activeTheme.footer || '' ) + '\n' +
			'  </mj-body>\n</mjml>';

		var result;
		try {
			result = window.mjml( mjmlDoc, { validationLevel: 'soft' } );
		} catch ( err ) {
			setStatus( mjmlEb.i18n.error + err.message, 'error' );
			$( '#mjml-convert-btn' ).prop( 'disabled', false );
			return;
		}

		var $warn = $( '#mjml-warnings' );
		if ( result.errors && result.errors.length ) {
			console.warn( 'MJML warnings:\n' + result.errors.map( function(e) { return e.formattedMessage; } ).join('\n') );
			var items = result.errors.map( function(e) {
				return '<li>' + esc( e.formattedMessage || e.message || String(e) ) + '</li>';
			} ).join( '' );
			$warn.html(
				'<strong>MJML compile warnings (' + result.errors.length + '):</strong>' +
				'<ul>' + items + '</ul>'
			).prop( 'hidden', false );
		} else {
			$warn.empty().prop( 'hidden', true );
		}

		if ( ! silent ) setStatus( mjmlEb.i18n.saved, 'saved' );
		lastCompiledHtml = result.html;

		document.getElementById( 'mjml-preview-frame' ).srcdoc = result.html;
		$( '#mjml-output-panel' ).show();
		$( '#mjml-convert-btn' ).prop( 'disabled', false );

		var postId = $( '#mjml-post-id' ).val();
		if ( postId && postId !== '0' ) {
			$.post( mjmlEb.ajaxUrl, {
				action:  'mjml_cache_html',
				nonce:   mjmlEb.nonces.cache,
				post_id: postId,
				html:    result.html,
			} );
		}
	}

	$( '#mjml-convert-btn' ).on( 'click', function() {
		clearTimeout( autoSaveTimer );
		doSave();
	} );

	// ── Clear all content (editor topbar) ────────────────────────────────────
	$( '#mjml-clear-all-btn' ).on( 'click', function() {
		if ( ! blocks.length ) return;
		if ( ! confirm( 'Clear the content of every block? Structure (sections, columns, services) will be kept.' ) ) return;
		// Tear down all editors before mutating block state.
		blocks.forEach( function( b ) {
			if ( b.type === 'text' )           removeTextEditor( b.id );
			if ( blockHasInlineEditors( b ) )  removeInlineWysiwygsForBlock( b.id );
			clearBlockContent( b );
		} );
		renderAll();
		markDirty();
	} );

	// ── Save as template / Use template (editor) ─────────────────────────────
	// Both flows duplicate the current post on the server, then navigate to
	// the new copy. The original email/template is left untouched.
	function duplicateAndNavigate( action, confirmMsg, $btn, busyLabel, idleLabel ) {
		var postId = $( '#mjml-post-id' ).val();
		if ( ! postId || postId === '0' ) {
			alert( 'Save the email first.' );
			return;
		}
		if ( confirmMsg && ! confirm( confirmMsg ) ) return;
		// Flush any pending edits so the duplicate captures the latest content.
		clearTimeout( autoSaveTimer );
		$btn.prop( 'disabled', true ).text( busyLabel );
		doSave( function() {
			$.post( mjmlEb.ajaxUrl, {
				action:  action,
				nonce:   mjmlEb.nonces.archive,
				post_id: postId,
			} ).done( function( r ) {
				if ( r.success ) window.location.href = r.data.edit_url;
				else $btn.prop( 'disabled', false ).text( idleLabel );
			} ).fail( function() {
				$btn.prop( 'disabled', false ).text( idleLabel );
			} );
		} );
	}

	$( '#mjml-templatize-btn' ).on( 'click', function() {
		duplicateAndNavigate(
			'mjml_templatize_template',
			'Save a copy of this email as a template? The original email will stay published.',
			$( this ), 'Saving…', 'Save as template'
		);
	} );

	$( '#mjml-use-template-btn' ).on( 'click', function() {
		duplicateAndNavigate(
			'mjml_use_template',
			null,
			$( this ), 'Creating…', 'Use this template'
		);
	} );

	// ── Copy HTML ────────────────────────────────────────────────────────────
	$( '#mjml-copy-btn' ).on( 'click', function() {
		copyToClipboard( lastCompiledHtml, $( this ), mjmlEb.i18n.copy );
	} );

	// ── Copy MJML ────────────────────────────────────────────────────────────
	$( '#mjml-copy-mjml-btn' ).on( 'click', function() {
		var bodySections = blocks.map( renderBlockToMjml ).join( '\n' );
		var mjmlDoc =
			'<mjml>\n  <mj-head>\n' + ( activeTheme.styles || '' ) + '\n  </mj-head>\n' +
			'  <mj-body>\n' +
			( activeTheme.header || '' ) + '\n' +
			bodySections + '\n' +
			( activeTheme.footer || '' ) + '\n' +
			'  </mj-body>\n</mjml>';
		copyToClipboard( mjmlDoc, $( this ), 'Copy MJML' );
	} );

	function copyToClipboard( text, $btn, resetLabel ) {
		if ( ! text ) return;
		if ( navigator.clipboard && navigator.clipboard.writeText ) {
			navigator.clipboard.writeText( text ).then( function() {
				$btn.text( mjmlEb.i18n.copied );
				setTimeout( function() { $btn.text( resetLabel ); }, 2000 );
			} );
		} else {
			var $ta = $( '<textarea style="position:fixed;opacity:0">' ).val( text ).appendTo( 'body' );
			$ta[0].select();
			document.execCommand( 'copy' );
			$ta.remove();
			$btn.text( mjmlEb.i18n.copied );
			setTimeout( function() { $btn.text( resetLabel ); }, 2000 );
		}
	}

	// ── List page: delete, duplicate, archive ───────────────────────────────
	$( '.mjml-delete-template' ).on( 'click', function( e ) {
		e.preventDefault();
		if ( ! confirm( mjmlEb.i18n.confirmDel ) ) return;
		var postId = $( this ).data( 'id' );
		var $row   = $( this ).closest( 'tr' );
		$.post( mjmlEb.ajaxUrl, {
			action:  'mjml_delete_template',
			nonce:   mjmlEb.nonces.delete,
			post_id: postId,
		} ).done( function(r) { if (r.success) $row.fadeOut(); } );
	} );

	$( '.mjml-duplicate-template' ).on( 'click', function( e ) {
		e.preventDefault();
		var $link = $( this ).text( 'Duplicating…' );
		$.post( mjmlEb.ajaxUrl, {
			action:  'mjml_duplicate_template',
			nonce:   mjmlEb.nonces.duplicate,
			post_id: $( this ).data( 'id' ),
		} ).done( function(r) {
			if ( r.success ) window.location.href = r.data.edit_url;
			else $link.text( 'Duplicate' );
		} );
	} );

	$( '.mjml-templatize-template' ).on( 'click', function( e ) {
		e.preventDefault();
		var $link = $( this ).text( 'Saving…' );
		$.post( mjmlEb.ajaxUrl, {
			action:  'mjml_templatize_template',
			nonce:   mjmlEb.nonces.archive,
			post_id: $link.data( 'id' ),
		} ).done( function( r ) {
			if ( r.success ) window.location.href = r.data.edit_url;
			else $link.text( 'Save as template' );
		} );
	} );

	$( '.mjml-use-template' ).on( 'click', function( e ) {
		e.preventDefault();
		var $link = $( this ).text( 'Creating…' );
		$.post( mjmlEb.ajaxUrl, {
			action:  'mjml_use_template',
			nonce:   mjmlEb.nonces.archive,
			post_id: $link.data( 'id' ),
		} ).done( function( r ) {
			if ( r.success ) window.location.href = r.data.edit_url;
			else $link.text( 'Use this template' );
		} );
	} );

	$( '.mjml-archive-template, .mjml-unarchive-template' ).on( 'click', function( e ) {
		e.preventDefault();
		var $link  = $( this );
		var $row   = $link.closest( 'tr' );
		var action = $link.hasClass( 'mjml-archive-template' ) ? 'mjml_archive_template' : 'mjml_unarchive_template';
		$.post( mjmlEb.ajaxUrl, {
			action:  action,
			nonce:   mjmlEb.nonces.archive,
			post_id: $link.data( 'id' ),
		} ).done( function(r) { if ( r.success ) $row.fadeOut(); } );
	} );

	// ── MJML generation ──────────────────────────────────────────────────────
	function renderBlockToMjml( block ) {
		switch ( block.type ) {
			case 'navbar':
				return renderNavbar( block );
			case 'section_header':
				var topSpacer    = ( parseInt( block.padding_top, 10 )    > 0 ) ? '<mj-section padding="0"><mj-column><mj-spacer height="' + esc(block.padding_top)    + '"></mj-spacer></mj-column></mj-section>' : '';
				var bottomSpacer = ( parseInt( block.padding_bottom, 10 ) > 0 ) ? '<mj-section padding="0"><mj-column><mj-spacer height="' + esc(block.padding_bottom) + '"></mj-spacer></mj-column></mj-section>' : '';
				var anchor       = block.include_in_nav ? '<!-- htmlmin:ignore --><a name="' + esc(block.anchor_id) + '"></a><!-- htmlmin:ignore -->' : '';
				return topSpacer +
					'<mj-section padding="0"><mj-column>' +
					'<mj-text mj-class="section_header">' +
					'<h3>' + anchor + block.title + '</h3>' +
					'</mj-text></mj-column></mj-section>' +
					bottomSpacer;
			case 'text':
				var cls = block.css_class ? ' css-class="' + esc( block.css_class ) + '"' : '';
				return '<mj-section' + cls + ' padding="0"><mj-column>' +
					'<mj-text>' + block.content + '</mj-text>' +
					'</mj-column></mj-section>';
			case 'image':
				return '<mj-section padding="0"><mj-column>' +
					'<mj-image src="' + esc(block.src) + '"' +
					(block.href ? ' href="' + esc(block.href) + '"' : '') +
					'></mj-image></mj-column></mj-section>';
			case 'button':
				return '<mj-section padding="10px 0"><mj-column>' +
					'<mj-button href="' + esc(block.href) + '" background-color="' + esc(block.background_color) + '">' +
					block.text + '</mj-button></mj-column></mj-section>';
			case 'divider':
				return '<mj-section padding="0"><mj-column>' +
					'<mj-divider border-color="' + esc(block.border_color) + '"></mj-divider>' +
					'</mj-column></mj-section>';
			case 'spacer':
				return '<mj-section padding="0"><mj-column>' +
					'<mj-spacer height="' + esc(block.height) + '"></mj-spacer>' +
					'</mj-column></mj-section>';
			case 'raw':
				return block.mjml || '';
			case 'shabbat_times':    return renderShabbatTimes( block );
			case 'service_list':     return renderServiceList( block );
			case 'service_list_two': return renderServiceListTwo( block );
			case 'notice_list':      return renderNoticeList( block );
			case 'yahrzeit_list':    return renderYahrzeitList( block );
			default:
				return '';
		}
	}

	function renderShabbatTimes( block ) {
		var subtitle = block.subtitle ? '<br /><span style="font-weight:normal">' + block.subtitle + '</span>' : '';
		var lis = ( block.times || [] ).map( function(t) {
			var label = t.bold ? '<strong>' + esc( t.label ) + '</strong>' : esc( t.label );
			var detail = t.detail ? ' <em>' + esc( t.detail ) + '</em>' : '';
			var time   = t.time   ? ' ' + esc( t.time ) : '';
			return '<li>' + label + detail + time + '</li>';
		} ).join( '' );
		return '<mj-section><mj-column>' +
			'<mj-text padding-bottom="0"><h3>' + esc( block.parsha ) + subtitle + '</h3>' +
			'<p>' + esc( block.dates ) + '<br />' + esc( block.hebrew_date ) + '</p></mj-text>' +
			'</mj-column><mj-column>' +
			'<mj-text><ul>' + lis + '</ul><br /></mj-text>' +
			'</mj-column></mj-section>';
	}

	function renderServiceItem( item ) {
		if ( ! item ) return '';
		var label = item.label || '';
		var labelHtml = label
			? '<strong' + ( item.color ? ' class="' + esc( item.color ) + '"' : '' ) + '>' + esc( label ) + '</strong>'
			: '';
		var time  = item.time  ? ( label ? ' ' : '' ) + esc( item.time ) : '';
		var notes = item.notes ? ( ( label || time ) ? ' ' : '' ) + item.notes : '';
		return '<li>' + labelHtml + time + notes + '</li>';
	}

	function renderServiceList( block ) {
		var lis   = ( block.items || [] ).map( renderServiceItem ).join( '' );
		var intro = block.intro ? '<p>' + block.intro + '</p>' : '';
		// TinyMCE wraps content in its own <p>; without stripping it we'd emit
		// <p class="small"><p>...</p></p>, which compiles to extra blank lines.
		var foot  = block.footnote ? '<p class="small">' + stripSingleOuterP( block.footnote ) + '</p>' : '';
		return '<mj-section><mj-column>' +
			'<mj-text padding-top="0" padding-bottom="0">' +
			( block.title ? '<h3>' + esc( block.title ) + '</h3>' : '' ) +
			intro +
			'<ul>' + lis + '</ul>' +
			foot +
			'<br /></mj-text>' +
			'</mj-column></mj-section>';
	}

	function renderServiceColumn( col ) {
		if ( ! col ) return '<mj-column></mj-column>';
		var titleHtml = col.title
			? '<h3' + ( col.title_color ? ' class="' + esc( col.title_color ) + '"' : '' ) + '>' + esc( col.title ) + '</h3>'
			: '';
		var lis = ( col.items || [] ).map( renderServiceItem ).join( '' );
		return '<mj-column><mj-text>' + titleHtml + '<ul>' + lis + '</ul></mj-text></mj-column>';
	}

	function renderServiceListTwo( block ) {
		var head = '';
		if ( block.title || block.intro ) {
			head = '<mj-section><mj-column><mj-text padding-top="0" padding-bottom="0">' +
				( block.title ? '<h3>' + esc( block.title ) + '</h3>' : '' ) +
				( block.intro || '' ) +
				'</mj-text></mj-column></mj-section>';
		}
		return head + '<mj-section padding-top="0">' + renderServiceColumn( block.left ) + renderServiceColumn( block.right ) + '</mj-section>';
	}

	function renderNoticeList( block ) {
		return '<mj-section padding="0"><mj-column>' +
			'<mj-text padding-top="0" padding-bottom="0">' +
			( block.title ? '<p class="title">' + esc( block.title ) + '</p>' : '' ) +
			( block.content || '' ) +
			'</mj-text></mj-column></mj-section>';
	}

	function renderYahrzeitList( block ) {
		var lines = ( block.items_text || '' ).split( /\n/ )
			.map( function(l) { return l.trim(); } )
			.filter( function(l) { return l.length; } );
		if ( ! lines.length ) return '';
		var half  = Math.ceil( lines.length / 2 );
		var left  = lines.slice( 0, half ).map( esc ).join( '<br /> ' );
		var right = lines.slice( half ).map( esc ).join( '<br /> ' );
		return '<mj-section><mj-column>' +
			'<mj-spacer height="10px" />' +
			'<mj-text mj-class="small"> ' + left + '<br /></mj-text>' +
			'<mj-spacer height="20px" />' +
			'</mj-column><mj-column>' +
			'<mj-spacer height="10px" />' +
			'<mj-text mj-class="small"> ' + right + '<br /></mj-text>' +
			'<mj-spacer height="20px" />' +
			'</mj-column></mj-section>';
	}

	function renderNavbar( navBlock ) {
		var navBlocks = blocks.filter( function(b) { return b.type === 'section_header' && b.include_in_nav; } );
		if ( ! navBlocks.length ) return '';
		var links = navBlocks.map( function(b) {
			var label = ( b.nav_label && b.nav_label.length ) ? b.nav_label : b.title;
			return '<mj-navbar-link href="#' + esc(b.anchor_id) + '">' + label + '</mj-navbar-link>';
		} ).join( '\n' );
		var leadLabel    = ( navBlock && navBlock.label !== undefined ) ? navBlock.label : 'Also in this email:';
		var leadHtml     = leadLabel ? '<mj-navbar-link text-decoration="none"><strong>' + leadLabel + '</strong></mj-navbar-link>' : '';
		var topPad       = navBlock ? parseInt( navBlock.padding_top, 10 )    : NaN;
		var bottomPad    = navBlock ? parseInt( navBlock.padding_bottom, 10 ) : NaN;
		var topSpacer    = ( topPad > 0 )    ? '<mj-section padding="0"><mj-column><mj-spacer height="' + esc( navBlock.padding_top )    + '"></mj-spacer></mj-column></mj-section>' : '';
		var bottomSpacer = ( bottomPad > 0 ) ? '<mj-section padding="0"><mj-column><mj-spacer height="' + esc( navBlock.padding_bottom ) + '"></mj-spacer></mj-column></mj-section>' : '';
		return topSpacer +
			'<mj-section><mj-column><mj-navbar base-url="">' + leadHtml + links + '</mj-navbar></mj-column></mj-section>' +
			bottomSpacer;
	}

	function esc( str ) {
		return String( str || '' )
			.replace( /&/g, '&amp;' ).replace( /"/g, '&quot;' )
			.replace( /</g, '&lt;' ).replace( />/g, '&gt;' );
	}

	// If the HTML is a single top-level <p>...</p>, return its inner content;
	// otherwise leave it alone (so multi-paragraph footnotes still render).
	function stripSingleOuterP( html ) {
		if ( ! html ) return html;
		var d = document.createElement( 'div' );
		d.innerHTML = String( html ).trim();
		if ( d.children.length === 1 && d.children[0].tagName === 'P' ) {
			return d.children[0].innerHTML;
		}
		return html;
	}

} );
