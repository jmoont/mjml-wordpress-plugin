<?php
if ( ! defined( 'ABSPATH' ) ) exit;
$is_template = $template && MJML_Post_Type::STATUS_TEMPLATE === $template->post_status;
?>
<div class="wrap mjml-eb-wrap">

	<div class="mjml-eb-topbar">
		<a href="<?php echo esc_url( admin_url( 'admin.php?page=mjml-email-builder' ) ); ?>" class="mjml-eb-back">
			<span class="dashicons dashicons-arrow-left-alt2"></span> <?php esc_html_e( 'Emails', 'mjml-email-builder' ); ?>
		</a>
		<input type="hidden" id="mjml-post-id" value="<?php echo esc_attr( $template ? $template->ID : 0 ); ?>">
		<input type="hidden" id="mjml-post-status" value="<?php echo esc_attr( $template ? $template->post_status : 'publish' ); ?>">
		<input type="text" id="mjml-title" class="mjml-eb-title-input"
		       placeholder="<?php esc_attr_e( 'Email name…', 'mjml-email-builder' ); ?>"
		       value="<?php echo esc_attr( $template ? $template->post_title : '' ); ?>" autocomplete="off">
		<span id="mjml-template-badge" class="mjml-eb-template-badge"<?php echo $is_template ? '' : ' hidden'; ?>><?php esc_html_e( 'Template', 'mjml-email-builder' ); ?></span>
		<span id="mjml-status" class="mjml-eb-save-status"></span>
		<div class="mjml-eb-topbar-actions">
			<label class="mjml-eb-theme-label" for="mjml-theme-select"><?php esc_html_e( 'Theme:', 'mjml-email-builder' ); ?></label>
			<select id="mjml-theme-select"></select>
			<button id="mjml-undo-btn" class="button" disabled title="<?php esc_attr_e( 'Undo to a previous saved version', 'mjml-email-builder' ); ?>">
				<span class="dashicons dashicons-undo"></span>
				<?php esc_html_e( 'Undo', 'mjml-email-builder' ); ?>
			</button>
			<button id="mjml-clear-all-btn" class="button" title="<?php esc_attr_e( 'Blank the content of every block (keeps structure)', 'mjml-email-builder' ); ?>">
				<?php esc_html_e( 'Clear all content', 'mjml-email-builder' ); ?>
			</button>
			<?php /* Template feature disabled (v2.4.3): "Save as template" / "Use this template" removed from the UI — superseded by the per-block hide toggle. Backend handlers remain so existing template posts are preserved. */ ?>
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
					'navbar'           => 'Navbar',
					'section_header'   => 'Section Header',
					'update'           => 'Update',
					'text'             => 'Text',
					'image'            => 'Image',
					'button'           => 'Button',
					'divider'          => 'Divider',
					'spacer'           => 'Spacer',
					'shabbat_times'    => 'Shabbat Times',
					'service_list'    => 'Service List',
					'service_list_two' => 'Two-Col Services',
					'notice_list'      => 'Notice List',
					'yahrzeit_list'    => 'Yahrzeit List',
					'vibes'            => 'Feature',
					'two_images'       => 'Two-Col Images',
					'raw'              => 'Raw MJML',
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
