<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class MJML_Post_Type {

	const POST_TYPE = 'mjml_template';

	public static function register(): void {
		register_post_type( self::POST_TYPE, array(
			'labels'       => array(
				'name'          => __( 'MJML Emails', 'mjml-email-builder' ),
				'singular_name' => __( 'MJML Email', 'mjml-email-builder' ),
			),
			'public'       => false,
			'show_ui'      => false,
			'show_in_menu' => false,
			'supports'     => array( 'title', 'editor', 'revisions' ),
		) );
	}

	public static function on_activation(): void {
		self::register();
		flush_rewrite_rules();
	}
}
