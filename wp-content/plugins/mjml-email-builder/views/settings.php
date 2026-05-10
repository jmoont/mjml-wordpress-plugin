<?php
if ( ! defined( 'ABSPATH' ) ) exit;

$themes      = MJML_Themes::all();
$default_id  = MJML_Themes::default_id();
$edit_id     = isset( $_GET['theme'] ) ? sanitize_key( $_GET['theme'] ) : '';
$is_new      = isset( $_GET['new'] );
$editing     = $is_new ? array( 'name' => '', 'styles' => '', 'header' => '', 'footer' => '' ) : ( $themes[ $edit_id ] ?? null );
?>
<div class="wrap">
	<h1 class="wp-heading-inline"><?php esc_html_e( 'MJML Builder Settings', 'mjml-email-builder' ); ?></h1>

	<?php if ( isset( $_GET['saved'] ) ) : ?>
		<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Theme saved.', 'mjml-email-builder' ); ?></p></div>
	<?php endif; ?>
	<?php if ( isset( $_GET['deleted'] ) ) : ?>
		<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Theme deleted.', 'mjml-email-builder' ); ?></p></div>
	<?php endif; ?>
	<?php if ( isset( $_GET['default-set'] ) ) : ?>
		<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Default theme updated.', 'mjml-email-builder' ); ?></p></div>
	<?php endif; ?>
	<?php if ( isset( $_GET['imported'] ) ) : ?>
		<div class="notice notice-success is-dismissible"><p>
			<?php
			/* translators: %d: number of imported emails. */
			echo esc_html( sprintf( _n( 'Import complete. %d email added.', 'Import complete. %d emails added.', (int) $_GET['imported'], 'mjml-email-builder' ), (int) $_GET['imported'] ) );
			?>
		</p></div>
	<?php endif; ?>
	<?php if ( isset( $_GET['import-error'] ) ) : ?>
		<div class="notice notice-error is-dismissible"><p>
			<?php
			$err  = sanitize_key( $_GET['import-error'] );
			$msgs = array(
				'no-file'      => __( 'No file uploaded.', 'mjml-email-builder' ),
				'too-large'    => __( 'Import file exceeds the 5 MB limit.', 'mjml-email-builder' ),
				'invalid-json' => __( 'Import file is not valid JSON.', 'mjml-email-builder' ),
			);
			echo esc_html( $msgs[ $err ] ?? __( 'Import failed.', 'mjml-email-builder' ) );
			?>
		</p></div>
	<?php endif; ?>

	<?php if ( $editing !== null ) : ?>

		<a href="<?php echo esc_url( admin_url( 'admin.php?page=mjml-eb-settings' ) ); ?>" class="mjml-eb-back">
			<span class="dashicons dashicons-arrow-left-alt2"></span> <?php esc_html_e( 'All themes', 'mjml-email-builder' ); ?>
		</a>

		<h2><?php echo $is_new ? esc_html__( 'New theme', 'mjml-email-builder' ) : esc_html( sprintf( __( 'Edit theme: %s', 'mjml-email-builder' ), $editing['name'] ) ); ?></h2>

		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="mjml_save_theme">
			<input type="hidden" name="theme_id" value="<?php echo esc_attr( $is_new ? '' : $edit_id ); ?>">
			<?php wp_nonce_field( MJML_Admin::NONCE_THEME ); ?>

			<table class="form-table">
				<tr>
					<th scope="row"><label for="mjml-theme-name"><?php esc_html_e( 'Theme name', 'mjml-email-builder' ); ?></label></th>
					<td><input id="mjml-theme-name" name="name" type="text" class="regular-text" value="<?php echo esc_attr( $editing['name'] ); ?>" required></td>
				</tr>
			</table>

			<h3><?php esc_html_e( 'Global Styles', 'mjml-email-builder' ); ?></h3>
			<p class="description"><?php esc_html_e( 'Contents of <mj-head> — include <mj-font>, <mj-attributes>, <mj-style> etc.', 'mjml-email-builder' ); ?></p>
			<textarea name="styles" rows="12" class="large-text code"><?php echo esc_textarea( $editing['styles'] ); ?></textarea>

			<h3><?php esc_html_e( 'Global Header', 'mjml-email-builder' ); ?></h3>
			<p class="description"><?php esc_html_e( 'Raw <mj-section> blocks placed at the top of every email, before your template blocks.', 'mjml-email-builder' ); ?></p>
			<textarea name="header" rows="10" class="large-text code"><?php echo esc_textarea( $editing['header'] ); ?></textarea>

			<h3><?php esc_html_e( 'Global Footer', 'mjml-email-builder' ); ?></h3>
			<p class="description"><?php esc_html_e( 'Raw <mj-section> blocks placed at the bottom of every email, after your template blocks.', 'mjml-email-builder' ); ?></p>
			<textarea name="footer" rows="10" class="large-text code"><?php echo esc_textarea( $editing['footer'] ); ?></textarea>

			<?php submit_button( $is_new ? __( 'Create theme', 'mjml-email-builder' ) : __( 'Save theme', 'mjml-email-builder' ) ); ?>
		</form>

	<?php else : ?>

		<a href="<?php echo esc_url( admin_url( 'admin.php?page=mjml-eb-settings&new=1' ) ); ?>" class="page-title-action"><?php esc_html_e( 'Add Theme', 'mjml-email-builder' ); ?></a>
		<hr class="wp-header-end">

		<h2><?php esc_html_e( 'Themes', 'mjml-email-builder' ); ?></h2>
		<p class="description"><?php esc_html_e( 'Each theme is a set of global styles, header, and footer. Emails inherit the default theme unless you choose another on the email edit page.', 'mjml-email-builder' ); ?></p>

		<table class="wp-list-table widefat fixed striped">
			<thead>
				<tr>
					<th class="column-primary"><?php esc_html_e( 'Name', 'mjml-email-builder' ); ?></th>
					<th><?php esc_html_e( 'ID', 'mjml-email-builder' ); ?></th>
					<th style="width:160px"></th>
				</tr>
			</thead>
			<tbody>
				<?php foreach ( $themes as $tid => $t ) :
					$is_default = ( $tid === $default_id );
					$edit_url   = add_query_arg( array( 'page' => 'mjml-eb-settings', 'theme' => $tid ), admin_url( 'admin.php' ) );
				?>
				<tr>
					<td class="column-primary">
						<strong><a href="<?php echo esc_url( $edit_url ); ?>"><?php echo esc_html( $t['name'] ); ?></a></strong>
						<?php if ( $is_default ) : ?>
							<span class="mjml-default-badge"><?php esc_html_e( 'Default', 'mjml-email-builder' ); ?></span>
						<?php endif; ?>
					</td>
					<td><code><?php echo esc_html( $tid ); ?></code></td>
					<td>
						<?php if ( ! $is_default ) : ?>
							<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline">
								<input type="hidden" name="action" value="mjml_set_default_theme">
								<input type="hidden" name="theme_id" value="<?php echo esc_attr( $tid ); ?>">
								<?php wp_nonce_field( MJML_Admin::NONCE_THEME ); ?>
								<button class="button-link" type="submit"><?php esc_html_e( 'Set as default', 'mjml-email-builder' ); ?></button>
							</form>
							&middot;
							<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline" onsubmit="return confirm('<?php echo esc_js( __( 'Delete this theme?', 'mjml-email-builder' ) ); ?>');">
								<input type="hidden" name="action" value="mjml_delete_theme">
								<input type="hidden" name="theme_id" value="<?php echo esc_attr( $tid ); ?>">
								<?php wp_nonce_field( MJML_Admin::NONCE_THEME ); ?>
								<button class="button-link mjml-link-danger" type="submit"><?php esc_html_e( 'Delete', 'mjml-email-builder' ); ?></button>
							</form>
						<?php endif; ?>
					</td>
				</tr>
				<?php endforeach; ?>
			</tbody>
		</table>

		<hr style="margin:30px 0">

		<h2><?php esc_html_e( 'Export & Import', 'mjml-email-builder' ); ?></h2>
		<p class="description"><?php esc_html_e( 'Export bundles all themes plus the 10 most recently modified emails. Import overrides current themes and appends emails to your library.', 'mjml-email-builder' ); ?></p>

		<div class="mjml-eb-impexp">
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="mjml-eb-impexp-block">
				<input type="hidden" name="action" value="mjml_export">
				<?php wp_nonce_field( MJML_Admin::NONCE_SETTINGS ); ?>
				<h3><?php esc_html_e( 'Export', 'mjml-email-builder' ); ?></h3>
				<p><button type="submit" class="button button-primary"><?php esc_html_e( 'Download export file', 'mjml-email-builder' ); ?></button></p>
			</form>

			<form method="post" enctype="multipart/form-data" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="mjml-eb-impexp-block">
				<input type="hidden" name="action" value="mjml_import">
				<?php wp_nonce_field( MJML_Admin::NONCE_IMPORT ); ?>
				<h3><?php esc_html_e( 'Import', 'mjml-email-builder' ); ?></h3>
				<p>
					<input type="file" name="import_file" accept="application/json,.json" required>
					<button type="submit" class="button"><?php esc_html_e( 'Import', 'mjml-email-builder' ); ?></button>
				</p>
				<p class="description"><?php esc_html_e( 'Themes will be replaced. Emails will be added (existing emails are not modified).', 'mjml-email-builder' ); ?></p>
			</form>
		</div>

	<?php endif; ?>
</div>
