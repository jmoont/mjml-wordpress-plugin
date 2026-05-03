<?php if ( ! defined( 'ABSPATH' ) ) exit; ?>
<div class="wrap">
	<h1><?php esc_html_e( 'MJML Builder Settings', 'mjml-email-builder' ); ?></h1>

	<?php if ( isset( $_GET['saved'] ) ) : ?>
		<div class="notice notice-success is-dismissible">
			<p><?php esc_html_e( 'Settings saved.', 'mjml-email-builder' ); ?></p>
		</div>
	<?php endif; ?>

	<p><?php esc_html_e( 'Configure the shared header, footer, and styles used by all templates. These are injected around your block content at compile time.', 'mjml-email-builder' ); ?></p>

	<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
		<input type="hidden" name="action" value="mjml_save_settings">
		<?php wp_nonce_field( MJML_Admin::NONCE_SETTINGS ); ?>

		<h2><?php esc_html_e( 'Global Styles', 'mjml-email-builder' ); ?></h2>
		<p class="description"><?php esc_html_e( 'Contents of <mj-head> — include <mj-font>, <mj-attributes>, <mj-style> etc.', 'mjml-email-builder' ); ?></p>
		<textarea name="mjml_eb_styles" rows="12" class="large-text code"><?php echo esc_textarea( get_option( 'mjml_eb_styles', '' ) ); ?></textarea>

		<h2><?php esc_html_e( 'Global Header', 'mjml-email-builder' ); ?></h2>
		<p class="description"><?php esc_html_e( 'Raw <mj-section> blocks placed at the top of every email, before your template blocks.', 'mjml-email-builder' ); ?></p>
		<textarea name="mjml_eb_header" rows="10" class="large-text code"><?php echo esc_textarea( get_option( 'mjml_eb_header', '' ) ); ?></textarea>

		<h2><?php esc_html_e( 'Global Footer', 'mjml-email-builder' ); ?></h2>
		<p class="description"><?php esc_html_e( 'Raw <mj-section> blocks placed at the bottom of every email, after your template blocks.', 'mjml-email-builder' ); ?></p>
		<textarea name="mjml_eb_footer" rows="10" class="large-text code"><?php echo esc_textarea( get_option( 'mjml_eb_footer', '' ) ); ?></textarea>

		<?php submit_button( __( 'Save Settings', 'mjml-email-builder' ) ); ?>
	</form>
</div>
