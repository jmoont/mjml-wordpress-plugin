<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class MJML_Themes {

	const OPTION_THEMES  = 'mjml_eb_themes';
	const OPTION_DEFAULT = 'mjml_eb_default_theme';
	const META_THEME     = 'mjml_eb_theme';

	public static function init(): void {
		add_action( 'init', array( __CLASS__, 'maybe_migrate' ), 5 );
	}

	public static function maybe_migrate(): void {
		if ( false !== get_option( self::OPTION_THEMES, false ) ) return;

		$themes = array(
			'default' => array(
				'name'   => __( 'Default', 'mjml-email-builder' ),
				'styles' => get_option( 'mjml_eb_styles', '' ),
				'header' => get_option( 'mjml_eb_header', '' ),
				'footer' => get_option( 'mjml_eb_footer', '' ),
			),
		);
		update_option( self::OPTION_THEMES, $themes, false );
		update_option( self::OPTION_DEFAULT, 'default', false );

		// Drop the legacy single-theme options now their content lives inside the new structure.
		delete_option( 'mjml_eb_styles' );
		delete_option( 'mjml_eb_header' );
		delete_option( 'mjml_eb_footer' );
	}

	public static function all(): array {
		$themes = get_option( self::OPTION_THEMES, array() );
		return is_array( $themes ) ? $themes : array();
	}

	public static function get( string $id ): array {
		$themes = self::all();
		if ( isset( $themes[ $id ] ) ) return $themes[ $id ];
		$default_id = self::default_id();
		if ( isset( $themes[ $default_id ] ) ) return $themes[ $default_id ];
		return array( 'name' => '', 'styles' => '', 'header' => '', 'footer' => '' );
	}

	public static function default_id(): string {
		$id     = get_option( self::OPTION_DEFAULT, 'default' );
		$themes = self::all();
		if ( isset( $themes[ $id ] ) ) return $id;
		$keys = array_keys( $themes );
		return $keys[0] ?? 'default';
	}

	public static function save( string $id, array $data ): string {
		$themes = self::all();
		$clean  = array(
			'name'   => sanitize_text_field( $data['name'] ?? '' ),
			'styles' => (string) ( $data['styles'] ?? '' ),
			'header' => (string) ( $data['header'] ?? '' ),
			'footer' => (string) ( $data['footer'] ?? '' ),
		);
		if ( '' === $clean['name'] ) {
			$clean['name'] = __( 'Untitled theme', 'mjml-email-builder' );
		}
		if ( '' === $id ) {
			$id = self::generate_id( $clean['name'], $themes );
		}
		$themes[ $id ] = $clean;
		update_option( self::OPTION_THEMES, $themes, false );
		return $id;
	}

	public static function delete( string $id ): bool {
		if ( $id === self::default_id() ) return false;
		$themes = self::all();
		if ( ! isset( $themes[ $id ] ) ) return false;
		unset( $themes[ $id ] );
		update_option( self::OPTION_THEMES, $themes, false );
		return true;
	}

	public static function set_default( string $id ): bool {
		$themes = self::all();
		if ( ! isset( $themes[ $id ] ) ) return false;
		update_option( self::OPTION_DEFAULT, $id, false );
		return true;
	}

	public static function get_id_for_post( int $post_id ): string {
		$theme_id = (string) get_post_meta( $post_id, self::META_THEME, true );
		$themes   = self::all();
		if ( '' !== $theme_id && isset( $themes[ $theme_id ] ) ) return $theme_id;
		return self::default_id();
	}

	public static function set_for_post( int $post_id, string $theme_id ): void {
		if ( '' === $theme_id ) {
			delete_post_meta( $post_id, self::META_THEME );
		} else {
			update_post_meta( $post_id, self::META_THEME, $theme_id );
		}
	}

	private static function generate_id( string $name, array $existing ): string {
		$base = sanitize_title( $name );
		if ( '' === $base ) $base = 'theme';
		$id = $base;
		$i  = 1;
		while ( isset( $existing[ $id ] ) ) {
			$id = $base . '-' . ( ++$i );
		}
		return $id;
	}
}
