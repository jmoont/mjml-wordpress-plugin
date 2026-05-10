<?php
/**
 * Plugin Name: MJML Email Builder
 * Description: Build MJML email templates with a visual block editor and compile to HTML in the browser.
 * Version: 2.1.1
 * Requires at least: 5.8
 * Requires PHP: 7.4
 * Author: Josh Moont — BES Chair
 * Text Domain: mjml-email-builder
 */

if ( ! function_exists( 'add_action' ) ) {
	exit;
}

define( 'MJML_EB_VERSION', '2.1.1' );
define( 'MJML_EB_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'MJML_EB_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

require_once MJML_EB_PLUGIN_DIR . 'class-mjml-post-type.php';
require_once MJML_EB_PLUGIN_DIR . 'class-mjml-themes.php';

add_action( 'init', array( 'MJML_Post_Type', 'register' ) );
register_activation_hook( __FILE__, array( 'MJML_Post_Type', 'on_activation' ) );

MJML_Post_Type::init();
MJML_Themes::init();

if ( is_admin() ) {
	require_once MJML_EB_PLUGIN_DIR . 'class-mjml-admin.php';
	add_action( 'init', array( 'MJML_Admin', 'init' ) );
}
