<?php
if ( ! defined( 'ABSPATH' ) ) exit;

$is_archived = ( MJML_Post_Type::STATUS_ARCHIVED === $current_status );
$is_template = ( MJML_Post_Type::STATUS_TEMPLATE === $current_status );
$is_published = ( ! $is_archived && ! $is_template );

$base_url     = admin_url( 'admin.php?page=mjml-email-builder' );
$archive_url  = add_query_arg( 'status', 'archived', $base_url );
$template_url = add_query_arg( 'status', 'template', $base_url );
?>
<div class="wrap">
	<h1 class="wp-heading-inline"><?php esc_html_e( 'Emails', 'mjml-email-builder' ); ?></h1>
	<a href="<?php echo esc_url( add_query_arg( array( 'page' => 'mjml-eb-edit' ), admin_url( 'admin.php' ) ) ); ?>"
	   class="page-title-action"><?php esc_html_e( 'Add New Email', 'mjml-email-builder' ); ?></a>
	<hr class="wp-header-end">

	<ul class="subsubsub">
		<li><a href="<?php echo esc_url( $base_url ); ?>" class="<?php echo $is_published ? 'current' : ''; ?>">
			<?php esc_html_e( 'Published', 'mjml-email-builder' ); ?> <span class="count">(<?php echo (int) $count_pub; ?>)</span>
		</a> |</li>
		<?php /* Template feature disabled (v2.4.3): "Templates" tab removed — superseded by the per-block hide toggle. */ ?>
		<li><a href="<?php echo esc_url( $archive_url ); ?>" class="<?php echo $is_archived ? 'current' : ''; ?>">
			<?php esc_html_e( 'Archived', 'mjml-email-builder' ); ?> <span class="count">(<?php echo (int) $count_arc; ?>)</span>
		</a></li>
	</ul>

	<?php if ( empty( $templates ) ) : ?>
		<div class="mjml-empty-state">
			<span class="dashicons dashicons-email-alt"></span>
			<p><?php
				if ( $is_archived ) {
					esc_html_e( 'No archived emails.', 'mjml-email-builder' );
				} elseif ( $is_template ) {
					esc_html_e( 'No templates yet. Open any email and choose "Save as template".', 'mjml-email-builder' );
				} else {
					esc_html_e( 'No emails yet.', 'mjml-email-builder' );
				}
			?></p>
			<?php if ( $is_published ) : ?>
				<a href="<?php echo esc_url( add_query_arg( array( 'page' => 'mjml-eb-edit' ), admin_url( 'admin.php' ) ) ); ?>"
				   class="button button-primary"><?php esc_html_e( 'Create your first email', 'mjml-email-builder' ); ?></a>
			<?php endif; ?>
		</div>
	<?php else : ?>
		<table class="wp-list-table widefat fixed striped posts">
			<thead>
				<tr>
					<th class="column-title column-primary"><?php esc_html_e( 'Name', 'mjml-email-builder' ); ?></th>
					<th style="width:140px"><?php esc_html_e( 'Author', 'mjml-email-builder' ); ?></th>
					<th style="width:160px"><?php esc_html_e( 'Last Modified', 'mjml-email-builder' ); ?></th>
					<th style="width:160px"><?php esc_html_e( 'Last Compiled', 'mjml-email-builder' ); ?></th>
				</tr>
			</thead>
			<tbody>
				<?php foreach ( $templates as $t ) :
					$last_converted = get_post_meta( $t->ID, 'mjml_last_converted', true );
					$edit_url       = add_query_arg( array( 'page' => 'mjml-eb-edit', 'id' => $t->ID ), admin_url( 'admin.php' ) );
					$author         = get_user_by( 'id', (int) $t->post_author );
					$author_name    = $author ? $author->display_name : __( '(unknown)', 'mjml-email-builder' );
				?>
				<tr>
					<td class="column-title column-primary">
						<strong><a href="<?php echo esc_url( $edit_url ); ?>"><?php echo esc_html( $t->post_title ); ?></a></strong>
						<div class="row-actions">
							<span class="edit"><a href="<?php echo esc_url( $edit_url ); ?>"><?php esc_html_e( 'Edit', 'mjml-email-builder' ); ?></a> | </span>
							<?php if ( $is_template ) : ?>
								<span class="use-template"><a href="#" class="mjml-use-template" data-id="<?php echo esc_attr( $t->ID ); ?>"><?php esc_html_e( 'Use this template', 'mjml-email-builder' ); ?></a> | </span>
								<span class="delete"><a href="#" class="mjml-delete-template" data-id="<?php echo esc_attr( $t->ID ); ?>"><?php esc_html_e( 'Delete', 'mjml-email-builder' ); ?></a></span>
							<?php elseif ( $is_archived ) : ?>
								<span class="duplicate"><a href="#" class="mjml-duplicate-template" data-id="<?php echo esc_attr( $t->ID ); ?>"><?php esc_html_e( 'Duplicate', 'mjml-email-builder' ); ?></a> | </span>
								<span class="unarchive"><a href="#" class="mjml-unarchive-template" data-id="<?php echo esc_attr( $t->ID ); ?>"><?php esc_html_e( 'Restore', 'mjml-email-builder' ); ?></a> | </span>
								<span class="delete"><a href="#" class="mjml-delete-template" data-id="<?php echo esc_attr( $t->ID ); ?>"><?php esc_html_e( 'Delete permanently', 'mjml-email-builder' ); ?></a></span>
							<?php else : ?>
								<span class="duplicate"><a href="#" class="mjml-duplicate-template" data-id="<?php echo esc_attr( $t->ID ); ?>"><?php esc_html_e( 'Duplicate', 'mjml-email-builder' ); ?></a> | </span>
								<?php /* Template feature disabled (v2.4.3): "Save as template" row action removed. */ ?>
								<span class="archive"><a href="#" class="mjml-archive-template" data-id="<?php echo esc_attr( $t->ID ); ?>"><?php esc_html_e( 'Archive', 'mjml-email-builder' ); ?></a> | </span>
								<span class="delete"><a href="#" class="mjml-delete-template" data-id="<?php echo esc_attr( $t->ID ); ?>"><?php esc_html_e( 'Delete', 'mjml-email-builder' ); ?></a></span>
							<?php endif; ?>
						</div>
					</td>
					<td><?php echo esc_html( $author_name ); ?></td>
					<td><?php echo esc_html( get_the_modified_date( 'Y-m-d H:i', $t ) ); ?></td>
					<td><?php echo $last_converted ? esc_html( date_i18n( 'Y-m-d H:i', (int) $last_converted ) ) : '—'; ?></td>
				</tr>
				<?php endforeach; ?>
			</tbody>
		</table>
	<?php endif; ?>
</div>
