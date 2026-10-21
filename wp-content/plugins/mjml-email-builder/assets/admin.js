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
		var $btn   = $( '#mjml-undo-btn, #mjml-float-undo-btn' );
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
		// Render Preview to commit the rolled-back state, or just keep typing —
		// the next user edit will fire markDirty and the auto-save will persist
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
				var notice = 'Showing previous version — Render Preview or edit to save';
				setStatus( notice, 'unsaved' );
				// setStatus() clears the toast for "unsaved", so raise this one
				// after it: the prompt is the whole point of the undo.
				showToast( notice, 'info' );
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

	// The block the user was last working in. Drives where a newly added block is
	// inserted and which block the preview scrolls to after a re-compile.
	var lastFocusedBlockId = null;

	function setLastFocusedBlock( id ) {
		if ( id ) lastFocusedBlockId = id;
	}

	// Strip pasted HTML down to basic formatting only (bold, italic, lists, links).
	// Used by the paste plugin's paste_preprocess hook on every WYSIWYG.
	function cleanPastedHtml( html ) {
		var allowed = { B:1, STRONG:1, I:1, EM:1, U:1, UL:1, OL:1, LI:1, P:1, BR:1, A:1 };
		var temp = document.createElement( 'div' );
		temp.innerHTML = html;
		( function clean( node ) {
			var kids = Array.prototype.slice.call( node.childNodes );
			kids.forEach( function( child ) {
				if ( child.nodeType === 1 ) {
					clean( child );
					if ( ! allowed[ child.nodeName ] ) {
						while ( child.firstChild ) node.insertBefore( child.firstChild, child );
						node.removeChild( child );
					} else {
						var attrs = Array.prototype.slice.call( child.attributes );
						attrs.forEach( function( a ) {
							if ( child.nodeName === 'A' && a.name === 'href' ) return;
							child.removeAttribute( a.name );
						} );
					}
				} else if ( child.nodeType === 8 ) {
					node.removeChild( child );
				}
			} );
		} )( temp );
		return temp.innerHTML;
	}

	function initTextEditor( blockId ) {
		var editorId = 'mjml-text-' + blockId;
		if ( ! document.getElementById( editorId ) ) return;
		if ( typeof wp === 'undefined' || typeof wp.editor === 'undefined' ) return;
		if ( typeof tinymce !== 'undefined' && tinymce.get( editorId ) ) return;

		var styleFormats = buildStyleFormats();

		wp.editor.initialize( editorId, {
			tinymce: {
				toolbar1:           'bold italic underline | styleselect | alignleft aligncenter alignright | link | bullist numlist | removeformat',
				plugins:            'lists,link,paste',
				paste_preprocess:   function( plugin, args ) { args.content = cleanPastedHtml( args.content ); },
				menubar:            false,
				statusbar:          false,
				height:             250,
				style_formats_merge: false,
				style_formats:      styleFormats.length ? styleFormats : [ { title: '— No theme classes defined —', inline: 'span', classes: '' } ],
				content_style:      buildContentStyle(),
				setup: function( editor ) {
					editor.on( 'focus', function() { setLastFocusedBlock( blockId ); } );
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
				plugins:            'lists,link,paste',
				paste_preprocess:   function( plugin, args ) { args.content = cleanPastedHtml( args.content ); },
				menubar:            false,
				statusbar:          false,
				height:             140,
				style_formats_merge: false,
				style_formats:      styleFormats.length ? styleFormats : [ { title: '— No theme classes defined —', inline: 'span', classes: '' } ],
				content_style:      buildContentStyle(),
				setup: function( editor ) {
					editor.on( 'focus', function() { setLastFocusedBlock( blockId ); } );
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
		if ( block.type === 'update' )           return [ 'content' ];
		if ( block.type === 'vibes' )            return [ 'description' ];
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
				// Compiling and the undo refresh are follow-on work: if either
				// throws, jQuery would skip .always() below and isSaving would
				// stay true, silently wedging every later auto-save. Keep the
				// failure visible but contained.
				try {
					doCompile( true );
				} catch ( err ) {
					console.error( 'MJML compile failed:', err );
					setStatus( mjmlEb.i18n.error + ( err && err.message ? err.message : 'compile failed' ), 'error' );
				}
				try {
					refreshUndoButton();
				} catch ( err ) {
					console.error( 'MJML undo refresh failed:', err );
				}
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

		// The status text lives in the topbar, which scrolls out of sight on a
		// long email — mirror the states worth noticing into a toast. Anything
		// else (e.g. "Unsaved changes" while typing) clears a toast still up.
		if ( state === 'saving' || state === 'saved' || state === 'error' ) {
			showToast( msg, state );
		} else {
			hideToast();
		}
	}

	// ── Save / error toast ───────────────────────────────────────────────────
	var toastTimer = null;

	var TOAST_ICONS = {
		saving: 'dashicons-update',
		saved:  'dashicons-yes-alt',
		error:  'dashicons-warning',
		info:   'dashicons-info',
	};

	function showToast( msg, state ) {
		// Editor-only: the list and settings pages have no status element.
		if ( ! $( '#mjml-status' ).length ) return;

		var $toast = $( '#mjml-eb-toast' );
		if ( ! $toast.length ) {
			$toast = $( '<div id="mjml-eb-toast" class="mjml-eb-toast" role="status" aria-live="polite"></div>' )
				.append( '<span class="dashicons"></span><span class="mjml-eb-toast-text"></span>' )
				.appendTo( 'body' )
				.on( 'click', function() {
					// Don't let a click dismiss a save still in flight.
					if ( $( this ).attr( 'data-state' ) !== 'saving' ) hideToast();
				} );
		}

		var wasVisible = $toast.hasClass( 'is-visible' );

		$toast.attr( 'data-state', state );
		$toast.find( '.dashicons' ).attr( 'class', 'dashicons ' + ( TOAST_ICONS[ state ] || TOAST_ICONS.saved ) );
		$toast.find( '.mjml-eb-toast-text' ).text( msg );

		// "Saving…" morphs into "All changes saved" in place — only animate in
		// when the toast wasn't already on screen, so it doesn't flicker.
		if ( ! wasVisible ) {
			$toast.removeClass( 'is-visible' );
			void $toast[0].offsetWidth;
			$toast.addClass( 'is-visible' );
		}

		clearTimeout( toastTimer );
		// A save in progress stays up until it resolves. Errors and prompts stay
		// long enough to read and act on; a completed save is just a glance.
		if ( state === 'saving' ) return;
		var life = 2200;
		if ( state === 'error' ) life = 8000;
		if ( state === 'info' )  life = 7000;
		toastTimer = setTimeout( hideToast, life );
	}

	function hideToast() {
		clearTimeout( toastTimer );
		$( '#mjml-eb-toast' ).removeClass( 'is-visible' );
	}

	// Title changes trigger auto-save
	$( '#mjml-title' ).on( 'input', markDirty );

	// ── Block defaults ───────────────────────────────────────────────────────
	var DEFAULTS = {
		navbar:         function() { return { type: 'navbar', id: makeId(), label: 'Also in this email:', padding_top: '10px', padding_bottom: '10px' }; },
		section_header: function() { return { type: 'section_header', id: makeId(), title: 'Section Title', anchor_id: 'section-title', include_in_nav: true, padding_top: '20px', padding_bottom: '20px' }; },
		text:           function() { return { type: 'text', id: makeId(), content: '<p>Your content here.</p>', css_class: '' }; },
		update:         function() { return { type: 'update', id: makeId(), content: '<p><strong>UPDATE:</strong> </p>', highlight_class: 'error_header' }; },
		image:          function() { return { type: 'image', id: makeId(), src: '', href: '', width: '' }; },
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

		two_images: function() { return {
			type: 'two_images', id: makeId(),
			left_src: '',  left_href: '',
			right_src: '', right_href: '',
		}; },

		vibes: function() { return {
			type: 'vibes', id: makeId(),
			title: '',
			description: '<p>Short description of the group, with date/time of the next meeting.</p>',
			image2_src: '',
			image_src: '',
			image_href: 'https://tinyurl.com/besvibesgroups',
			button_text: '',
			button_href: 'https://tinyurl.com/besvibesgroups',
			image_on_right: true,
			show_divider: true,
		}; },
	};

	var LABELS = {
		navbar: 'Navbar', section_header: 'Section Header', update: 'Update', text: 'Text',
		image: 'Image', button: 'Button', divider: 'Divider', spacer: 'Spacer', raw: 'Raw MJML',
		shabbat_times: 'Shabbat Times', service_list: 'Service List',
		service_list_two: 'Services × 2', notice_list: 'Notice List', yahrzeit_list: 'Yahrzeits',
		vibes: 'Feature', two_images: 'Two-Col Images',
	};

	function slugify( str ) {
		return str.toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' );
	}

	// ── Block rendering ──────────────────────────────────────────────────────
	function renderBlock( block ) {
		var label   = LABELS[ block.type ] || block.type;
		var summary = blockSummary( block );

		var rowCls = ( block.locked ? ' is-locked' : '' ) + ( block.hidden ? ' is-hidden' : '' );
		var $row = $( '<div class="mjml-block-row' + rowCls + '" data-id="' + block.id + '"></div>' );

		var clearBtn = blockHasClearableContent( block.type )
			? '<button class="mjml-clear-block-content button-link" title="Clear this block\'s content (keep structure)"><span class="dashicons dashicons-editor-removeformatting"></span></button>'
			: '';

		var hideBtn = block.hidden
			? '<button class="mjml-hide-block button-link is-hidden" title="Show block (currently hidden from compile)"><span class="dashicons dashicons-hidden"></span></button>'
			: '<button class="mjml-hide-block button-link" title="Hide block (exclude from compiled output)"><span class="dashicons dashicons-visibility"></span></button>';

		var lockBtn = block.locked
			? '<button class="mjml-lock-block button-link is-locked" title="Unlock block (click to allow deletion)"><span class="dashicons dashicons-lock"></span></button>'
			: '<button class="mjml-lock-block button-link" title="Lock block to prevent accidental deletion"><span class="dashicons dashicons-unlock"></span></button>';

		var $header = $(
			'<div class="mjml-block-header">' +
				'<span class="mjml-drag-handle dashicons dashicons-move" title="Drag to reorder"></span>' +
				'<span class="mjml-block-badge mjml-type-' + block.type + '">' + label + '</span>' +
				'<span class="mjml-block-summary"></span>' +
				'<button class="mjml-block-toggle button-link" aria-label="Toggle"><span class="dashicons dashicons-arrow-down-alt2"></span></button>' +
				clearBtn +
				hideBtn +
				lockBtn +
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
			case 'update':
				block.content = '<p></p>';
				return;
			case 'yahrzeit_list':
				block.items_text = '';
				return;
			case 'two_images':
				block.left_src = '';  block.left_href = '';
				block.right_src = ''; block.right_href = '';
				return;
			case 'vibes':
				block.title = '';
				block.description = '<p></p>';
				block.image2_src = '';
				block.image_src = '';
				block.image_href = '';
				block.button_text = '';
				block.button_href = '';
				return;
		}
	}

	function blockSummary( block ) {
		switch ( block.type ) {
			case 'navbar':           return '(auto-generated from section headers)';
			case 'section_header':   return block.title;
			case 'text':             return $( '<div>' ).html( block.content ).text().substring( 0, 80 ) + '…';
			case 'update':           return $( '<div>' ).html( block.content ).text().substring( 0, 80 ) + '…';
			case 'image':            return ( block.src || '(no image set)' ) + ( pxLength( block.width ) ? ' · ' + pxLength( block.width ) : '' );
			case 'button':           return block.text;
			case 'divider':          return 'border: ' + block.border_color;
			case 'spacer':           return 'height: ' + block.height;
			case 'raw':              return '(raw MJML)';
			case 'shabbat_times':    return block.parsha + ' · ' + block.dates;
			case 'service_list':     return block.title + ' (' + ( block.items || [] ).length + ' items)';
			case 'service_list_two': return ( block.title ? block.title + ' — ' : '' ) + ( block.left.title || '?' ) + ' / ' + ( block.right.title || '?' );
			case 'notice_list':      return block.title + ' — ' + $( '<div>' ).html( block.content || '' ).text().substring( 0, 60 ) + '…';
			case 'yahrzeit_list':    return ( block.items_text || '' ).split( /\n/ ).filter( function(l) { var t = l.trim(); return t.length && ! /^--+$/.test( t ); } ).length + ' yahrzeits';
			case 'vibes':            return ( block.title || '(untitled)' ) + ' · image ' + ( block.image_on_right ? 'right' : 'left' );
			case 'two_images':       return ( block.left_src ? '✓' : '—' ) + ' / ' + ( block.right_src ? '✓' : '—' );
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

	// A picker that lets the user drop a link to any Section Header block into the
	// update box. Listing every section header (not just the navbar ones) — section
	// headers always emit their <a name> anchor, so any of them is a valid target.
	function buildSectionLinkInserter( block ) {
		var $row = $( '<div class="mjml-field-row mjml-section-link-row"></div>' );
		var sections = blocks.filter( function( b ) { return b.type === 'section_header'; } );
		if ( ! sections.length ) {
			$row.append( '<p class="mjml-field-note">Add a Section Header block to link to it from here.</p>' );
			return $row;
		}
		$row.append( '<span class="mjml-field-label">Insert link to section</span>' );
		var $sel = $( '<select class="mjml-section-link-select"></select>' );
		sections.forEach( function( s ) {
			var title  = ( s.title || '' ).trim() || '(untitled section)';
			var anchor = s.anchor_id || slugify( title );
			$sel.append( $( '<option>' ).val( anchor ).text( title ) );
		} );
		$row.append( $sel ).append( ' ' )
			.append( '<button type="button" class="button mjml-insert-section-link">Insert link</button>' );
		$row.append( '<p class="mjml-field-note">Select the words you want linked in the box above, then choose a section and click Insert. Links show in the normal colour here; when the email is compiled they\'re recoloured to match the highlight style\'s text colour (from Settings) so they stand out on the background.</p>' );
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

			case 'update':
				$f.append( inlineWysiwygField( 'Update text', block.id, 'content', block.content ) );
				$f.append( buildSectionLinkInserter( block ) );
				$f.append( field( 'Highlight style (theme class)', textInput( 'highlight_class', block.highlight_class, 'e.g. error_header' ) ) );
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
				$f.append( field( 'Width in pixels (optional)', textInput( 'width', block.width, 'e.g. 300 — blank for full width' ) ) );
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
				$f.append( field( 'Names (one per line — auto-split into two columns; use a line of "--" to force the split point. Wrap text in *asterisks* for bold or _underscores_ for italic. Blank lines insert an extra line break.)', areaInput( 'items_text', block.items_text, 12 ) ) );
				break;

			case 'two_images':
				[ 'left', 'right' ].forEach( function( side ) {
					var label = side === 'left' ? 'Left' : 'Right';
					var srcKey  = side + '_src';
					var hrefKey = side + '_href';

					var $imgWrap  = $( '<p class="mjml-field-row"></p>' );
					var $imgLabel = $( '<label></label>' ).append( '<span class="mjml-field-label">' + label + ' image URL</span>' );
					var $imgInput = $( '<input type="text" class="regular-text mjml-field">' )
						.attr( { 'data-key': srcKey } ).val( block[ srcKey ] || '' );
					var $imgPick  = $( '<button class="button mjml-media-pick" type="button">Choose Image</button>' );
					$imgLabel.append( $imgInput ).append( ' ' ).append( $imgPick );
					$imgWrap.append( $imgLabel );
					$f.append( $imgWrap );

					$f.append( field( label + ' link URL (optional)', textInput( hrefKey, block[ hrefKey ] ) ) );
				} );
				break;

			case 'vibes':
				$f.append( field( 'Name', textInput( 'title', block.title, 'e.g. Book Club' ) ) );

				var $img2Wrap  = $( '<p class="mjml-field-row"></p>' );
				var $img2Label = $( '<label></label>' ).append( '<span class="mjml-field-label">Top image URL (optional, no link)</span>' );
				var $img2Input = $( '<input type="text" class="regular-text mjml-field">' )
					.attr( { 'data-key': 'image2_src' } ).val( block.image2_src || '' );
				var $img2Pick  = $( '<button class="button mjml-media-pick" type="button">Choose Image</button>' );
				$img2Label.append( $img2Input ).append( ' ' ).append( $img2Pick );
				$img2Wrap.append( $img2Label );
				$f.append( $img2Wrap );

				var $imgWrap  = $( '<p class="mjml-field-row"></p>' );
				var $imgLabel = $( '<label></label>' ).append( '<span class="mjml-field-label">Image URL</span>' );
				var $imgInput = $( '<input type="text" class="regular-text mjml-field">' )
					.attr( { 'data-key': 'image_src' } ).val( block.image_src || '' );
				var $imgPick  = $( '<button class="button mjml-media-pick" type="button">Choose Image</button>' );
				$imgLabel.append( $imgInput ).append( ' ' ).append( $imgPick );
				$imgWrap.append( $imgLabel );
				$f.append( $imgWrap );

				$f.append( field( 'Image link URL (optional)', textInput( 'image_href', block.image_href ) ) );
				$f.append( inlineWysiwygField( 'Description', block.id, 'description', block.description ) );
				$f.append( field( 'Button text', textInput( 'button_text', block.button_text ) ) );
				$f.append( field( 'Button link URL', textInput( 'button_href', block.button_href ) ) );
				$f.append( $( '<p class="mjml-field-row"></p>' ).append(
					$( '<label class="mjml-checkbox-label"></label>' ).append(
						$( '<input type="checkbox" class="mjml-field">' )
							.attr( 'data-key', 'image_on_right' )
							.prop( 'checked', block.image_on_right !== false )
					).append( ' Image on the right (uncheck to flip to the left)' )
				) );
				$f.append( $( '<p class="mjml-field-row"></p>' ).append(
					$( '<label class="mjml-checkbox-label"></label>' ).append(
						$( '<input type="checkbox" class="mjml-field">' )
							.attr( 'data-key', 'show_divider' )
							.prop( 'checked', block.show_divider !== false )
					).append( ' Show divider below this block' )
				) );
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
			var $row = $( '<div class="mjml-repeat-row"></div>' )
				.attr( 'data-index', i )
				.toggleClass( 'is-hidden', !! item.hidden );
			$row.append( $( '<input type="text" class="mjml-svc-label" placeholder="Label (bold)">' ).val( item.label || '' ) );
			$row.append( colorSelect( item.color ) );
			$row.append( $( '<input type="text" class="mjml-svc-time" placeholder="Time">' ).val( item.time || '' ) );
			$row.append( $( '<input type="text" class="mjml-svc-notes" placeholder="Notes (after time)">' ).val( item.notes || '' ) );
			$row.append( svcHideButton( item ) );
			$row.append( $( '<button type="button" class="button-link mjml-svc-del" title="Remove">×</button>' ) );
			$list.append( $row );
		} );
		$wrap.append( $list );
		$wrap.append( '<button type="button" class="button mjml-svc-add">+ Add service</button>' );
		return $wrap;
	}

	function svcHideButton( item ) {
		return item.hidden
			? '<button type="button" class="button-link mjml-svc-hide is-hidden" title="Show item (currently hidden from compile)"><span class="dashicons dashicons-hidden"></span></button>'
			: '<button type="button" class="button-link mjml-svc-hide" title="Hide item (exclude from compiled output)"><span class="dashicons dashicons-visibility"></span></button>';
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
					.attr( 'data-orig-side', side )
					.toggleClass( 'is-hidden', !! item.hidden );
				$row.append( '<span class="mjml-svc-drag dashicons dashicons-move" title="Drag to reorder or move between columns"></span>' );
				$row.append( $( '<input type="text" class="mjml-svc-label" placeholder="Label (bold)">' ).val( item.label || '' ) );
				$row.append( colorSelect( item.color ) );
				$row.append( $( '<input type="text" class="mjml-svc-time" placeholder="Time">' ).val( item.time || '' ) );
				$row.append( $( '<input type="text" class="mjml-svc-notes" placeholder="Notes">' ).val( item.notes || '' ) );
				$row.append( svcHideButton( item ) );
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
		var navHeaders = blocks.filter( function(b) { return b.type === 'section_header' && b.include_in_nav && ! b.hidden; } );
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

		// Remember the block being worked in — see lastFocusedBlockId.
		.on( 'focusin mousedown', '.mjml-block-row', function() {
			setLastFocusedBlock( $( this ).data( 'id' ) );
		} )

		.on( 'click', '.mjml-block-toggle', function( e ) {
			e.stopPropagation();
			var $row    = $( this ).closest( '.mjml-block-row' );
			var blockId = $row.data( 'id' );
			var $fields = $row.find( '.mjml-block-fields' );
			var $icon   = $( this ).find( '.dashicons' );
			var opening = ! $fields.is( ':visible' );

			if ( opening ) setLastFocusedBlock( blockId );

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

		// Auto-fill the Vibes button text from the Name when Name loses focus.
		// Only overwrites if the button text is empty or still matches the auto pattern,
		// so a manually customised button text is preserved.
		.on( 'blur', '.mjml-field', function() {
			var $row  = $( this ).closest( '.mjml-block-row' );
			var id    = $row.data( 'id' );
			var block = blocks.find( function(b) { return b.id === id; } );
			if ( ! block || block.type !== 'vibes' ) return;
			if ( $( this ).data( 'key' ) !== 'title' ) return;

			var name = ( block.title || '' ).trim();
			if ( ! name ) return;

			var current = block.button_text || '';
			if ( current && ! /^Sign up to the /.test( current ) ) return;

			var desired = 'Sign up to the ' + name;
			if ( current === desired ) return;

			block.button_text = desired;
			$row.find( 'input.mjml-field[data-key="button_text"]' ).val( desired );
			$row.find( '.mjml-block-summary' ).text( blockSummary( block ) );
			markDirty();
		} )

		// Update block: insert a link to the chosen section into the WYSIWYG.
		.on( 'click', '.mjml-insert-section-link', function() {
			var $row  = $( this ).closest( '.mjml-block-row' );
			var id    = $row.data( 'id' );
			var block = blocks.find( function( b ) { return b.id === id; } );
			if ( ! block ) return;

			var anchor = $row.find( '.mjml-section-link-select' ).val();
			if ( ! anchor ) return;

			var editorId = inlineEditorId( id, 'content' );
			var ed = typeof tinymce !== 'undefined' ? tinymce.get( editorId ) : null;
			if ( ! ed || ed.isHidden() ) {
				alert( 'Click inside the update text box first, then insert the link.' );
				return;
			}

			// Use the current selection as the link text; fall back to the section title.
			var selected = ed.selection.getContent();
			var inner = selected || $( '<span>' ).text( $row.find( '.mjml-section-link-select option:selected' ).text() ).html();

			// Insert a plain link — the white colour for the highlight background is
			// applied at compile time (see renderUpdate), so the link stays visible in
			// the normal link colour while editing.
			ed.execCommand( 'mceInsertContent', false,
				'<a href="#' + escAttr( anchor ) + '">' + inner + '</a>' );

			block.content = ed.getContent();
			markDirty();
		} )

		.on( 'click', '.mjml-delete-block', function( e ) {
			e.stopPropagation();
			var id    = $( this ).closest( '.mjml-block-row' ).data( 'id' );
			var block = blocks.find( function(b) { return b.id === id; } );
			if ( block && block.locked ) return; // belt-and-suspenders: button is hidden via CSS, but ignore stray clicks too
			if ( block && block.type === 'text' )       removeTextEditor( id );
			if ( block && blockHasInlineEditors( block ) ) removeInlineWysiwygsForBlock( id );
			if ( lastFocusedBlockId === id ) lastFocusedBlockId = null;
			blocks = blocks.filter( function(b) { return b.id !== id; } );
			renderAll();
			markDirty();
		} )

		.on( 'click', '.mjml-hide-block', function( e ) {
			e.stopPropagation();
			var $row  = $( this ).closest( '.mjml-block-row' );
			var id    = $row.data( 'id' );
			var block = blocks.find( function(b) { return b.id === id; } );
			if ( ! block ) return;
			block.hidden = ! block.hidden;
			$row.toggleClass( 'is-hidden', !! block.hidden );
			var $btn  = $( this );
			var $icon = $btn.find( '.dashicons' );
			if ( block.hidden ) {
				$btn.addClass( 'is-hidden' ).attr( 'title', 'Show block (currently hidden from compile)' );
				$icon.removeClass( 'dashicons-visibility' ).addClass( 'dashicons-hidden' );
			} else {
				$btn.removeClass( 'is-hidden' ).attr( 'title', 'Hide block (exclude from compiled output)' );
				$icon.removeClass( 'dashicons-hidden' ).addClass( 'dashicons-visibility' );
			}
			// Hiding a section_header affects the navbar — refresh any open navbar previews.
			if ( block.type === 'section_header' ) {
				$( '.mjml-navbar-preview' ).each( function() {
					updateNavbarPreview( $( this ).closest( '.mjml-block-fields' ) );
				} );
			}
			markDirty();
		} )

		.on( 'click', '.mjml-lock-block', function( e ) {
			e.stopPropagation();
			var $row  = $( this ).closest( '.mjml-block-row' );
			var id    = $row.data( 'id' );
			var block = blocks.find( function(b) { return b.id === id; } );
			if ( ! block ) return;
			block.locked = ! block.locked;
			$row.toggleClass( 'is-locked', !! block.locked );
			var $btn  = $( this );
			var $icon = $btn.find( '.dashicons' );
			if ( block.locked ) {
				$btn.addClass( 'is-locked' ).attr( 'title', 'Unlock block (click to allow deletion)' );
				$icon.removeClass( 'dashicons-unlock' ).addClass( 'dashicons-lock' );
			} else {
				$btn.removeClass( 'is-locked' ).attr( 'title', 'Lock block to prevent accidental deletion' );
				$icon.removeClass( 'dashicons-lock' ).addClass( 'dashicons-unlock' );
			}
			markDirty();
		} )

		.on( 'click', '.mjml-clear-block-content', function( e ) {
			e.stopPropagation();
			var id    = $( this ).closest( '.mjml-block-row' ).data( 'id' );
			var block = blocks.find( function(b) { return b.id === id; } );
			if ( ! block ) return;
			if ( block.locked ) return; // hidden via CSS, but guard against stray events too
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
			var $input = $( this ).siblings( 'input.mjml-field' ).first();
			// Use a Library controller with displaySettings:true so the sidebar
			// shows WordPress's native Size dropdown (thumbnail/medium/large/full).
			var frame = wp.media( {
				title: 'Choose Image',
				button: { text: 'Use this image' },
				multiple: false,
				library: { type: 'image' },
				states: [ new wp.media.controller.Library( {
					title:               'Choose Image',
					library:             wp.media.query( { type: 'image' } ),
					multiple:            false,
					displaySettings:     true,
					displayUserSettings: false,
				} ) ],
			} );
			// Default the sidebar Size dropdown to "Full" instead of WordPress's
			// global default (typically Medium). Fires on initial add only, so a
			// user's later change to the dropdown isn't overridden.
			frame.on( 'open', function() {
				var state = frame.state();
				state.get( 'selection' ).on( 'add', function( attachment ) {
					state.display( attachment ).set( 'size', 'full' );
				} );
			} );
			frame.on( 'select', function() {
				var selection = frame.state().get( 'selection' ).first();
				var att       = selection.toJSON();
				var display   = frame.state().display( selection ).toJSON();
				var size      = display && display.size ? display.size : 'full';
				var sized     = att.sizes && att.sizes[ size ];
				var url       = sized && sized.url ? sized.url : att.url;
				$input.val( url ).trigger( 'change' );
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

		.on( 'click', '.mjml-svc-hide', function( e ) {
			e.preventDefault();
			var $row   = $( this ).closest( '.mjml-block-row' );
			var block  = blocks.find( function(b) { return b.id === $row.data( 'id' ); } );
			if ( ! block ) return;
			var $entry = $( this ).closest( '.mjml-repeat-row' );
			var index  = parseInt( $entry.attr( 'data-index' ), 10 );
			var side   = $entry.closest( '.mjml-twocol-side' ).data( 'side' );
			var key    = $entry.closest( '.mjml-repeat' ).data( 'key' );
			var arr    = side && block[ side ] ? block[ side ].items : block[ key ];
			if ( ! arr || ! arr[ index ] ) return;
			var item = arr[ index ];
			item.hidden = ! item.hidden;
			$entry.toggleClass( 'is-hidden', !! item.hidden );
			var $btn  = $( this );
			var $icon = $btn.find( '.dashicons' );
			if ( item.hidden ) {
				$btn.addClass( 'is-hidden' ).attr( 'title', 'Show item (currently hidden from compile)' );
				$icon.removeClass( 'dashicons-visibility' ).addClass( 'dashicons-hidden' );
			} else {
				$btn.removeClass( 'is-hidden' ).attr( 'title', 'Hide item (exclude from compiled output)' );
				$icon.removeClass( 'dashicons-hidden' ).addClass( 'dashicons-visibility' );
			}
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

		// Insert the new block right after the one the user was last working in,
		// falling back to the last expanded block, then to the end of the list.
		var insertAfter = null;
		if ( lastFocusedBlockId && blocks.some( function(b) { return b.id === lastFocusedBlockId; } ) ) {
			insertAfter = lastFocusedBlockId;
		} else {
			var $expanded = $( '#mjml-blocks-list .mjml-block-row' ).filter( function() {
				return $( this ).find( '> .mjml-block-fields' ).is( ':visible' );
			} ).last();
			if ( $expanded.length ) insertAfter = $expanded.data( 'id' );
		}

		if ( insertAfter ) {
			var idx = blocks.findIndex( function(b) { return b.id === insertAfter; } );
			if ( idx >= 0 ) blocks.splice( idx + 1, 0, newBlock );
			else            blocks.push( newBlock );
		} else {
			blocks.push( newBlock );
		}

		setLastFocusedBlock( newBlock.id );

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

	// Holds the last compiled HTML for copying. Seeded from the server-side
	// cached HTML so Copy HTML works immediately on page load, before the user
	// has clicked Compile.
	var lastCompiledHtml = mjmlEb.compiledHtml || '';

	// ── MJML document assembly ───────────────────────────────────────────────
	// Prefix for the per-block marker classes the preview uses to find a block in
	// the compiled HTML. Stripped from anything the user copies or we cache.
	var BLOCK_MARKER_PREFIX = 'mjmlblk-';

	// Tag a block's rendered MJML with its marker class so the preview can scroll
	// to it. The class goes on the block's first <mj-section> (or <mj-wrapper>),
	// appended to any css-class the block already sets. Blocks that emit neither
	// tag — some Raw MJML — are left alone and simply aren't scroll targets.
	function tagBlockMjml( mjml, block ) {
		var marker = BLOCK_MARKER_PREFIX + block.id;
		var open   = /<mj-(?:section|wrapper)\b/i.exec( mjml );
		if ( ! open ) return mjml;

		var tagEnd = mjml.indexOf( '>', open.index );
		if ( tagEnd === -1 ) return mjml;

		// Raw MJML is hand-written, so the tag may be self-closing and may quote
		// attributes with either kind of quote — keep both intact.
		var tag       = mjml.slice( open.index, tagEnd );
		var selfClose = /\/\s*$/.test( tag );
		var body      = selfClose ? tag.replace( /\/\s*$/, '' ) : tag;
		var existing  = /css-class\s*=\s*("[^"]*"|'[^']*')/i.exec( body );

		if ( existing ) {
			var quote = existing[1].charAt( 0 );
			var value = existing[1].slice( 1, -1 );
			body = body.replace( existing[0], 'css-class=' + quote + ( value ? value + ' ' : '' ) + marker + quote );
		} else {
			body = body.replace( /\s+$/, '' ) + ' css-class="' + marker + '"';
		}

		return mjml.slice( 0, open.index ) + body + ( selfClose ? ' /' : '' ) + mjml.slice( tagEnd );
	}

	// Remove the marker classes again, so copied/cached HTML matches what the
	// blocks alone would have produced.
	function stripBlockMarkers( html ) {
		return String( html || '' )
			.replace( new RegExp( '\\s*\\b' + BLOCK_MARKER_PREFIX + '[a-z0-9]+\\b', 'gi' ), '' )
			.replace( /\s*class=""/g, '' );
	}

	// Build the full MJML document for the current blocks and theme. With
	// markers:true each block carries its marker class (preview only).
	function buildMjmlDoc( opts ) {
		var markers      = !! ( opts && opts.markers );
		var bodySections = blocks
			.filter( function(b) { return ! b.hidden; } )
			.map( function(b) {
				var mjml = renderBlockToMjml( b );
				return markers ? tagBlockMjml( mjml, b ) : mjml;
			} )
			.join( '\n' );

		return '<mjml>\n  <mj-head>\n' + ( activeTheme.styles || '' ) + '\n  </mj-head>\n' +
			'  <mj-body>\n' +
			( activeTheme.header || '' ) + '\n' +
			bodySections + '\n' +
			( activeTheme.footer || '' ) + '\n' +
			'  </mj-body>\n</mjml>';
	}

	// ── Compile ──────────────────────────────────────────────────────────────
	function doCompile( silent ) {
		syncAllEditors();
		if ( typeof window.mjml !== 'function' ) {
			if ( ! silent ) setStatus( 'MJML library not loaded yet.', 'error' );
			return;
		}
		if ( ! silent ) setStatus( mjmlEb.i18n.converting, 'saving' );
		setCompileDisabled( true );

		var mjmlDoc = buildMjmlDoc( { markers: true } );

		var result;
		try {
			result = window.mjml( mjmlDoc, {
				validationLevel: 'soft',
				minify:          true,
				minifyOptions:   {
					collapseWhitespace:     true,
					removeEmptyAttributes:  true,
					minifyCSS:              false, // keep CSS readable so email-client quirks don't bite
				},
			} );
		} catch ( err ) {
			setStatus( mjmlEb.i18n.error + err.message, 'error' );
			setCompileDisabled( false );
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

		// The compiled document carries the per-block markers; everything that
		// leaves the editor (clipboard, cached HTML) gets them stripped.
		var cleanHtml = stripBlockMarkers( result.html );
		lastCompiledHtml = cleanHtml;

		// Strip <script> tags before previewing: real email clients block JS, and
		// our preview iframe is sandboxed without allow-scripts so any <script> in
		// the output produces a "Blocked script execution in about:srcdoc" warning.
		var previewHtml = result.html.replace( /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '' );
		var frame       = document.getElementById( 'mjml-preview-frame' );

		// The iframe should always be there, but if something removed it the
		// compile itself still succeeded — keep saving and caching rather than
		// throwing and taking auto-save down with it.
		if ( frame ) {
			renderPreview( frame, previewHtml, silent );
		} else {
			console.warn( 'MJML preview iframe is missing — skipping preview render.' );
		}

		setCompileDisabled( false );

		var postId = $( '#mjml-post-id' ).val();
		if ( postId && postId !== '0' ) {
			$.post( mjmlEb.ajaxUrl, {
				action:  'mjml_cache_html',
				nonce:   mjmlEb.nonces.cache,
				post_id: postId,
				html:    cleanHtml,
			} );
		}
	}

	// ── Preview rendering ────────────────────────────────────────────────────
	// Swap the compiled HTML into the iframe, then put the scroll position back
	// where it belongs: on the block being edited if the focus has moved there,
	// otherwise exactly where the user had scrolled to.
	function renderPreview( frame, previewHtml, silent ) {
		var prevScroll = previewScrollTop();

		// An explicit Compile always re-centres the focused block; a background
		// auto-save compile only does so when the focus has moved to another
		// block, so it never undoes the user's own scrolling mid-edit. (Clicking
		// Compile runs through doSave, which compiles silently — hence the flag.)
		var wantBlock = ( forcePreviewScroll || ! silent || lastFocusedBlockId !== lastScrolledBlockId )
			? lastFocusedBlockId
			: null;
		forcePreviewScroll = false;

		// .off() first so a handler left over from a previous compile can't fire
		// against this render. Positioning the preview must never be able to break
		// the compile/save chain, hence the try/catch.
		$( frame ).off( 'load.mjmlPreview' ).one( 'load.mjmlPreview', function() {
			try {
				var applyScroll = function() {
					if ( ! ( wantBlock && scrollPreviewToBlock( wantBlock ) ) ) {
						setPreviewScrollTop( prevScroll );
					}
				};
				applyScroll();
				// Remote images can still be loading, which shifts everything below
				// them once they arrive — position again once they've settled.
				whenPreviewImagesSettle( applyScroll );
			} catch ( e ) {
				console.warn( 'MJML preview scroll skipped:', e );
			}
		} );

		frame.srcdoc = previewHtml;
		$( '#mjml-output-panel' ).show();
	}

	// ── Preview scrolling ────────────────────────────────────────────────────
	// Which block the preview was last scrolled to, so repeated auto-save
	// compiles for the same block leave the preview where the user left it.
	var lastScrolledBlockId = null;

	// The preview is same-origin (sandbox="allow-same-origin"), but srcdoc can be
	// mid-swap, so every document access is guarded.
	function previewDoc() {
		try {
			var frame = document.getElementById( 'mjml-preview-frame' );
			return frame && frame.contentDocument ? frame.contentDocument : null;
		} catch ( e ) {
			return null;
		}
	}

	function previewScrollTop() {
		var doc = previewDoc();
		if ( ! doc ) return 0;
		try {
			return ( doc.documentElement && doc.documentElement.scrollTop ) || ( doc.body && doc.body.scrollTop ) || 0;
		} catch ( e ) {
			return 0;
		}
	}

	function setPreviewScrollTop( top ) {
		var doc = previewDoc();
		if ( ! doc ) return;
		try {
			if ( doc.documentElement ) doc.documentElement.scrollTop = top;
			if ( doc.body )            doc.body.scrollTop            = top;
		} catch ( e ) {}
	}

	// Run the callback once every image still loading in the preview has either
	// loaded or failed. Does nothing if they're all settled already.
	function whenPreviewImagesSettle( cb ) {
		var doc = previewDoc();
		if ( ! doc ) return;
		var pending;
		try {
			pending = Array.prototype.slice.call( doc.images || [] ).filter( function( img ) { return ! img.complete; } );
		} catch ( e ) {
			return;
		}
		if ( ! pending.length ) return;

		var left = pending.length;
		pending.forEach( function( img ) {
			var done = function() {
				img.removeEventListener( 'load', done );
				img.removeEventListener( 'error', done );
				if ( --left === 0 ) cb();
			};
			img.addEventListener( 'load', done );
			img.addEventListener( 'error', done );
		} );
	}

	// Scroll the block into view near the top of the preview. Deliberately not
	// scrollIntoView(), which would also scroll the surrounding admin page.
	// Returns false when the block has no marker in the compiled output.
	function scrollPreviewToBlock( blockId ) {
		var doc = previewDoc();
		if ( ! doc ) return false;
		try {
			var el = doc.querySelector( '.' + BLOCK_MARKER_PREFIX + blockId );
			if ( ! el ) return false;
			var top = el.getBoundingClientRect().top + previewScrollTop() - 16;
			setPreviewScrollTop( Math.max( 0, top ) );
			lastScrolledBlockId = blockId;
			return true;
		} catch ( e ) {
			return false;
		}
	}

	// Set when the user asks for a compile themselves, so the preview re-centres
	// on the focused block even though doSave() compiles silently.
	var forcePreviewScroll = false;

	$( '#mjml-convert-btn' ).on( 'click', function() {
		clearTimeout( autoSaveTimer );
		forcePreviewScroll = true;
		doSave();
	} );

	// Both copies of the button are the same action, so disable them together.
	function setCompileDisabled( flag ) {
		$( '#mjml-convert-btn, #mjml-float-convert-btn' ).prop( 'disabled', flag );
	}

	// ── Floating primary actions ─────────────────────────────────────────────
	// The topbar scrolls away on a long email, so mirror Copy HTML / Render
	// Preview into a floating bar whenever it's off screen.
	( function initFloatActions() {
		var $bar     = $( '#mjml-float-actions' );
		var $topbar  = $( '.mjml-eb-topbar-actions' );
		if ( ! $bar.length || ! $topbar.length ) return;

		$( '#mjml-float-undo-btn' ).on( 'click', function( e ) {
			e.preventDefault();
			$( '#mjml-undo-btn' ).trigger( 'click' );
		} );

		$( '#mjml-float-convert-btn' ).on( 'click', function() {
			$( '#mjml-convert-btn' ).trigger( 'click' );
		} );

		// Bound directly rather than proxied, so the "Copied!" feedback lands on
		// the button the user actually clicked.
		$( '#mjml-float-copy-btn' ).on( 'click', function() {
			copyToClipboard( lastCompiledHtml, $( this ), mjmlEb.i18n.copy );
		} );

		function setVisible( visible ) {
			$bar.prop( 'hidden', ! visible );
			$( 'body' ).toggleClass( 'mjml-eb-has-float-actions', visible );
		}

		if ( typeof IntersectionObserver === 'function' ) {
			new IntersectionObserver( function( entries ) {
				setVisible( ! entries[0].isIntersecting );
			} ).observe( $topbar[0] );
		} else {
			$( window ).on( 'scroll.mjmlFloat resize.mjmlFloat', function() {
				setVisible( $topbar[0].getBoundingClientRect().bottom < 0 );
			} ).trigger( 'scroll.mjmlFloat' );
		}
	} )();

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
		copyToClipboard( buildMjmlDoc( { markers: false } ), $( this ), 'Copy MJML' );
	} );

	function copyToClipboard( text, $btn, resetLabel ) {
		if ( ! text ) return;

		function confirmCopied() {
			$btn.text( mjmlEb.i18n.copied );
			setTimeout( function() { $btn.text( resetLabel ); }, 2000 );
		}

		// Fallback for browsers without the async clipboard API — and for when it
		// rejects (an unfocused document or a denied permission), which otherwise
		// left the button silently doing nothing.
		function copyViaTextarea() {
			var $ta = $( '<textarea style="position:fixed;opacity:0">' ).val( text ).appendTo( 'body' );
			$ta[0].select();
			var ok = false;
			try { ok = document.execCommand( 'copy' ); } catch ( e ) {}
			$ta.remove();
			if ( ok ) confirmCopied();
			else      setStatus( mjmlEb.i18n.error + 'could not copy to the clipboard', 'error' );
		}

		if ( navigator.clipboard && navigator.clipboard.writeText ) {
			navigator.clipboard.writeText( text ).then( confirmCopied, copyViaTextarea );
		} else {
			copyViaTextarea();
		}
	}

	// ── Topbar overflow menu ─────────────────────────────────────────────────
	// Holds the secondary actions (Copy MJML, Clear all content). Their own click
	// handlers stay where they are; this only opens and closes the popover.
	( function initMoreMenu() {
		var $btn  = $( '#mjml-more-btn' );
		var $menu = $( '#mjml-more-menu' );
		if ( ! $btn.length || ! $menu.length ) return;

		function close() {
			$menu.prop( 'hidden', true );
			$btn.attr( 'aria-expanded', 'false' );
		}

		$btn.on( 'click', function( e ) {
			e.stopPropagation();
			var open = $menu.prop( 'hidden' );
			$menu.prop( 'hidden', ! open );
			$btn.attr( 'aria-expanded', open ? 'true' : 'false' );
		} );

		// Clicking an item runs its own handler and then closes the menu.
		$menu.on( 'click', '.mjml-more-item', function() { close(); } );

		$( document ).on( 'mousedown', function( e ) {
			if ( ! $menu.prop( 'hidden' ) && ! $( e.target ).closest( '.mjml-eb-more' ).length ) close();
		} );

		$( document ).on( 'keydown', function( e ) {
			if ( e.key === 'Escape' && ! $menu.prop( 'hidden' ) ) {
				close();
				$btn.trigger( 'focus' );
			}
		} );
	} )();

	// ── Resizable builder / preview split ────────────────────────────────────
	// The preview column's width is a CSS custom property on .mjml-eb-layout, so
	// dragging only ever writes one value. It's remembered per browser.
	( function initLayoutResizer() {
		var PREVIEW_W_KEY  = 'mjmlEbPreviewWidth';
		var DEFAULT_W      = 600;
		var MIN_PREVIEW_W  = 260;
		var MIN_BUILDER_W  = 360; // keep the block list usable

		var layout   = document.querySelector( '.mjml-eb-layout' );
		var $resizer = $( '.mjml-eb-resizer' );
		if ( ! layout || ! $resizer.length ) return;

		function store( key, val ) {
			try {
				if ( val === null ) localStorage.removeItem( key );
				else                localStorage.setItem( key, val );
			} catch ( e ) {} // private mode / storage disabled — width just won't persist
		}

		function read( key ) {
			try { return localStorage.getItem( key ); } catch ( e ) { return null; }
		}

		function clamp( width ) {
			var max = layout.getBoundingClientRect().width - MIN_BUILDER_W;
			return Math.max( MIN_PREVIEW_W, Math.min( width, Math.max( MIN_PREVIEW_W, max ) ) );
		}

		function apply( width ) {
			layout.style.setProperty( '--mjml-preview-w', clamp( width ) + 'px' );
		}

		function currentWidth() {
			var panel = document.getElementById( 'mjml-output-panel' );
			return panel ? panel.getBoundingClientRect().width : DEFAULT_W;
		}

		var saved = parseFloat( read( PREVIEW_W_KEY ) );
		if ( isFinite( saved ) && saved > 0 ) apply( saved );

		// Drag: the preview is the right-hand column, so its width grows as the
		// pointer moves left.
		$resizer.on( 'pointerdown', function( e ) {
			if ( e.button !== 0 ) return;
			e.preventDefault();

			var startX = e.clientX;
			var startW = currentWidth();
			try { this.setPointerCapture( e.pointerId ); } catch ( err ) {} // not fatal if unsupported
			$( 'body' ).addClass( 'mjml-eb-resizing' );

			var $handle = $( this );

			function onMove( ev ) {
				apply( startW + ( startX - ev.clientX ) );
			}

			function onUp() {
				$handle.off( 'pointermove', onMove ).off( 'pointerup pointercancel', onUp );
				$( 'body' ).removeClass( 'mjml-eb-resizing' );
				store( PREVIEW_W_KEY, Math.round( currentWidth() ) );
			}

			$handle.on( 'pointermove', onMove ).on( 'pointerup pointercancel', onUp );
		} );

		// Double-click restores the default split.
		$resizer.on( 'dblclick', function() {
			layout.style.removeProperty( '--mjml-preview-w' );
			store( PREVIEW_W_KEY, null );
		} );

		// Keyboard resizing for the focused handle.
		$resizer.on( 'keydown', function( e ) {
			if ( e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' ) return;
			e.preventDefault();
			var step = ( e.shiftKey ? 100 : 20 ) * ( e.key === 'ArrowLeft' ? 1 : -1 );
			apply( currentWidth() + step );
			store( PREVIEW_W_KEY, Math.round( currentWidth() ) );
		} );

		// Keep the width within bounds when the window changes size. Skipped while
		// the layout is stacked (the handle is hidden), where the preview column
		// spans the full width and would otherwise be re-saved as a huge value.
		$( window ).on( 'resize', function() {
			if ( ! $resizer.is( ':visible' ) ) return;
			if ( layout.style.getPropertyValue( '--mjml-preview-w' ) ) apply( currentWidth() );
		} );
	} )();

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
				// Always emit the anchor (not just for nav sections) so any section
				// header can be a link target — e.g. from an Update block.
				var anchor       = block.anchor_id ? '<!-- htmlmin:ignore --><a name="' + esc(block.anchor_id) + '"></a><!-- htmlmin:ignore -->' : '';
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
				var imgWidth = pxLength( block.width );
				return '<mj-section padding="0"><mj-column>' +
					'<mj-image src="' + esc(block.src) + '"' +
					(block.href ? ' href="' + esc(block.href) + '"' : '') +
					(imgWidth ? ' width="' + esc(imgWidth) + '"' : '') +
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
			case 'update':           return renderUpdate( block );
			case 'yahrzeit_list':    return renderYahrzeitList( block );
			case 'vibes':            return renderVibes( block );
			case 'two_images':       return renderTwoImages( block );
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
		var lis   = ( block.items || [] ).filter( function(i) { return ! i.hidden; } ).map( renderServiceItem ).join( '' );
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
		var lis = ( col.items || [] ).filter( function(i) { return ! i.hidden; } ).map( renderServiceItem ).join( '' );
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

	// Read the `color` attribute of an <mj-class name="..."> defined in the theme's
	// mj-attributes (e.g. error_header → "#FFF"). Returns '' if not found. Lets the
	// Update block match its link colour to whatever the chosen highlight style uses,
	// so different styles (red, blue, …) are all supported.
	function mjClassColor( stylesMjml, className ) {
		if ( ! stylesMjml || ! className ) return '';
		var re = /<mj-class\b([^>]*?)\/?>/gi;
		var m;
		while ( ( m = re.exec( stylesMjml ) ) !== null ) {
			var attrs = ' ' + m[1];
			var nameM = /\sname\s*=\s*["']([^"']*)["']/i.exec( attrs );
			if ( ! nameM || nameM[1] !== className ) continue;
			// Anchor on whitespace so this doesn't also match `container-background-color`.
			var colorM = /\scolor\s*=\s*["']([^"']*)["']/i.exec( attrs );
			return colorM ? colorM[1] : '';
		}
		return '';
	}

	// Force a colour onto any link that doesn't already declare one. Used by the
	// Update block so in-email anchors show up against the highlight background
	// without baking presentational styles into the saved WYSIWYG content.
	function colorizeLinks( html, color ) {
		if ( ! html ) return html;
		var d = document.createElement( 'div' );
		d.innerHTML = html;
		Array.prototype.forEach.call( d.querySelectorAll( 'a' ), function( a ) {
			var existing = a.getAttribute( 'style' ) || '';
			if ( /color\s*:/i.test( existing ) ) return; // respect a manual colour
			a.setAttribute( 'style', ( existing ? existing.replace( /;?\s*$/, '; ' ) : '' ) + 'color:' + color );
		} );
		return d.innerHTML;
	}

	function renderUpdate( block ) {
		var cls = block.highlight_class ? ' mj-class="' + esc( block.highlight_class ) + '"' : '';
		// Match link colour to the highlight style's text colour from the theme
		// (e.g. error_header → #FFF). Leave links alone if the style sets no colour.
		var linkColor = mjClassColor( activeTheme.styles, block.highlight_class );
		var content   = linkColor ? colorizeLinks( block.content || '', linkColor ) : ( block.content || '' );
		return '<mj-section><mj-column>' +
			'<mj-spacer height="10px" />' +
			'<mj-text' + cls + ' align="left">' + content + '</mj-text>' +
			'<mj-spacer height="20px" />' +
			'</mj-column></mj-section>';
	}

	function renderNoticeList( block ) {
		return '<mj-section padding="0"><mj-column>' +
			'<mj-text padding-top="0" padding-bottom="0">' +
			( block.title ? '<p class="title">' + esc( block.title ) + '</p>' : '' ) +
			( block.content || '' ) +
			'</mj-text></mj-column></mj-section>';
	}

	function renderVibes( block ) {
		var imageRight = block.image_on_right !== false;
		var direction  = imageRight ? '' : ' direction="rtl"';
		var titleHtml  = block.title ? '<h3>' + esc( block.title ) + '</h3>' : '';
		var descHtml   = block.description || '';
		var img2Html   = block.image2_src
			? '<mj-image src="' + esc( block.image2_src ) + '" />'
			: '';
		var imgHtml    = block.image_src
			? '<mj-image' + ( block.image_href ? ' href="' + esc( block.image_href ) + '"' : '' ) + ' src="' + esc( block.image_src ) + '" />'
			: '';
		var btnHtml    = block.button_text
			? '<mj-button href="' + esc( block.button_href || '#' ) + '">' + esc( block.button_text ) + '</mj-button>'
			: '';
		var dividerHtml = block.show_divider !== false
			? '<mj-section><mj-column>' +
				'<mj-spacer height="10px" />' +
				'<mj-divider border-color="#999" />' +
				'<mj-spacer height="5px" />' +
				'</mj-column></mj-section>'
			: '';
		return '<mj-section' + direction + '>' +
				'<mj-column>' +
					'<mj-text>' + titleHtml + descHtml + '</mj-text>' +
					btnHtml +
				'</mj-column>' +
				'<mj-column>' + img2Html + imgHtml + '</mj-column>' +
			'</mj-section>' +
			dividerHtml;
	}

	function renderTwoImages( block ) {
		function col( src, href ) {
			if ( ! src ) return '<mj-column></mj-column>';
			var hrefAttr = href ? ' href="' + esc( href ) + '"' : '';
			return '<mj-column><mj-image src="' + esc( src ) + '"' + hrefAttr + ' /></mj-column>';
		}
		return '<mj-section padding="0">' +
			col( block.left_src,  block.left_href ) +
			col( block.right_src, block.right_href ) +
			'</mj-section>';
	}

	function renderYahrzeitList( block ) {
		var rawLines = ( block.items_text || '' ).split( /\n/ )
			.map( function(l) { return l.trim(); } );
		while ( rawLines.length && ! rawLines[ 0 ].length ) rawLines.shift();
		while ( rawLines.length && ! rawLines[ rawLines.length - 1 ].length ) rawLines.pop();
		if ( ! rawLines.length ) return '';

		var splitIdx = -1;
		for ( var i = 0; i < rawLines.length; i++ ) {
			if ( /^--+$/.test( rawLines[ i ] ) ) { splitIdx = i; break; }
		}
		var leftLines, rightLines;
		if ( splitIdx >= 0 ) {
			leftLines  = rawLines.slice( 0, splitIdx );
			rightLines = rawLines.slice( splitIdx + 1 );
		} else {
			// Auto-split: keep column heights balanced by non-blank line count.
			var nonBlankTotal = 0;
			for ( var n = 0; n < rawLines.length; n++ ) if ( rawLines[ n ].length ) nonBlankTotal++;
			var leftTarget = Math.ceil( nonBlankTotal / 2 );
			var seen = 0, cutAt = rawLines.length;
			for ( var j = 0; j < rawLines.length; j++ ) {
				if ( rawLines[ j ].length ) seen++;
				if ( seen >= leftTarget ) { cutAt = j + 1; break; }
			}
			leftLines  = rawLines.slice( 0, cutAt );
			rightLines = rawLines.slice( cutAt );
		}
		while ( leftLines.length  && ! leftLines [ leftLines.length  - 1 ].length ) leftLines.pop();
		while ( rightLines.length && ! rightLines[ 0 ].length )                     rightLines.shift();
		while ( rightLines.length && ! rightLines[ rightLines.length - 1 ].length ) rightLines.pop();

		var left  = leftLines .map( formatYahrzeitLine ).join( '<br /> ' );
		var right = rightLines.map( formatYahrzeitLine ).join( '<br /> ' );
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

	// *text* → <strong>, _text_ → <em>; escape first so tags survive only where we add them.
	function formatYahrzeitLine( line ) {
		return esc( line )
			.replace( /\*([^*\n]+)\*/g, '<strong>$1</strong>' )
			.replace( /_([^_\n]+)_/g,   '<em>$1</em>' );
	}

	function renderNavbar( navBlock ) {
		var navBlocks = blocks.filter( function(b) { return b.type === 'section_header' && b.include_in_nav && ! b.hidden; } );
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

	// Normalise a user-entered width to pixels. mj-image only handles px reliably,
	// so we keep the number and drop anything else the user typed ("300", "300px"
	// and "300 px" all become "300px"). Blank or non-numeric stays blank.
	function pxLength( val ) {
		var num = parseFloat( String( val || '' ).replace( /[^0-9.]/g, '' ) );
		return ( isFinite( num ) && num > 0 ) ? num + 'px' : '';
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
