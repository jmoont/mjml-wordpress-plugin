<?php if ( ! defined( 'ABSPATH' ) ) exit; ?>
<div class="wrap">
	<h1 class="wp-heading-inline"><?php esc_html_e( 'Emails', 'mjml-email-builder' ); ?></h1>
	<a href="<?php echo esc_url( add_query_arg( array( 'page' => 'mjml-eb-edit' ), admin_url( 'admin.php' ) ) ); ?>"
	   class="page-title-action"><?php esc_html_e( 'Add New Email', 'mjml-email-builder' ); ?></a>
	<hr class="wp-header-end">

	<?php if ( empty( $templates ) ) : ?>
		<div class="mjml-empty-state">
			<span class="dashicons dashicons-email-alt"></span>
			<p><?php esc_html_e( 'No emails yet.', 'mjml-email-builder' ); ?></p>
			<a href="<?php echo esc_url( add_query_arg( array( 'page' => 'mjml-eb-edit' ), admin_url( 'admin.php' ) ) ); ?>"
			   class="button button-primary"><?php esc_html_e( 'Create your first email', 'mjml-email-builder' ); ?></a>
		</div>
	<?php else : ?>
		<table class="wp-list-table widefat fixed striped posts">
			<thead>
				<tr>
					<th class="column-title column-primary"><?php esc_html_e( 'Name', 'mjml-email-builder' ); ?></th>
					<th style="width:160px"><?php esc_html_e( 'Last Modified', 'mjml-email-builder' ); ?></th>
					<th style="width:160px"><?php esc_html_e( 'Last Compiled', 'mjml-email-builder' ); ?></th>
				</tr>
			</thead>
			<tbody>
				<?php foreach ( $templates as $t ) :
					$last_converted = get_post_meta( $t->ID, 'mjml_last_converted', true );
					$edit_url = add_query_arg( array( 'page' => 'mjml-eb-edit', 'id' => $t->ID ), admin_url( 'admin.php' ) );
				?>
				<tr>
					<td class="column-title column-primary">
						<strong><a href="<?php echo esc_url( $edit_url ); ?>"><?php echo esc_html( $t->post_title ); ?></a></strong>
						<div class="row-actions">
							<span class="edit"><a href="<?php echo esc_url( $edit_url ); ?>"><?php esc_html_e( 'Edit', 'mjml-email-builder' ); ?></a> | </span>
							<span class="duplicate"><a href="#" class="mjml-duplicate-template" data-id="<?php echo esc_attr( $t->ID ); ?>"><?php esc_html_e( 'Duplicate', 'mjml-email-builder' ); ?></a> | </span>
							<span class="delete"><a href="#" class="mjml-delete-template" data-id="<?php echo esc_attr( $t->ID ); ?>"><?php esc_html_e( 'Delete', 'mjml-email-builder' ); ?></a></span>
						</div>
					</td>
					<td><?php echo esc_html( get_the_modified_date( 'Y-m-d H:i', $t ) ); ?></td>
					<td><?php echo $last_converted ? esc_html( date_i18n( 'Y-m-d H:i', (int) $last_converted ) ) : '—'; ?></td>
				</tr>
				<?php endforeach; ?>
			</tbody>
		</table>
	<?php endif; ?>
</div>
