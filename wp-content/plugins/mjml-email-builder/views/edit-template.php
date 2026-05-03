<?php if ( ! defined( 'ABSPATH' ) ) exit; ?>
<div class="wrap mjml-eb-wrap">

	<div class="mjml-eb-topbar">
		<a href="<?php echo esc_url( admin_url( 'admin.php?page=mjml-email-builder' ) ); ?>" class="mjml-eb-back">
			<span class="dashicons dashicons-arrow-left-alt2"></span> <?php esc_html_e( 'Emails', 'mjml-email-builder' ); ?>
		</a>
		<input type="hidden" id="mjml-post-id" value="<?php echo esc_attr( $template ? $template->ID : 0 ); ?>">
		<input type="text" id="mjml-title" class="mjml-eb-title-input"
		       placeholder="<?php esc_attr_e( 'Email name…', 'mjml-email-builder' ); ?>"
		       value="<?php echo esc_attr( $template ? $template->post_title : '' ); ?>" autocomplete="off">
		<span id="mjml-status" class="mjml-eb-save-status"></span>
		<div class="mjml-eb-topbar-actions">
			<button id="mjml-copy-mjml-btn" class="button"><?php esc_html_e( 'Copy MJML', 'mjml-email-builder' ); ?></button>
			<button id="mjml-convert-btn" class="button button-primary"><?php esc_html_e( 'Compile to HTML', 'mjml-email-builder' ); ?></button>
		</div>
	</div>

	<div id="mjml-warnings" class="mjml-eb-warnings" hidden></div>

	<div class="mjml-eb-layout">

		<!-- Block builder -->
		<div class="mjml-eb-builder">

			<div class="mjml-eb-add-blocks">
				<span class="mjml-add-label"><?php esc_html_e( 'Add block', 'mjml-email-builder' ); ?></span>
				<?php
				$block_types = array(
					'navbar'         => 'Navbar',
					'section_header' => 'Section Header',
					'text'           => 'Text',
					'image'          => 'Image',
					'button'         => 'Button',
					'divider'        => 'Divider',
					'spacer'         => 'Spacer',
					'raw'            => 'Raw MJML',
				);
				foreach ( $block_types as $type => $label ) : ?>
					<button class="mjml-add-block button" data-type="<?php echo esc_attr( $type ); ?>">
						+ <?php echo esc_html( $label ); ?>
					</button>
				<?php endforeach; ?>
			</div>

			<div id="mjml-blocks-list"></div>

			<p id="mjml-blocks-empty" class="mjml-empty-blocks">
				<?php esc_html_e( 'No blocks yet — use the buttons above to build your email.', 'mjml-email-builder' ); ?>
			</p>
		</div>

		<!-- HTML output -->
		<div class="mjml-eb-output postbox" id="mjml-output-panel" <?php echo empty( $compiled_html ) ? 'style="display:none"' : ''; ?>>
			<div class="postbox-header">
				<h2><?php esc_html_e( 'Preview', 'mjml-email-builder' ); ?></h2>
				<button id="mjml-copy-btn" class="button"><?php esc_html_e( 'Copy HTML', 'mjml-email-builder' ); ?></button>
			</div>
			<div class="inside">
				<iframe id="mjml-preview-frame"
				        <?php if ( ! empty( $compiled_html ) ) : ?>srcdoc="<?php echo esc_attr( $compiled_html ); ?>"<?php endif; ?>
				        sandbox="allow-same-origin"
				        title="Email preview"></iframe>
			</div>
		</div>

	</div>
</div>
