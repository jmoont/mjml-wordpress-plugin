<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class MJML_Post_Type {

	const POST_TYPE      = 'mjml_template';
	const STATUS_ARCHIVED = 'mjml_archived';
	const STATUS_TEMPLATE = 'mjml_template';

	public static function register(): void {
		register_post_type( self::POST_TYPE, array(
			'labels'       => array(
				'name'          => __( 'MJML Emails', 'mjml-email-builder' ),
				'singular_name' => __( 'MJML Email', 'mjml-email-builder' ),
			),
			'public'       => false,
			'show_ui'      => false,
			'show_in_menu' => false,
			'supports'     => array( 'title', 'editor', 'author', 'revisions' ),
		) );

		register_post_status( self::STATUS_ARCHIVED, array(
			'label'                     => _x( 'Archived', 'post status', 'mjml-email-builder' ),
			'public'                    => false,
			'internal'                  => false,
			'protected'                 => true,
			'exclude_from_search'       => true,
			'show_in_admin_all_list'    => false,
			'show_in_admin_status_list' => false,
			/* translators: %s: number of archived items. */
			'label_count'               => _n_noop( 'Archived <span class="count">(%s)</span>', 'Archived <span class="count">(%s)</span>', 'mjml-email-builder' ),
		) );

		register_post_status( self::STATUS_TEMPLATE, array(
			'label'                     => _x( 'Template', 'post status', 'mjml-email-builder' ),
			'public'                    => false,
			'internal'                  => false,
			'protected'                 => true,
			'exclude_from_search'       => true,
			'show_in_admin_all_list'    => false,
			'show_in_admin_status_list' => false,
			/* translators: %s: number of template items. */
			'label_count'               => _n_noop( 'Template <span class="count">(%s)</span>', 'Templates <span class="count">(%s)</span>', 'mjml-email-builder' ),
		) );
	}

	public static function on_activation(): void {
		self::register();
		flush_rewrite_rules();
	}

	public static function init(): void {
		add_filter( 'wp_revisions_to_keep',           array( __CLASS__, 'limit_revisions' ), 10, 2 );
		add_action( '_wp_put_post_revision',          array( __CLASS__, 'copy_meta_to_revision' ) );
	}

	public static function limit_revisions( int $num, $post ) {
		if ( $post && self::POST_TYPE === $post->post_type ) return 10;
		return $num;
	}

	public static function copy_meta_to_revision( int $revision_id ): void {
		$parent_id = wp_is_post_revision( $revision_id );
		if ( ! $parent_id ) return;
		$parent = get_post( $parent_id );
		if ( ! $parent || self::POST_TYPE !== $parent->post_type ) return;

		// Snapshot the theme assignment alongside the revision.
		$theme = get_post_meta( $parent_id, MJML_Themes::META_THEME, true );
		if ( $theme ) update_metadata( 'post', $revision_id, MJML_Themes::META_THEME, $theme );
	}
}
