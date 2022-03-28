
// - Requires -

const fs = require( 'fs' );
const pathJoin = require( 'path' ).join;

const WebAppServer = require( "./WebAppServer.js" );
const TranslationsManager = require( "./TranslationsManager.js" );
const serverUtils = require( "./serverUtils.js" );

// - Global variables -

const CONFIG_PATH = "./config/config.json";
let config = null;

const translationsManager = new TranslationsManager( './translations/' );
let currentTranslation = {};

let webAppServer = null;

let isAppEnding = false;
let exitAction = null;
const EXIT_NO_ACTION = 0;
const EXIT_ERROR = 1;

const fileExtensions = {
	'txt': { mode: 'plain_text' },
	'h': { mode: 'c_cpp' },
	'hpp': { mode: 'c_cpp' },
	'c': { mode: 'c_cpp' },
	'cpp': { mode: 'c_cpp' },
	'js': { mode: 'javascript' },
	'json': { mode: 'json' },
	'py': { mode: 'python' },
	'tsv': { mode: 'plain_text' },
	'csv': { mode: 'plain_text' },
	'md': { mode: 'markdown' }
}

const ignoredFileNames = [
	'node_modules'
];

// - Main code -

initServer();

// - End of main code -


// - Functions -

function initServer() {

	process.on( "SIGINT", function() {

		console.log( "  SIGINT Signal Received, shutting down" );

		beginAppTermination( EXIT_NO_ACTION );

	} );

	// Load config
	config = serverUtils.loadFileJSON( CONFIG_PATH, "utf8" );
	if ( config === null ) {

		console.log( "Error loading config file " + CONFIG_PATH + ". Please check its syntax." );
		process.exit( 0 );

	}

	checkConfig();

	createWebServer();

}

function checkConfig() {

	let modified = false;

	function checkField( field, defaultValue ) {

		if ( config[ field ] === undefined ) {

			modified = true;
			config[ field ] = defaultValue;

		}

	}

	const thisVersion = 1;

	// Remove old fields
	//checkField( "numberOfCameras", undefined );

	// Version specific checks
	/*
	if ( config.version < ... ) {
		...
	}
	*/


	/*
	checkField( "cameraFile", "/dev/video0" );

	if ( config.cameraWidth === undefined || config.cameraHeight === undefined ) {

		config.cameraWidth = 640;
		config.cameraHeight = 480;

		modified = true;

	}

	checkField( "cameraFPS", 5 );
	*/

	checkField( "version", thisVersion );

	if ( modified ) saveConfig();

}

function saveConfig() {

	fs.writeFileSync( CONFIG_PATH, JSON.stringify( config, null, 4 ), "latin1" );

}

function createWebServer() {

	webAppServer = new WebAppServer( console.log );
	webAppServer.start( {
		"host": "",
		"listenPort": 8093,
		"connectionTimeout": 1000000,
		"restrictToLocalHost": true
	}, {
		onStartServer: function() {
			console.log( "Web server started." );
		},
		onClientConnection: function( client ) {

			client.socket.onerror = function( data ) {

				console.log( "WS Error: " + data );

			};

			client.socket.onmessage = function( data ) {

				const message = JSON.parse( data.data );

				if ( message ) {

					console.log( "Client message: " + data.data );

					switch ( message.type ) {

						case 'exit':
							beginAppTermination( EXIT_NO_ACTION );
							break;

						case 'getTranslation':

							const translation = translationsManager.loadTranslation( message.localeLanguageAbbreviation );

							if ( ! translation ) {

								error( client, "Error loading translation file for language " + message.localeLanguageAbbreviation );
								return;

							}

							currentTranslation = translation;

							client.socket.send( JSON.stringify( {
								type: 'translation',
								translation: translation
							} ) );

							break;

						case 'saveConfig':
							config = message.config;
							saveConfig();
							break;

						case 'loadProject':
							loadProject( client, message.projectName );
							break;

						case 'loadFile':
							loadIDEFile( client, message.projectName, message.fullPath );
							break;

						case 'saveFile':
							saveIDEFile( client, message.projectName, message.fullPath, message.contents );
							break;

						default:
							break;

					}

				}

			};

			client.socket.send( JSON.stringify( {
				type: 'init',
				config: config,
				fileExtensions: fileExtensions
			} ) );

		},
		onClientDisconnection: function() {
		}
	} );
}

function loadProject( client, projectName ) {

	if ( ! projectName || ! config.projects[ projectName ] ) return error( client, currentTranslation[ "Could not open project named: " ] + projectName );

	const project = config.projects[ projectName ];

	const filesPaths = scanProjectFiles( project.path );

	filesPaths.sort( ( a, b ) => {

		function sortByField( field, a, b ) {

			if ( a[field ] === b[ field ] ) return 0;

			return a[field ] < b[ field ] ? - 1 : 1;

		}

		const byPath = sortByField( 'path', a, b );
		if ( byPath !== 0 ) return byPath;

		return sortByField( 'fileName', a, b );

	} );

	client.socket.send( JSON.stringify( {
		type: 'projectFiles',
		projectName: projectName,
		filesPaths: filesPaths
	} ) );

}

function loadIDEFile( client, projectName, fullPath ) {

	const project = config.projects[ projectName ];
	if ( ! project ) return error( client, currentTranslation[ "Error: project not found opening file: " ] + fullPath );

	if ( ! serverUtils.isBeneath( fullPath,  project.path  ) ) return error( client, currentTranslation[ "Error: directory traversal." ] );

	const contents = serverUtils.loadFile( fullPath, "utf8" ); //TODO
	if ( contents === null ) return error( client, currentTranslation[ "Error loading file: " ] + fullPath );

	client.socket.send( JSON.stringify( {
		type: 'fileContents',
		fullPath: fullPath,
		contents: contents
	} ) );

}

function saveIDEFile( client, projectName, fullPath, contents ) {

	const project = config.projects[ projectName ];
	if ( ! project ) return error( client, currentTranslation[ "Error: project not found saving file: " ] + fullPath );

	if ( ! serverUtils.isBeneath( fullPath,  project.path  ) ) return error( client, currentTranslation[ "Error: directory traversal." ] );

	const success = serverUtils.saveFile( fullPath, contents, "utf8" );
	if ( ! success ) return error( client, currentTranslation[ "Error saving file: " ] + fullPath );

}

function scanProjectFiles( projectPath ) {

	const filesPaths = [];

	function scanDirectory( base, path ) {

		const files = fs.readdirSync( pathJoin( base, path ) );
		if ( ! files ) return;

		for ( var i = 0, n = files.length; i < n; i++ ) {

			const fileName = files[ i ];

			if ( ignoredFileNames.includes( fileName ) ) continue;

			const filePath = pathJoin( path, fileName );
			const fullPath = pathJoin( base, filePath );
			const stat = fs.statSync( fullPath );

			if ( stat.isDirectory() ) {

				scanDirectory( base, filePath );

			}
			else if ( stat.isFile() ) {

				const extension = fileExtensions[ serverUtils.getFilenameExtension( fileName ).toLowerCase() ];
				if ( ! extension ) continue;
				filesPaths.push( {
					path: path,
					fileName: fileName,
					fullPath: fullPath
				} );

			}

		}

	}

	scanDirectory( projectPath, '' );

	return filesPaths;

}

function info( client, text ) {

	client.socket.send( JSON.stringify( {
		type: 'info',
		text: text
	} ) );

}

function warning( client, text ) {

	client.socket.send( JSON.stringify( {
		type: 'warning',
		text: text
	} ) );

}

function error( client, text ) {

	client.socket.send( JSON.stringify( {
		type: 'error',
		text: text
	} ) );

}

function beginAppTermination( action ) {

	exitAction = action;

/*
	if ( cap ) {

		isAppEnding = true;

		//...

		finish();

	}
	else {

		finish();

	}

	shutdownCamera();
*/

	finish();

}

function finish() {

	//stopTelegram();

	function salute( err ) {

		if ( ! err ) console.log( "Application terminated successfully. Have a nice day." );
		else console.log( "Application terminated With error. Have a nice day." );

	}

	switch ( exitAction ) {

		case EXIT_NO_ACTION:
			salute( false );
			process.exit( 0 );
			break;

		case EXIT_ERROR:
			salute( true );
			process.exit( 0 );
			break;

		default:
			console.log( "Unknown exit code." );
			salute( false );
			process.exit( 0 );
			break;

	}

}
