
// Global variables

let socket;

let config;
let fileExtensions;
let translation;

let filesPaths = [];
let openedFiles = {};

let editorDIV;
let editor;
let iconBarDIV;
let infoBarDIV;
let fileBarDIV;

let closeFileButton;

const ICON_BAR_HEIGHT = 45;
const INFO_BAR_HEIGHT = 30;
const FILE_BAR_WIDTH = 450;

let filesList;

let refreshProjectFilePathToOpen;
let editorIsDirty = false;
let loadedFilesAreDirty = false;


// Main code

init();


// Functions

function init() {

	initNetwork();

}

function initNetwork() {

	const location = document.location;

	socket = new WebSocket( "ws://" + location.host );

	socket.onopen = function() {
		console.log( "Connection open." );
	};

	socket.onerror = function( data ) {
		console.log( "Connection Error: " + data );
	};

	socket.onclose = function() {
		console.log( "Connection Closed." );
	};


	socket.onmessage = function wsOnMessage( e ) {

		processMessage( e.data );

	};

}

function processMessage( data ) {

	//if ( data instanceof ArrayBuffer ) {
	if ( data instanceof Blob ) {

		// Binary message

		//console.log( "Binary message." );

		//socket.send( '{ "frame": true }' );

	}
	else {

		// JSON message

		const message = JSON.parse( data );
		if ( ! message ) {

			console.warn( "Error parsing JSON WebSockets message." );
			return;

		}

		console.log( message );

		switch ( message.type ) {

			case 'init':
				config = message.config;
				fileExtensions = message.fileExtensions;
				socket.send( JSON.stringify( { type: "getTranslation", localeLanguageAbbreviation: config.ideLocaleLanguageAbbreviation } ) );
				break;

			case 'translation':
				translation = message.translation;
				initGUI();
				break;

			case 'projectFiles':
				receiveProjectFiles( message );
				break;

			case 'fileContents':
				receiveFileContents( message );
				break;

			default:
				break;

		}

	}

}

function openProjectFunc() {

	config.currentProject = "prueba1";

	refreshProject();

}

function closeFileFunc() {

	if ( closeFileButton.disabled || ! config.currentProject ) return;
	const openedFileToBeClosed = openedFiles[ config.projects[ config.currentProject ].currentShownFile ];
	if ( ! openedFileToBeClosed ) return;

	showFile( null );

	openedFiles[ openedFileToBeClosed.fullPath ] = undefined;
	if ( filesList ) filesList.updateDirtyFlags();


}

function refreshProject() {

	if ( config.currentProject === null ) return;

	refreshProjectFilePathToOpen = config.projects[ config.currentProject ].currentShownFile;

	closeCurrentProject( () => {

		openProject( config.currentProject );

	} );

}

function openProject( projectName ) {

	socket.send( JSON.stringify( {

		type: "loadProject",
		projectName: projectName

	} ) );

}

function closeCurrentProject( onClosed ) {

	showFile( null );

	// TODO

	onClosed();

}

function openFile( file ) {

	const openedFile = openedFiles[ file.fullPath ];

	if ( ! openedFile ) {

		requestOpenFile( file.fullPath );
		return;

	}

	showFile( file );

}

function showFile( file ) {

	// file is the opened file to show or it is null (to close current file)

	saveEditorFileToMemory();

	if ( file ) {

		config.projects[ config.currentProject ].currentShownFile = file.fullPath;
		const openedFile = openedFiles[ file.fullPath ];
		editor.session.setMode( "ace/mode/" + getEditorMode( file.fileName ) );
		editorIsDirty = true;
		editor.setValue( openedFile.contents );
		editor.navigateFileStart();

		setButtonDisabled( closeFileButton, false );

	}
	else {

		config.projects[ config.currentProject ].currentShownFile = null;
		editor.session.setMode( "ace/mode/" + getEditorMode( '.txt' ) );
		editorIsDirty = true;
		editor.setValue( "" );
		if ( filesList ) filesList.unselectRow();

		setButtonDisabled( closeFileButton, true );

	}

	editorIsDirty = false;

}

function saveEditorFileToMemory() {

	if ( ! editorIsDirty ) return;

	const previousFilePath = config.projects[ config.currentProject ].currentShownFile;
	if ( previousFilePath ) {

		const previousFile = findFilePath( previousFilePath );
		if ( previousFile ) {

			const previousOpenedFile = openedFiles[ previousFile.fullPath ];
			if ( previousOpenedFile ) {

				previousOpenedFile.contents = editor.getValue();
				previousOpenedFile.dirty = true;
				loadedFilesAreDirty = true;

			}

		}

	}

	editorIsDirty = false;

}

function saveAllFiles() {

	saveEditorFileToMemory();

	const keys = Object.keys( openedFiles );
	for ( let i = 0, n = keys.length; i < n; i ++ ) {

		const openedFile = openedFiles[ keys[ i ] ];

		if ( openedFile.dirty ) {

			requestSaveFile( openedFile.fullPath, openedFile.contents );
			openedFile.dirty = false;

		}

	}

	if ( filesList ) filesList.updateDirtyFlags();

}

function getEditorMode( fileName ) {

	const extension = fileExtensions[ getFilenameExtension( fileName ).toLowerCase() ];

	if ( ! extension ) return "plain_text";

	return extension.mode;
}

function getFilenameExtension( path ) {

	path = path || "";

	const pathLastIndexOfDot = path.lastIndexOf( "." );

	if ( pathLastIndexOfDot > 0 && path.length > pathLastIndexOfDot + 1 ) {

		return path.substring( pathLastIndexOfDot + 1 );

	}
	else return "";

}

function requestOpenFile( fullPath ) {

	socket.send( JSON.stringify( {

		type: "loadFile",
		projectName: config.currentProject,
		fullPath: fullPath

	} ) );

}

function requestSaveFile( fullPath, contents ) {

	socket.send( JSON.stringify( {

		type: "saveFile",
		projectName: config.currentProject,
		fullPath: fullPath,
		contents: contents

	} ) );
}

function receiveProjectFiles( message ) {

	config.currentProject = message.projectName;
	filesPaths = message.filesPaths;

	config.projects[ config.currentProject ].currentShownFile = refreshProjectFilePathToOpen;
	refreshProjectFilePathToOpen = null;

	recreateFilesList();

}

function receiveFileContents( message ) {

	const filePath = findFilePath( message.fullPath );

	if ( ! filePath ) return;

	openedFiles[ message.fullPath ] = {
		fullPath: message.fullPath,
		contents: message.contents,
		dirty: false
	};

	showFile( filePath );

}

function findFilePath( fullPath ) {

	for ( let i = 0, n = filesPaths.length; i < n; i ++ ) {

		const file = filesPaths[ i ];
		if ( file.fullPath === fullPath ) return file;

	}

	return null;

}

function recreateFilesList() {

	if ( filesList && fileBarDIV.contains( filesList.div ) ) fileBarDIV.removeChild( filesList.div );

	const tableDiv = document.createElement( 'div' );
	tableDiv.style.width = '100%';
	tableDiv.style.height = '100%';
	const scrolledDiv = createScrolledDiv( tableDiv );
	fileBarDIV.appendChild( scrolledDiv );

	const table = document.createElement( 'table' );
	table.style.width = '100%';
	table.style.height = '100%';
	tableDiv.appendChild( table );

	const tableHeaderRow = document.createElement( 'tr' );
	table.appendChild( tableHeaderRow );

	const columns = [ 'displayPath', 'fileName' ];
	const columnsNames = [ 'Path', 'File name' ];

	function createHeaderCell( name ) {

		const h = document.createElement( 'th' );
		h.innerHTML = name;
		tableHeaderRow.appendChild( h );

	}

	createHeaderCell( iconEmojis[ 'Floppy' ] );
	for ( let c in columns ) createHeaderCell( columnsNames[ c ] );

	const currentShownFile = config.currentProject ? config.projects[ config.currentProject ].currentShownFile : "";

	let selectedRow = null;
	let selectedDataRow = null;
	let preselectedDataRow = null;

	let tableDataRows = [];
	for ( let r = 0, n = filesPaths.length; r < n; r ++ ) {

		const row = filesPaths[ r ];

		row.displayPath = row.path.length < 20 ? row.path : "..." + row.path.substring( row.path.length - 20 );

		createRow( r );

	}

	if ( preselectedDataRow ) {

		preselectedDataRow.doClick();
		preselectedDataRow.scrollIntoView();

	}

	function unselectRow() {

		if ( selectedRow === null ) return;

		if ( selectedDataRow !== null ) styleRow( selectedDataRow, false );

		selectedRow = null;
		selectedDataRow = null;

	}

	function styleRow( dataRow, selected ) {

		for ( let i = 0, n = dataRow.children.length; i < n; i ++ ) {

			dataRow.children[ i ].style.color = selected ? 'cyan' : 'white';

		}

	}

	function createRow( index ) {

		function rowClicked() {

			if ( selectedDataRow !== null ) styleRow( selectedDataRow, false );

			selectedRow = index;
			selectedDataRow = tableDataRow;

			styleRow( selectedDataRow, true );

			openFile( filesPaths[ selectedRow ] );

		}

		const row = filesPaths[ index ];
		const tableDataRow = document.createElement( 'tr' );

		function createCell( cellContent ) {

			const d = document.createElement( 'td' );
			d.innerHTML = cellContent;
			tableDataRow.appendChild( d );
			return d;

		}

		createCell( " " );
		for ( let c = 0, n = columns.length; c < n; c ++ ) {

			const cellContent = "" + row[ columns[ c ] ];
			const d = createCell( cellContent );
			if ( c === 0 ) d.style.width = "40%";

		}

		tableDataRow.addEventListener( 'click', rowClicked );

		if ( row.fullPath === currentShownFile ) {

			preselectedDataRow = tableDataRow;

		}

		tableDataRow.doClick = rowClicked;

		table.appendChild( tableDataRow );
		tableDataRows.push( tableDataRow );

	}

	function selectPrevious() {

		let i = selectedRow;

		i --;

		if ( i < 0 ) i = tableDataRows.length - 1;

		while ( tableDataRows[ i ].hidden && i >= 0 ) i --;

		if ( i < 0 ) return;

		selectRow( i );

	}
	function selectNext() {

		let i = selectedRow;

		i ++;

		if ( i >= tableDataRows.length ) i = 0;

		while ( tableDataRows[ i ].hidden && i < tableDataRows.length ) i ++;

		if ( i >= tableDataRows.length ) return;

		selectRow( i );

	}

	function updateDirtyFlags() {

		for ( let i = 0, n = filesPaths.length; i < n; i ++ ) {

			const file = filesPaths[ i ];
			const openedFile = openedFiles[ file.fullPath ];
			tableDataRows[ i ].firstChild.innerHTML = openedFile && ( openedFile.dirty || ( editorIsDirty && selectedRow === i ) ) ? iconEmojis[ 'Floppy' ] : " ";
		}

	}

	function selectRow( index ) {

		tableDataRows[ index ].doClick();
		tableDataRows[ index ].scrollIntoView();

	}

	filesList = {
		div: scrolledDiv,
		selectRow: selectRow,
		unselectRow: unselectRow,
		selectPrevious: selectPrevious,
		selectNext: selectNext,
		updateDirtyFlags: updateDirtyFlags
	};

}

function createScrolledDiv( childDiv ) {

	var scrolledDiv = document.createElement( 'div' );
	scrolledDiv.style.overflowY = "scroll";
	scrolledDiv.appendChild( childDiv );
	return scrolledDiv;

}

function createDataList( id, array ) {


	const dataList = document.createElement( 'datalist' );
	dataList.id = id;

	for ( let i in array ) {

		const option = document.createElement( 'option' );
		option.value = array[ i ];
		dataList.appendChild( option );

	}

	return dataList;

}

function initGUI() {

	const openProjectIconPath = './icons/tango/tango/Document-open.svg';
	const refreshProjectIconPath = './icons/tango/tango/View-refresh.svg';
	const saveAllFilesIconPath = './icons/tango/tango/Media-floppy.svg';
	const closeFileIconPath = './icons/tango/tango/Dialog-error-round.svg';

	// Main divs

	iconBarDIV = document.createElement( 'div' );
	infoBarDIV = document.createElement( 'div' );
	fileBarDIV = document.createElement( 'div' );

	iconBarDIV.style.position = 'absolute';
	//iconBarDIV.style.display = 'flex';
	iconBarDIV.style.alignItems = 'left';
	iconBarDIV.style.width = '100%';
	iconBarDIV.style.height = ICON_BAR_HEIGHT + 'px';
	iconBarDIV.style.top = '0px';
	iconBarDIV.style.left = '0px';

	infoBarDIV.style.position = 'absolute';
	infoBarDIV.style.width = '100%';
	infoBarDIV.style.height = INFO_BAR_HEIGHT + 'px';
	infoBarDIV.style.bottom = '0px';
	infoBarDIV.style.left = '0px';

	fileBarDIV.style.position = 'absolute';
	fileBarDIV.style.width = FILE_BAR_WIDTH + 'px';
	fileBarDIV.style.height = '100%';
	fileBarDIV.style.top = ICON_BAR_HEIGHT + 'px';
	fileBarDIV.style.left = "0px";

	editorDIV = document.createElement( 'div' );
	editorDIV.style.fontSize= '18px';
	editorDIV.style.position = 'absolute';
	editorDIV.style.width = '800px';
	editorDIV.style.height = '600px';
	editorDIV.style.top = ICON_BAR_HEIGHT + 'px';
	editorDIV.style.left = FILE_BAR_WIDTH + 'px';


	// Icon bar

	function createButton( iconPath, tooltip, onClick ) {

		const button = document.createElement( 'span' );
		//button.style.flex = '1';
		button.style.width = ICON_BAR_HEIGHT + 'px';
		button.style.height = ICON_BAR_HEIGHT + 'px';
		button.style.marginLeft = '5px';
		button.style.marginRight = '5px';
		const image = document.createElement( 'img' );
		image.src = iconPath;
		button.addEventListener( 'click', onClick, false );
		if ( tooltip ) button.title = tooltip;
		button.appendChild( image );

		return button;

	}

	const refreshProjectButton = createButton( refreshProjectIconPath, translation[ "Refresh files list" ], refreshProject );
	iconBarDIV.appendChild( refreshProjectButton);

	const openProjectButton = createButton( openProjectIconPath, translation[ "Open project" ], openProjectFunc );
	iconBarDIV.appendChild( openProjectButton );

	const saveAllFilesButton = createButton( saveAllFilesIconPath, translation[ "Save all files" ], saveAllFiles );
	iconBarDIV.appendChild( saveAllFilesButton );

	closeFileButton = createButton( closeFileIconPath, translation[ "Close file" ], closeFileFunc );
	setButtonDisabled( closeFileButton, true );
	iconBarDIV.appendChild( closeFileButton );

	document.body.appendChild( iconBarDIV );
	document.body.appendChild( infoBarDIV );
	document.body.appendChild( fileBarDIV );
	document.body.appendChild( editorDIV );

	editor = ace.edit( editorDIV, {
		/*mode: "ace/mode/javascript",
		selectionStyle: "text"*/
	} );

	editor.setTheme( 'ace/theme/ambiance' );
	//editor.setDisplayIndentGuides( false );
	editor.setShowFoldWidgets( false );
	editor.setShowInvisibles( true );
	editor.setPrintMarginColumn( - 1 );
	editor.session.setTabSize( 4 );

	editor.on( 'change', () => {

		const doUpdate = ! editorIsDirty && filesList;

		editorIsDirty = true;

		if ( doUpdate ) filesList.updateDirtyFlags();

	} );

	window.addEventListener( 'resize', onWindowResize );

	onWindowResize();

}

function setButtonDisabled( button, disabled ) {

	if ( disabled ) button.style.opacity = "30%";
	else button.style.opacity = "100%";

	button.disabled = disabled;

}

function onWindowResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;

	const editorWidth = Math.max( 0, w - FILE_BAR_WIDTH );
	const editorHeight = Math.max( 0, h - ICON_BAR_HEIGHT - INFO_BAR_HEIGHT );

	fileBarDIV.style.height = editorHeight + "px";
	fileBarDIV.style.top = ICON_BAR_HEIGHT + "px";
	fileBarDIV.style.left = "0px";

	editorDIV.style.width = editorWidth + "px";
	editorDIV.style.height = editorHeight + "px";

	editor.resize();

}

function createImageURLFromContent( content, type ) {

    return window.URL.createObjectURL( new Blob( [ content ], { type: type } ) );

}

function createPNGFromContent( content ) {

    return createImageURLFromContent( content, "image/png" );

}

function createJPEGFromContent( content ) {

    return createImageURLFromContent( content, "image/jpeg" );

}

function createSVGFromContent( content ) {

    return createImageURLFromContent( content, "image/svg+xml" );

}
