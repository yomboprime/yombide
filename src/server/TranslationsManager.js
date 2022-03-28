
const pathJoin = require( 'path' ).join;

const serverUtils = require( "./serverUtils.js" );

class TranslationManager {

	constructor( translationsPath ) {

		this.translationsPath = translationsPath;

		this.languagesAbbreviations = [
			'es',
			'en'
		];

	}

	loadTranslation( languageAbbreviation ) {

		if ( ! this.languagesAbbreviations.includes( languageAbbreviation ) ) return null;

		const path = pathJoin( this.translationsPath, languageAbbreviation + '.json' );

		const translation = serverUtils.loadFileJSON( path );

		if ( ! translation ) return null;

		return translation;

	}

}

module.exports = TranslationManager;