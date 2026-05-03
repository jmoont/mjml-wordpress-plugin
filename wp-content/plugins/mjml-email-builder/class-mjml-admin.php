<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class MJML_Admin {

	const NONCE_SAVE      = 'mjml_eb_save_template';
	const NONCE_CACHE     = 'mjml_eb_cache_html';
	const NONCE_DELETE    = 'mjml_eb_delete_template';
	const NONCE_DUPLICATE = 'mjml_eb_duplicate_template';
	const NONCE_SETTINGS  = 'mjml_eb_settings';

	private static bool $initiated = false;

	public static function init(): void {
		if ( self::$initiated ) return;
		self::$initiated = true;

		add_action( 'admin_menu',            array( __CLASS__, 'register_menus' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_assets' ) );

		add_action( 'wp_ajax_mjml_save_template',    array( __CLASS__, 'ajax_save_template' ) );
		add_action( 'wp_ajax_mjml_cache_html',        array( __CLASS__, 'ajax_cache_html' ) );
		add_action( 'wp_ajax_mjml_delete_template',  array( __CLASS__, 'ajax_delete_template' ) );
		add_action( 'wp_ajax_mjml_duplicate_template', array( __CLASS__, 'ajax_duplicate_template' ) );
		add_action( 'admin_post_mjml_save_settings', array( __CLASS__, 'handle_save_settings' ) );
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
				'https://cdn.jsdelivr.net/npm/mjml-browser@4/lib/index.js',
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

		wp_enqueue_script(
			'mjml-eb-admin',
			MJML_EB_PLUGIN_URL . 'assets/admin.js',
			$js_deps,
			MJML_EB_VERSION,
			true
		);

		$template_id = isset( $_GET['id'] ) ? absint( $_GET['id'] ) : 0;
		$blocks_json = '[]';
		if ( $template_id ) {
			$post = get_post( $template_id );
			if ( $post && MJML_Post_Type::POST_TYPE === $post->post_type ) {
				$blocks_json = $post->post_content ?: '[]';
			}
		}

		wp_localize_script( 'mjml-eb-admin', 'mjmlEb', array(
			'ajaxUrl'       => admin_url( 'admin-ajax.php' ),
			'editPageUrl'   => admin_url( 'admin.php?page=mjml-eb-edit' ),
			'nonces'        => array(
				'save'      => wp_create_nonce( self::NONCE_SAVE ),
				'cache'     => wp_create_nonce( self::NONCE_CACHE ),
				'delete'    => wp_create_nonce( self::NONCE_DELETE ),
				'duplicate' => wp_create_nonce( self::NONCE_DUPLICATE ),
			),
			'globalHeader'  => get_option( 'mjml_eb_header', '' ),
			'globalFooter'  => get_option( 'mjml_eb_footer', '' ),
			'globalStyles'  => get_option( 'mjml_eb_styles', '' ),
			'blocksJson'    => $blocks_json,
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
		) );
	}

	// ── Page callbacks ────────────────────────────────────────────────────────

	public static function page_list_templates(): void {
		if ( ! current_user_can( 'manage_options' ) ) wp_die();
		$templates = get_posts( array(
			'post_type'      => MJML_Post_Type::POST_TYPE,
			'posts_per_page' => -1,
			'post_status'    => 'publish',
			'orderby'        => 'modified',
			'order'          => 'DESC',
		) );
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

		$title   = sanitize_text_field( wp_unslash( $_POST['title'] ?? '' ) );
		$blocks  = wp_unslash( $_POST['blocks'] ?? '[]' );
		$post_id = absint( $_POST['post_id'] ?? 0 );

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
			$post_data['ID'] = $post_id;
			$result = wp_update_post( $post_data, true );
		} else {
			$result = wp_insert_post( $post_data, true );
		}

		if ( is_wp_error( $result ) ) {
			wp_send_json_error( array( 'message' => $result->get_error_message() ) );
		}

		wp_send_json_success( array(
			'post_id'  => $result,
			'message'  => __( 'Template saved.', 'mjml-email-builder' ),
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

		// Copy post meta (excluding internal WP meta)
		$meta = get_post_meta( $post_id );
		foreach ( $meta as $key => $values ) {
			foreach ( $values as $value ) {
				add_post_meta( $new_id, $key, maybe_unserialize( $value ) );
			}
		}
		// Clear the compiled HTML on the copy so it starts fresh
		delete_post_meta( $new_id, 'mjml_compiled_html' );
		delete_post_meta( $new_id, 'mjml_last_converted' );

		wp_send_json_success( array(
			'edit_url' => add_query_arg( array( 'page' => 'mjml-eb-edit', 'id' => $new_id ), admin_url( 'admin.php' ) ),
		) );
	}

	public static function handle_save_settings(): void {
		if ( ! current_user_can( 'manage_options' ) ) wp_die();
		check_admin_referer( self::NONCE_SETTINGS );

		update_option( 'mjml_eb_header', wp_unslash( $_POST['mjml_eb_header'] ?? '' ), false );
		update_option( 'mjml_eb_footer', wp_unslash( $_POST['mjml_eb_footer'] ?? '' ), false );
		update_option( 'mjml_eb_styles', wp_unslash( $_POST['mjml_eb_styles'] ?? '' ), false );

		wp_safe_redirect( add_query_arg(
			array( 'page' => 'mjml-eb-settings', 'saved' => '1' ),
			admin_url( 'admin.php' )
		) );
		exit;
	}
}
