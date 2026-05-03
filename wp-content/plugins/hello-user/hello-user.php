<?php
/**
 * Plugin Name: Hello User
 * Description: Displays a greeting in the WordPress admin.
 * Version: 1.0.0
 */

add_action( 'admin_notices', function () {
    $name = wp_get_current_user()->display_name;
    echo '<div class="notice notice-info"><p><strong>Hello ' . esc_html( $name ) . '!</strong></p></div>';
} );
