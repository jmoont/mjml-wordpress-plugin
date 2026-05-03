/* global jQuery, mjmlEb, mjml, wp */
jQuery( function ( $ ) {

	// ── State ────────────────────────────────────────────────────────────────
	var blocks = [];
	try { blocks = JSON.parse( mjmlEb.blocksJson || '[]' ); } catch(e) {}

	// Migrate legacy 'html' blocks to 'text'; backfill section_header spacing defaults
	blocks.forEach( function(b) {
		if ( b.type === 'html' ) b.type = 'text';
		if ( b.type === 'section_header' ) {
			if ( b.padding_top === undefined )    b.padding_top    = '20px';
			if ( b.padding_bottom === undefined ) b.padding_bottom = '20px';
		}
	} );

	var nextId = 1;
	blocks.forEach( function(b) {
		var num = parseInt( (b.id || '').replace( /\D/g, '' ), 10 );
		if ( num >= nextId ) nextId = num + 1;
	} );

	function makeId() { return 'b' + ( nextId++ ); }

	// ── TinyMCE helpers ──────────────────────────────────────────────────────
	var expandedTextBlocks = {}; // { blockId: true } — tracks which text blocks have open editors

	function initTextEditor( blockId ) {
		var editorId = 'mjml-text-' + blockId;
		if ( ! document.getElementById( editorId ) ) return;
		if ( typeof wp === 'undefined' || typeof wp.editor === 'undefined' ) return;
		if ( typeof tinymce !== 'undefined' && tinymce.get( editorId ) ) return;

		wp.editor.initialize( editorId, {
			tinymce: {
				toolbar1:  'bold italic underline | forecolor | alignleft aligncenter alignright | link | bullist numlist | removeformat',
				plugins:   'lists,link,textcolor,colorpicker',
				menubar:   false,
				statusbar: false,
				height:    250,
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

	// ── Auto-save ────────────────────────────────────────────────────────────
	var autoSaveTimer = null;
	var isSaving      = false;
	var isDirty       = false;
	var pendingSave   = false;

	function markDirty() {
		isDirty = true;
		clearTimeout( autoSaveTimer );
		setStatus( mjmlEb.i18n.unsaved, 'unsaved' );
		autoSaveTimer = setTimeout( doSave, 1500 );
	}

	function doSave( onDone ) {
		syncAllTextEditors();
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
			action:  'mjml_save_template',
			nonce:   mjmlEb.nonces.save,
			title:   title,
			blocks:  JSON.stringify( blocks ),
			post_id: $( '#mjml-post-id' ).val(),
		} )
		.done( function( resp ) {
			if ( resp.success ) {
				if ( ! isDirty ) setStatus( mjmlEb.i18n.saved, 'saved' );
				$( '#mjml-post-id' ).val( resp.data.post_id );
				if ( window.history && window.history.replaceState ) {
					window.history.replaceState( {}, '', resp.data.edit_url );
				}
				doCompile( true );
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
			syncAllTextEditors();
			var title = ( $( '#mjml-title' ).val() || '' ).trim() || 'Untitled email';
			var data  = new FormData();
			data.append( 'action',  'mjml_save_template' );
			data.append( 'nonce',   mjmlEb.nonces.save );
			data.append( 'title',   title );
			data.append( 'blocks',  JSON.stringify( blocks ) );
			data.append( 'post_id', $( '#mjml-post-id' ).val() );
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
		navbar:         function() { return { type: 'navbar', id: makeId() }; },
		section_header: function() { return { type: 'section_header', id: makeId(), title: 'Section Title', anchor_id: 'section-title', include_in_nav: true, padding_top: '20px', padding_bottom: '20px' }; },
		text:           function() { return { type: 'text', id: makeId(), content: '<p>Your content here.</p>' }; },
		image:          function() { return { type: 'image', id: makeId(), src: '', href: '' }; },
		button:         function() { return { type: 'button', id: makeId(), text: 'Click Here', href: '#', background_color: '#0047B2' }; },
		divider:        function() { return { type: 'divider', id: makeId(), border_color: '#12142F' }; },
		spacer:         function() { return { type: 'spacer', id: makeId(), height: '20px' }; },
		raw:            function() { return { type: 'raw', id: makeId(), mjml: '<mj-section><mj-column><mj-text>Raw MJML here</mj-text></mj-column></mj-section>' }; },
	};

	var LABELS = {
		navbar: 'Navbar', section_header: 'Section Header', text: 'Text',
		image: 'Image', button: 'Button', divider: 'Divider', spacer: 'Spacer', raw: 'Raw MJML',
	};

	function slugify( str ) {
		return str.toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' );
	}

	// ── Block rendering ──────────────────────────────────────────────────────
	function renderBlock( block ) {
		var label   = LABELS[ block.type ] || block.type;
		var summary = blockSummary( block );

		var $row = $( '<div class="mjml-block-row" data-id="' + block.id + '"></div>' );

		var $header = $(
			'<div class="mjml-block-header">' +
				'<span class="mjml-drag-handle dashicons dashicons-move" title="Drag to reorder"></span>' +
				'<span class="mjml-block-badge mjml-type-' + block.type + '">' + label + '</span>' +
				'<span class="mjml-block-summary"></span>' +
				'<button class="mjml-block-toggle button-link" aria-label="Toggle"><span class="dashicons dashicons-arrow-down-alt2"></span></button>' +
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

	function blockSummary( block ) {
		switch ( block.type ) {
			case 'navbar':         return '(auto-generated from section headers)';
			case 'section_header': return block.title;
			case 'text':           return $( '<div>' ).html( block.content ).text().substring( 0, 80 ) + '…';
			case 'image':          return block.src || '(no image set)';
			case 'button':         return block.text;
			case 'divider':        return 'border: ' + block.border_color;
			case 'spacer':         return 'height: ' + block.height;
			case 'raw':            return '(raw MJML)';
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

	function buildFields( block ) {
		var $f = $( '<div></div>' );

		switch ( block.type ) {
			case 'navbar':
				$f.append( '<p class="mjml-field-note">The navbar is automatically built from Section Header blocks with "Include in nav" checked.</p>' );
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
		}

		return $f;
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
		// Sync and tear down any active TinyMCE instances before clearing the DOM
		syncAllTextEditors();
		blocks.forEach( function(b) {
			if ( b.type === 'text' ) removeTextEditor( b.id );
		} );

		var $list  = $( '#mjml-blocks-list' ).empty();
		var $empty = $( '#mjml-blocks-empty' );

		if ( ! blocks.length ) { $empty.show(); return; }
		$empty.hide();

		blocks.forEach( function(b) { $list.append( renderBlock(b) ); } );

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
			if ( block && block.type === 'text' ) removeTextEditor( id );
			blocks = blocks.filter( function(b) { return b.id !== id; } );
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
		} );

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
			$row[0].scrollIntoView( { behavior: 'smooth', block: 'nearest' } );
		}
		markDirty();
	} );

	// Holds the last compiled HTML for copying
	var lastCompiledHtml = '';

	// ── Compile ──────────────────────────────────────────────────────────────
	function doCompile( silent ) {
		syncAllTextEditors();
		if ( typeof window.mjml !== 'function' ) {
			if ( ! silent ) setStatus( 'MJML library not loaded yet.', 'error' );
			return;
		}
		if ( ! silent ) setStatus( mjmlEb.i18n.converting, 'saving' );
		$( '#mjml-convert-btn' ).prop( 'disabled', true );

		var bodySections = blocks.map( renderBlockToMjml ).join( '\n' );
		var mjmlDoc =
			'<mjml>\n  <mj-head>\n' + ( mjmlEb.globalStyles || '' ) + '\n  </mj-head>\n' +
			'  <mj-body>\n' +
			( mjmlEb.globalHeader || '' ) + '\n' +
			bodySections + '\n' +
			( mjmlEb.globalFooter || '' ) + '\n' +
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

	// ── Copy HTML ────────────────────────────────────────────────────────────
	$( '#mjml-copy-btn' ).on( 'click', function() {
		copyToClipboard( lastCompiledHtml, $( this ), mjmlEb.i18n.copy );
	} );

	// ── Copy MJML ────────────────────────────────────────────────────────────
	$( '#mjml-copy-mjml-btn' ).on( 'click', function() {
		var bodySections = blocks.map( renderBlockToMjml ).join( '\n' );
		var mjmlDoc =
			'<mjml>\n  <mj-head>\n' + ( mjmlEb.globalStyles || '' ) + '\n  </mj-head>\n' +
			'  <mj-body>\n' +
			( mjmlEb.globalHeader || '' ) + '\n' +
			bodySections + '\n' +
			( mjmlEb.globalFooter || '' ) + '\n' +
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

	// ── List page: delete & duplicate ───────────────────────────────────────
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

	// ── MJML generation ──────────────────────────────────────────────────────
	function renderBlockToMjml( block ) {
		switch ( block.type ) {
			case 'navbar':
				return renderNavbar();
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
				return '<mj-section padding="0"><mj-column>' +
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
			default:
				return '';
		}
	}

	function renderNavbar() {
		var navBlocks = blocks.filter( function(b) { return b.type === 'section_header' && b.include_in_nav; } );
		if ( ! navBlocks.length ) return '';
		var links = navBlocks.map( function(b) {
			var label = ( b.nav_label && b.nav_label.length ) ? b.nav_label : b.title;
			return '<mj-navbar-link href="#' + esc(b.anchor_id) + '">' + label + '</mj-navbar-link>';
		} ).join( '\n' );
		return '<mj-section><mj-column><mj-navbar base-url=""><mj-navbar-link text-decoration="none"><strong>Also in this email:</strong></mj-navbar-link>' + links + '</mj-navbar></mj-column></mj-section>';
	}

	function esc( str ) {
		return String( str || '' )
			.replace( /&/g, '&amp;' ).replace( /"/g, '&quot;' )
			.replace( /</g, '&lt;' ).replace( />/g, '&gt;' );
	}

} );
