<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class MJML_Admin {

	const NONCE_SAVE        = 'mjml_eb_save_template';
	const NONCE_CACHE       = 'mjml_eb_cache_html';
	const NONCE_DELETE      = 'mjml_eb_delete_template';
	const NONCE_DUPLICATE   = 'mjml_eb_duplicate_template';
	const NONCE_SETTINGS    = 'mjml_eb_settings';
	const NONCE_THEME       = 'mjml_eb_theme';
	const NONCE_IMPORT      = 'mjml_eb_import';
	const NONCE_ARCHIVE     = 'mjml_eb_archive';
	const NONCE_UNDO        = 'mjml_eb_undo';

	private static bool $initiated = false;

	public static function init(): void {
		if ( self::$initiated ) return;
		self::$initiated = true;

		add_action( 'admin_menu',            array( __CLASS__, 'register_menus' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_assets' ) );

		add_action( 'wp_ajax_mjml_save_template',     array( __CLASS__, 'ajax_save_template' ) );
		add_action( 'wp_ajax_mjml_cache_html',        array( __CLASS__, 'ajax_cache_html' ) );
		add_action( 'wp_ajax_mjml_delete_template',   array( __CLASS__, 'ajax_delete_template' ) );
		add_action( 'wp_ajax_mjml_duplicate_template',array( __CLASS__, 'ajax_duplicate_template' ) );
		add_action( 'wp_ajax_mjml_archive_template',     array( __CLASS__, 'ajax_archive_template' ) );
		add_action( 'wp_ajax_mjml_unarchive_template',   array( __CLASS__, 'ajax_unarchive_template' ) );
		add_action( 'wp_ajax_mjml_templatize_template',  array( __CLASS__, 'ajax_templatize_template' ) );
		add_action( 'wp_ajax_mjml_use_template',         array( __CLASS__, 'ajax_use_template' ) );
		add_action( 'wp_ajax_mjml_get_revisions',     array( __CLASS__, 'ajax_get_revisions' ) );
		add_action( 'wp_ajax_mjml_load_revision',     array( __CLASS__, 'ajax_load_revision' ) );
		add_action( 'admin_post_mjml_save_theme',     array( __CLASS__, 'handle_save_theme' ) );
		add_action( 'admin_post_mjml_delete_theme',   array( __CLASS__, 'handle_delete_theme' ) );
		add_action( 'admin_post_mjml_set_default_theme', array( __CLASS__, 'handle_set_default_theme' ) );
		add_action( 'admin_post_mjml_export',         array( __CLASS__, 'handle_export' ) );
		add_action( 'admin_post_mjml_import',         array( __CLASS__, 'handle_import' ) );
	}

	public static function register_menus(): void {
		add_menu_page(
			__( 'MJML Email Builder', 'mjml-email-builder' ),
			__( 'MJML Builder', 'mjml-email-builder' ),
			'manage_options',
			'mjml-email-builder',
			array( __CLASS__, 'page_list_templates' ),
			'dashicons-email-alt',
			26
		);

		add_submenu_page(
			'mjml-email-builder',
			__( 'Emails', 'mjml-email-builder' ),
			__( 'Emails', 'mjml-email-builder' ),
			'manage_options',
			'mjml-email-builder',
			array( __CLASS__, 'page_list_templates' )
		);

		add_submenu_page(
			'mjml-email-builder',
			__( 'Settings', 'mjml-email-builder' ),
			__( 'Settings', 'mjml-email-builder' ),
			'manage_options',
			'mjml-eb-settings',
			array( __CLASS__, 'page_settings' )
		);

		// Hidden edit page — no parent = not shown in menu
		add_submenu_page(
			null,
			__( 'Edit Email', 'mjml-email-builder' ),
			'',
			'manage_options',
			'mjml-eb-edit',
			array( __CLASS__, 'page_edit_template' )
		);
	}

	public static function enqueue_assets( string $hook_suffix ): void {
		$list_hook = 'toplevel_page_mjml-email-builder';
		$edit_hook = 'admin_page_mjml-eb-edit';
		$settings_hook = 'mjml-builder_page_mjml-eb-settings';

		$plugin_hooks = array( $list_hook, $edit_hook, $settings_hook );

		if ( ! in_array( $hook_suffix, $plugin_hooks, true ) ) {
			return;
		}

		wp_enqueue_style(
			'mjml-eb-admin',
			MJML_EB_PLUGIN_URL . 'assets/admin.css',
			array(),
			MJML_EB_VERSION
		);

		$js_deps = array( 'jquery', 'jquery-ui-sortable' );

		if ( $edit_hook === $hook_suffix ) {
			// MJML browser compiler — loaded from CDN
			wp_enqueue_script(
				'mjml-browser',
				'https://cdn.jsdelivr.net/npm/mjml-browser@4.18.0/lib/index.js',
				array(),
				null,
				true
			);
			$js_deps[] = 'mjml-browser';

			// WordPress media library
			wp_enqueue_media();

			// TinyMCE for HTML blocks — 'editor' loads wp.editor.initialize()
			wp_enqueue_editor();
			$js_deps[] = 'editor';
		}

		if ( $settings_hook === $hook_suffix ) {
			// MJML browser compiler — powers the theme "Sample preview" on Settings.
			wp_enqueue_script(
				'mjml-browser',
				'https://cdn.jsdelivr.net/npm/mjml-browser@4.18.0/lib/index.js',
				array(),
				null,
				true
			);
			// Theme import/split + sample-preview helper (Settings page only).
			wp_enqueue_script(
				'mjml-eb-settings',
				MJML_EB_PLUGIN_URL . 'assets/settings.js',
				array( 'jquery', 'mjml-browser' ),
				MJML_EB_VERSION,
				true
			);
		}

		wp_enqueue_script(
			'mjml-eb-admin',
			MJML_EB_PLUGIN_URL . 'assets/admin.js',
			$js_deps,
			MJML_EB_VERSION,
			true
		);

		$template_id   = isset( $_GET['id'] ) ? absint( $_GET['id'] ) : 0;
		$blocks_json   = '[]';
		$theme_id      = MJML_Themes::default_id();
		$compiled_html = '';
		if ( $template_id ) {
			$post = get_post( $template_id );
			if ( $post && MJML_Post_Type::POST_TYPE === $post->post_type ) {
				$blocks_json   = $post->post_content ?: '[]';
				$theme_id      = MJML_Themes::get_id_for_post( $template_id );
				$compiled_html = (string) get_post_meta( $template_id, 'mjml_compiled_html', true );
			}
		}

		// Build a JS-friendly theme list ({id, name, styles, header, footer}) so we can
		// switch the active theme client-side without a round-trip.
		$themes_js = array();
		foreach ( MJML_Themes::all() as $tid => $t ) {
			$themes_js[] = array(
				'id'     => $tid,
				'name'   => $t['name'],
				'styles' => $t['styles'],
				'header' => $t['header'],
				'footer' => $t['footer'],
			);
		}

		// NOTE: not using wp_localize_script — it runs html_entity_decode() on every
		// scalar, which corrupts blocksJson when user content contains HTML entities
		// like &quot; (common in pasted Word/Outlook markup with data-* attributes).
		$mjml_eb = array(
			'ajaxUrl'       => admin_url( 'admin-ajax.php' ),
			'nonces'        => array(
				'save'      => wp_create_nonce( self::NONCE_SAVE ),
				'cache'     => wp_create_nonce( self::NONCE_CACHE ),
				'delete'    => wp_create_nonce( self::NONCE_DELETE ),
				'duplicate' => wp_create_nonce( self::NONCE_DUPLICATE ),
				'archive'   => wp_create_nonce( self::NONCE_ARCHIVE ),
				'undo'      => wp_create_nonce( self::NONCE_UNDO ),
			),
			'themes'        => $themes_js,
			'activeTheme'   => $theme_id,
			'blocksJson'    => $blocks_json,
			'compiledHtml'  => $compiled_html,
			'i18n'          => array(
				'saving'     => __( 'Saving…', 'mjml-email-builder' ),
				'saved'      => __( 'All changes saved', 'mjml-email-builder' ),
				'converting' => __( 'Compiling…', 'mjml-email-builder' ),
				'copied'     => __( 'Copied!', 'mjml-email-builder' ),
				'copy'       => __( 'Copy HTML', 'mjml-email-builder' ),
				'error'      => __( 'Error: ', 'mjml-email-builder' ),
				'confirmDel' => __( 'Delete this email?', 'mjml-email-builder' ),
				'unsaved'    => __( 'Unsaved changes', 'mjml-email-builder' ),
			),
		);
		wp_add_inline_script(
			'mjml-eb-admin',
			'var mjmlEb = ' . wp_json_encode( $mjml_eb ) . ';',
			'before'
		);
	}

	// ── Page callbacks ────────────────────────────────────────────────────────

	public static function page_list_templates(): void {
		if ( ! current_user_can( 'manage_options' ) ) wp_die();

		$status_param = isset( $_GET['status'] ) ? sanitize_key( wp_unslash( $_GET['status'] ) ) : '';
		switch ( $status_param ) {
			case 'archived':
				$current_status = MJML_Post_Type::STATUS_ARCHIVED;
				break;
			// Template feature disabled (v2.4.3): the 'template' route is no longer
			// served — superseded by the per-block hide toggle. Backend handlers and
			// the post status remain registered so existing template posts persist.
			default:
				$current_status = 'publish';
		}

		$templates = get_posts( array(
			'post_type'      => MJML_Post_Type::POST_TYPE,
			'posts_per_page' => -1,
			'post_status'    => $current_status,
			'orderby'        => 'modified',
			'order'          => 'DESC',
		) );

		$counts    = wp_count_posts( MJML_Post_Type::POST_TYPE );
		$count_pub = (int) ( $counts->publish ?? 0 );
		$count_arc = isset( $counts->{MJML_Post_Type::STATUS_ARCHIVED} ) ? (int) $counts->{MJML_Post_Type::STATUS_ARCHIVED} : 0;
		$count_tpl = isset( $counts->{MJML_Post_Type::STATUS_TEMPLATE} ) ? (int) $counts->{MJML_Post_Type::STATUS_TEMPLATE} : 0;

		include MJML_EB_PLUGIN_DIR . 'views/list-templates.php';
	}

	public static function page_edit_template(): void {
		if ( ! current_user_can( 'manage_options' ) ) wp_die();
		$template_id = isset( $_GET['id'] ) ? absint( $_GET['id'] ) : 0;
		$template    = $template_id ? get_post( $template_id ) : null;
		if ( $template && MJML_Post_Type::POST_TYPE !== $template->post_type ) {
			wp_die( esc_html__( 'Invalid template.', 'mjml-email-builder' ) );
		}
		$compiled_html = $template ? get_post_meta( $template_id, 'mjml_compiled_html', true ) : '';
		include MJML_EB_PLUGIN_DIR . 'views/edit-template.php';
	}

	public static function page_settings(): void {
		if ( ! current_user_can( 'manage_options' ) ) wp_die();
		include MJML_EB_PLUGIN_DIR . 'views/settings.php';
	}

	// ── AJAX handlers ─────────────────────────────────────────────────────────

	public static function ajax_save_template(): void {
		check_ajax_referer( self::NONCE_SAVE, 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => __( 'Insufficient permissions.', 'mjml-email-builder' ) ), 403 );
		}

		$title    = sanitize_text_field( wp_unslash( $_POST['title'] ?? '' ) );
		$blocks   = wp_unslash( $_POST['blocks'] ?? '[]' );
		$post_id  = absint( $_POST['post_id'] ?? 0 );
		$theme_id = sanitize_key( wp_unslash( $_POST['theme_id'] ?? '' ) );

		if ( empty( $title ) ) {
			wp_send_json_error( array( 'message' => __( 'Template name is required.', 'mjml-email-builder' ) ) );
		}

		// Validate blocks is valid JSON
		$decoded = json_decode( $blocks );
		if ( json_last_error() !== JSON_ERROR_NONE ) {
			wp_send_json_error( array( 'message' => __( 'Invalid block data.', 'mjml-email-builder' ) ) );
		}

		// wp_insert_post / wp_update_post call wp_unslash() on their input internally,
		// so we have to pass slashed data — otherwise JSON escape sequences like \" get
		// stripped a second time and the stored block JSON becomes unparseable.
		$post_data = array(
			'post_title'   => wp_slash( $title ),
			'post_content' => wp_slash( $blocks ),
			'post_status'  => 'publish',
			'post_type'    => MJML_Post_Type::POST_TYPE,
		);

		if ( $post_id > 0 ) {
			$existing = get_post( $post_id );
			if ( ! $existing || MJML_Post_Type::POST_TYPE !== $existing->post_type ) {
				wp_send_json_error( array( 'message' => __( 'Template not found.', 'mjml-email-builder' ) ), 404 );
			}
			// Preserve template/archived status when editing — saving shouldn't promote to publish.
			$post_data['post_status'] = $existing->post_status;
			$post_data['ID'] = $post_id;
			$result = wp_update_post( $post_data, true );
		} else {
			$result = wp_insert_post( $post_data, true );
		}

		if ( is_wp_error( $result ) ) {
			wp_send_json_error( array( 'message' => $result->get_error_message() ) );
		}

		// Persist theme assignment (use default if blank/unknown).
		MJML_Themes::set_for_post( (int) $result, $theme_id );

		wp_send_json_success( array(
			'post_id'  => $result,
			'edit_url' => add_query_arg( array( 'page' => 'mjml-eb-edit', 'id' => $result ), admin_url( 'admin.php' ) ),
		) );
	}

	public static function ajax_cache_html(): void {
		check_ajax_referer( self::NONCE_CACHE, 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( null, 403 );
		}

		$post_id = absint( $_POST['post_id'] ?? 0 );
		$html    = wp_unslash( $_POST['html'] ?? '' );

		if ( ! $post_id ) {
			wp_send_json_success(); // no-op if not saved yet
			return;
		}

		$existing = get_post( $post_id );
		if ( ! $existing || MJML_Post_Type::POST_TYPE !== $existing->post_type ) {
			wp_send_json_error( null, 404 );
		}

		update_post_meta( $post_id, 'mjml_compiled_html', $html );
		update_post_meta( $post_id, 'mjml_last_converted', time() );

		wp_send_json_success();
	}

	public static function ajax_delete_template(): void {
		check_ajax_referer( self::NONCE_DELETE, 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( null, 403 );
		}

		$post_id = absint( $_POST['post_id'] ?? 0 );
		if ( ! $post_id ) {
			wp_send_json_error( array( 'message' => __( 'No template ID.', 'mjml-email-builder' ) ) );
		}

		$existing = get_post( $post_id );
		if ( ! $existing || MJML_Post_Type::POST_TYPE !== $existing->post_type ) {
			wp_send_json_error( array( 'message' => __( 'Template not found.', 'mjml-email-builder' ) ), 404 );
		}

		wp_delete_post( $post_id, true );
		wp_send_json_success();
	}

	public static function ajax_duplicate_template(): void {
		check_ajax_referer( self::NONCE_DUPLICATE, 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( null, 403 );
		}

		$post_id = absint( $_POST['post_id'] ?? 0 );
		$original = $post_id ? get_post( $post_id ) : null;

		if ( ! $original || MJML_Post_Type::POST_TYPE !== $original->post_type ) {
			wp_send_json_error( array( 'message' => __( 'Template not found.', 'mjml-email-builder' ) ), 404 );
		}

		// get_post() returns unslashed data; wp_insert_post will unslash again, so re-slash here.
		$new_id = wp_insert_post( array(
			'post_title'   => wp_slash( $original->post_title . ' (Copy)' ),
			'post_content' => wp_slash( $original->post_content ),
			'post_status'  => 'publish',
			'post_type'    => MJML_Post_Type::POST_TYPE,
		), true );

		if ( is_wp_error( $new_id ) ) {
			wp_send_json_error( array( 'message' => $new_id->get_error_message() ) );
		}

		// Copy post meta — but skip the cached compile output so the copy starts fresh.
		$skip_keys = array( 'mjml_compiled_html', 'mjml_last_converted' );
		$meta      = get_post_meta( $post_id );
		foreach ( $meta as $key => $values ) {
			if ( in_array( $key, $skip_keys, true ) ) continue;
			foreach ( $values as $value ) {
				add_post_meta( $new_id, $key, maybe_unserialize( $value ) );
			}
		}

		wp_send_json_success( array(
			'edit_url' => add_query_arg( array( 'page' => 'mjml-eb-edit', 'id' => $new_id ), admin_url( 'admin.php' ) ),
		) );
	}

	public static function ajax_archive_template(): void {
		self::handle_status_change( MJML_Post_Type::STATUS_ARCHIVED );
	}

	public static function ajax_unarchive_template(): void {
		self::handle_status_change( 'publish' );
	}

	public static function ajax_templatize_template(): void {
		check_ajax_referer( self::NONCE_ARCHIVE, 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( null, 403 );
		}

		$post_id  = absint( $_POST['post_id'] ?? 0 );
		$original = $post_id ? get_post( $post_id ) : null;

		if ( ! $original || MJML_Post_Type::POST_TYPE !== $original->post_type ) {
			wp_send_json_error( array( 'message' => __( 'Email not found.', 'mjml-email-builder' ) ), 404 );
		}
		if ( 'publish' !== $original->post_status ) {
			wp_send_json_error( array( 'message' => __( 'Only published emails can be saved as templates.', 'mjml-email-builder' ) ) );
		}

		$new_id = self::duplicate_post( $original, MJML_Post_Type::STATUS_TEMPLATE, ' (Template)' );
		if ( is_wp_error( $new_id ) ) {
			wp_send_json_error( array( 'message' => $new_id->get_error_message() ) );
		}

		wp_send_json_success( array(
			'edit_url' => add_query_arg( array( 'page' => 'mjml-eb-edit', 'id' => $new_id ), admin_url( 'admin.php' ) ),
		) );
	}

	public static function ajax_use_template(): void {
		check_ajax_referer( self::NONCE_ARCHIVE, 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( null, 403 );
		}

		$post_id  = absint( $_POST['post_id'] ?? 0 );
		$original = $post_id ? get_post( $post_id ) : null;

		if ( ! $original || MJML_Post_Type::POST_TYPE !== $original->post_type ) {
			wp_send_json_error( array( 'message' => __( 'Template not found.', 'mjml-email-builder' ) ), 404 );
		}
		if ( MJML_Post_Type::STATUS_TEMPLATE !== $original->post_status ) {
			wp_send_json_error( array( 'message' => __( 'Source is not a template.', 'mjml-email-builder' ) ) );
		}

		$new_id = self::duplicate_post( $original, 'publish', ' (from template)' );
		if ( is_wp_error( $new_id ) ) {
			wp_send_json_error( array( 'message' => $new_id->get_error_message() ) );
		}

		wp_send_json_success( array(
			'edit_url' => add_query_arg( array( 'page' => 'mjml-eb-edit', 'id' => $new_id ), admin_url( 'admin.php' ) ),
		) );
	}

	/**
	 * Insert a copy of a post with the given status and title suffix, copying
	 * meta (theme assignment etc.) but never the cached compiled HTML.
	 *
	 * @return int|WP_Error new post ID on success, WP_Error on failure.
	 */
	private static function duplicate_post( WP_Post $original, string $status, string $title_suffix ) {
		$new_id = wp_insert_post( array(
			'post_title'   => wp_slash( $original->post_title . $title_suffix ),
			'post_content' => wp_slash( $original->post_content ),
			'post_status'  => $status,
			'post_type'    => MJML_Post_Type::POST_TYPE,
		), true );

		if ( is_wp_error( $new_id ) ) return $new_id;

		$skip_keys = array( 'mjml_compiled_html', 'mjml_last_converted' );
		$meta      = get_post_meta( $original->ID );
		foreach ( $meta as $key => $values ) {
			if ( in_array( $key, $skip_keys, true ) ) continue;
			foreach ( $values as $value ) {
				add_post_meta( $new_id, $key, maybe_unserialize( $value ) );
			}
		}
		return (int) $new_id;
	}

	private static function handle_status_change( string $new_status ): void {
		check_ajax_referer( self::NONCE_ARCHIVE, 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( null, 403 );
		}

		$post_id = absint( $_POST['post_id'] ?? 0 );
		$post    = $post_id ? get_post( $post_id ) : null;
		if ( ! $post || MJML_Post_Type::POST_TYPE !== $post->post_type ) {
			wp_send_json_error( array( 'message' => __( 'Template not found.', 'mjml-email-builder' ) ), 404 );
		}

		// Templates are immutable in status — the only way out of template state is "Use this
		// template" (which creates a new published copy and leaves the template alone) or delete.
		if ( MJML_Post_Type::STATUS_TEMPLATE === $post->post_status ) {
			wp_send_json_error( array( 'message' => __( 'Templates cannot be archived or moved to published. Use "Use this template" or delete instead.', 'mjml-email-builder' ) ) );
		}

		$result = wp_update_post( array(
			'ID'          => $post_id,
			'post_status' => $new_status,
		), true );

		if ( is_wp_error( $result ) ) {
			wp_send_json_error( array( 'message' => $result->get_error_message() ) );
		}

		wp_send_json_success();
	}

	// ── Revisions / undo ──────────────────────────────────────────────────────

	public static function ajax_get_revisions(): void {
		check_ajax_referer( self::NONCE_UNDO, 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( null, 403 );
		}

		$post_id = absint( $_POST['post_id'] ?? 0 );
		if ( ! $post_id ) wp_send_json_success( array( 'revisions' => array() ) );

		$post = get_post( $post_id );
		if ( ! $post || MJML_Post_Type::POST_TYPE !== $post->post_type ) {
			wp_send_json_error( array( 'message' => __( 'Template not found.', 'mjml-email-builder' ) ), 404 );
		}

		$revs = wp_get_post_revisions( $post_id, array( 'posts_per_page' => 10 ) );
		$out  = array();
		foreach ( $revs as $r ) {
			$out[] = array(
				'id'         => $r->ID,
				'date_iso'   => $r->post_date_gmt,
				'date_human' => get_the_modified_date( 'M j · g:ia', $r ),
			);
		}

		wp_send_json_success( array( 'revisions' => $out ) );
	}

	public static function ajax_load_revision(): void {
		check_ajax_referer( self::NONCE_UNDO, 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( null, 403 );
		}

		$rev_id = absint( $_POST['rev_id'] ?? 0 );
		$rev    = $rev_id ? get_post( $rev_id ) : null;
		if ( ! $rev || 'revision' !== $rev->post_type ) {
			wp_send_json_error( array( 'message' => __( 'Revision not found.', 'mjml-email-builder' ) ), 404 );
		}

		$parent = get_post( $rev->post_parent );
		if ( ! $parent || MJML_Post_Type::POST_TYPE !== $parent->post_type ) {
			wp_send_json_error( null, 404 );
		}

		$theme_id = (string) get_post_meta( $rev_id, MJML_Themes::META_THEME, true );
		if ( '' === $theme_id ) $theme_id = MJML_Themes::default_id();

		wp_send_json_success( array(
			'title'       => $rev->post_title,
			'blocks_json' => $rev->post_content,
			'theme_id'    => $theme_id,
		) );
	}

	// ── Theme handlers ────────────────────────────────────────────────────────

	public static function handle_save_theme(): void {
		if ( ! current_user_can( 'manage_options' ) ) wp_die();
		check_admin_referer( self::NONCE_THEME );

		$id   = sanitize_key( wp_unslash( $_POST['theme_id'] ?? '' ) );
		$data = array(
			'name'   => wp_unslash( $_POST['name']   ?? '' ),
			'styles' => wp_unslash( $_POST['styles'] ?? '' ),
			'header' => wp_unslash( $_POST['header'] ?? '' ),
			'footer' => wp_unslash( $_POST['footer'] ?? '' ),
		);
		MJML_Themes::save( $id, $data );

		wp_safe_redirect( add_query_arg(
			array( 'page' => 'mjml-eb-settings', 'saved' => '1' ),
			admin_url( 'admin.php' )
		) );
		exit;
	}

	public static function handle_delete_theme(): void {
		if ( ! current_user_can( 'manage_options' ) ) wp_die();
		check_admin_referer( self::NONCE_THEME );

		$id = sanitize_key( wp_unslash( $_POST['theme_id'] ?? $_GET['theme_id'] ?? '' ) );
		MJML_Themes::delete( $id );

		wp_safe_redirect( add_query_arg(
			array( 'page' => 'mjml-eb-settings', 'deleted' => '1' ),
			admin_url( 'admin.php' )
		) );
		exit;
	}

	public static function handle_set_default_theme(): void {
		if ( ! current_user_can( 'manage_options' ) ) wp_die();
		check_admin_referer( self::NONCE_THEME );

		$id = sanitize_key( wp_unslash( $_POST['theme_id'] ?? $_GET['theme_id'] ?? '' ) );
		MJML_Themes::set_default( $id );

		wp_safe_redirect( add_query_arg(
			array( 'page' => 'mjml-eb-settings', 'default-set' => '1' ),
			admin_url( 'admin.php' )
		) );
		exit;
	}

	// ── Export / Import ───────────────────────────────────────────────────────

	public static function handle_export(): void {
		if ( ! current_user_can( 'manage_options' ) ) wp_die();
		check_admin_referer( self::NONCE_SETTINGS );

		$emails = array();
		$posts  = get_posts( array(
			'post_type'      => MJML_Post_Type::POST_TYPE,
			'posts_per_page' => 10,
			'post_status'    => 'publish',
			'orderby'        => 'modified',
			'order'          => 'DESC',
		) );
		foreach ( $posts as $p ) {
			$emails[] = array(
				'title'         => $p->post_title,
				'blocks'        => $p->post_content,
				'theme'         => MJML_Themes::get_id_for_post( $p->ID ),
				'compiled_html' => (string) get_post_meta( $p->ID, 'mjml_compiled_html', true ),
			);
		}

		$payload = array(
			'version'      => 1,
			'exported_at'  => gmdate( 'c' ),
			'themes'       => MJML_Themes::all(),
			'defaultTheme' => MJML_Themes::default_id(),
			'emails'       => $emails,
		);

		nocache_headers();
		header( 'Content-Type: application/json' );
		header( 'Content-Disposition: attachment; filename="mjml-export-' . gmdate( 'Y-m-d' ) . '.json"' );
		echo wp_json_encode( $payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		exit;
	}

	public static function handle_import(): void {
		if ( ! current_user_can( 'manage_options' ) ) wp_die();
		check_admin_referer( self::NONCE_IMPORT );

		if ( empty( $_FILES['import_file']['tmp_name'] ) ) {
			self::redirect_settings( array( 'import-error' => 'no-file' ) );
		}

		// Cap upload at 5 MB so a malformed/oversized file can't exhaust memory.
		$max_bytes = 5 * 1024 * 1024;
		if ( (int) ( $_FILES['import_file']['size'] ?? 0 ) > $max_bytes ) {
			self::redirect_settings( array( 'import-error' => 'too-large' ) );
		}

		$json = file_get_contents( $_FILES['import_file']['tmp_name'] );
		$data = json_decode( $json, true );
		if ( ! is_array( $data ) ) {
			self::redirect_settings( array( 'import-error' => 'invalid-json' ) );
		}

		// Replace themes wholesale if the import provides them.
		if ( isset( $data['themes'] ) && is_array( $data['themes'] ) ) {
			$clean_themes = array();
			foreach ( $data['themes'] as $tid => $t ) {
				$tid = sanitize_key( $tid );
				if ( '' === $tid ) continue;
				$clean_themes[ $tid ] = array(
					'name'   => sanitize_text_field( $t['name']   ?? $tid ),
					'styles' => (string) ( $t['styles'] ?? '' ),
					'header' => (string) ( $t['header'] ?? '' ),
					'footer' => (string) ( $t['footer'] ?? '' ),
				);
			}
			if ( ! empty( $clean_themes ) ) {
				update_option( MJML_Themes::OPTION_THEMES, $clean_themes, false );
			}
			if ( isset( $data['defaultTheme'] ) ) {
				$default = sanitize_key( $data['defaultTheme'] );
				if ( isset( $clean_themes[ $default ] ) ) {
					update_option( MJML_Themes::OPTION_DEFAULT, $default, false );
				}
			}
		}

		// Append imported emails as new posts (don't overwrite existing).
		$added = 0;
		if ( isset( $data['emails'] ) && is_array( $data['emails'] ) ) {
			foreach ( $data['emails'] as $email ) {
				$title  = sanitize_text_field( $email['title'] ?? '' );
				$blocks = (string) ( $email['blocks'] ?? '[]' );
				if ( '' === $title ) continue;
				$decoded = json_decode( $blocks );
				if ( json_last_error() !== JSON_ERROR_NONE ) continue;

				$new_id = wp_insert_post( array(
					'post_title'   => wp_slash( $title ),
					'post_content' => wp_slash( $blocks ),
					'post_status'  => 'publish',
					'post_type'    => MJML_Post_Type::POST_TYPE,
				), true );
				if ( is_wp_error( $new_id ) ) continue;

				if ( ! empty( $email['theme'] ) ) {
					MJML_Themes::set_for_post( (int) $new_id, sanitize_key( $email['theme'] ) );
				}
				if ( ! empty( $email['compiled_html'] ) ) {
					update_post_meta( $new_id, 'mjml_compiled_html', $email['compiled_html'] );
					update_post_meta( $new_id, 'mjml_last_converted', time() );
				}
				$added++;
			}
		}

		self::redirect_settings( array( 'imported' => $added ) );
	}

	private static function redirect_settings( array $args ): void {
		wp_safe_redirect( add_query_arg(
			array_merge( array( 'page' => 'mjml-eb-settings' ), $args ),
			admin_url( 'admin.php' )
		) );
		exit;
	}
}
