
var fs = require('fs');
var path = require('path');
var jParser = require('../../src/jparser.js');

/**
 * GIF (Graphics Interchange Format)
 * GIF87a Specification
 * https://www.w3.org/Graphics/GIF/spec-gif87.txt
 * GIF89a Specification
 * https://www.w3.org/Graphics/GIF/spec-gif89a.txt
 */

/**
 * <GIF Data Stream> ::=     Header <Logical Screen> <Data>* Trailer
 * <Logical Screen> ::=      Logical Screen Descriptor [Global Color Table]
 * <Data> ::=                <Graphic Block>  | <Special-Purpose Block>
 * <Graphic Block> ::=       [Graphic Control Extension] <Graphic-Rendering Block>
 * <Graphic-Rendering Block> ::=  <Table-Based Image>  | Plain Text Extension
 * <Table-Based Image> ::=   Image Descriptor [Local Color Table] Image Data
 * <Special-Purpose Block> ::=    Application Extension  | Comment Extension
**/

function byteToHex(byte) {
	return '0x' + byte.toString(16).toUpperCase().padStart(2, '0');
}

function bytesToHex(bytes) {
	return '[' + bytes.map(byte => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ') + ']';
}

const labelsDef = {
	'ExtensionIntroducer': 0x21,
	// Graphic-Rendering Blocks
	'PlainTextExtension': 0x01,
	'ImageDescriptor': 0x2C,
	// Control Blocks
	'GraphicControlExtension': 0xF9,
	// Special Purpose Blocks
	'Trailer': 0x3B,
	'CommentExtension': 0xFE,
	'ApplicationExtension': 0xFF,
};

const gifParserStructure = {
	Byte: 'uint8',
	Unsigned: 'uint16',
	label: 'Byte',
	rgb: ['array', 'uint8', 3],

	TRY: function (...args) {
		let before = this.tell();
		try {
			return this.parse(...args);
		} catch (error) {
			this.seek(before);
		}
	},
	HEX_BYTE: byte => byteToHex(byte),
	HEX_BYTES: bytes => bytesToHex(bytes),
	FixedByte: function (expectValue, name, format) {
		let value = this.parse('Byte');
		if (value !== expectValue) {
			throw (name || 'Fixed Byte') + ' Exception: expect ' + byteToHex(expectValue) + ', actual ' + byteToHex(value) + ', position: ' + byteToHex(this.tell() - 1);
		}
		return format == 'number' ? value : byteToHex(value);
	},
	FixedByteArray: function (expectBytes) {
		let bytes = this.parse(['array', 'Byte', expectBytes.length]);
		var str = bytesToHex(expectBytes);
		if (bytes.length !== expectBytes.length) {
			throw 'FixedByteArray Exception: expect ' + str + ', actual ' + bytesToHex(bytes) + ', position: ' + byteToHex(this.tell() - 1);
		}
		for (let i = 0; i < expectBytes.length; i++) {
			if (bytes[i] !== expectBytes[i]) {
				throw 'FixedByteArray Exception: expect ' + str + ', actual ' + bytesToHex(bytes) + ', position: ' + byteToHex(this.tell() - 1);
			}
		}
		return str;
	},
	FixedString: function (expectValue, name) {
		let value = this.parse('string', expectValue.length);
		if (value !== expectValue) {
			throw (name || 'Fixed String') + ' Exception: expect ' + expectValue + ', actual ' + value + ', position: ' + byteToHex(this.tell() - 1);
		}
		return value;
	},

	Header: {
		Signature: ['string', 3], //GIF
		Version: ['string', 3], //89a
	},

	ColorTable: function (ColorTableFlag, SizeOfColorTable) {
		// console.log('[function] ColorTable ', ColorTableFlag, SizeOfColorTable);
		if (ColorTableFlag) {
			let unitBitCount = SizeOfColorTable + 1;
			let colorsCount = 1 << unitBitCount;
			// console.log('[function] ColorTable colorsCount: ', colorsCount);
			return this.parse(['array', 'rgb', colorsCount]);
		}
		return null;
	},

	LogicalScreen: function () {
		let Descriptor = this.parse('LogicalScreenDescriptor');
		let { GlobalColorTableFlag, SizeOfGlobalColorTable } = Descriptor.PackedFields;
		let GlobalColorTable = this.parse(['ColorTable', GlobalColorTableFlag, SizeOfGlobalColorTable]);
		return { type: 'LogicalScreen', Descriptor, GlobalColorTable };
	},

	LogicalScreenDescriptor: {
		width: 'Unsigned',
		height: 'Unsigned',
		PackedFields: 'LogicalScreenPackedFields',
		BackgroundColorIndex: 'Byte',
		PixelAspectRatio: 'Byte',
	},

	LogicalScreenPackedFields: {
		GlobalColorTableFlag: 1,
		ColorResolution: 3,
		SortFlag: 1,
		SizeOfGlobalColorTable: 3,
	},

	'Block Terminator': ['FixedByte', 0x00, 'Block Terminator'],
	'Extension Introducer': ['FixedByte', 0x21, 'Extension Introducer'],
	'Graphic Control Label': ['FixedByte', 0xF9, 'Graphic Control Label'],
	'Plain Text Label': ['FixedByte', 0x01, 'Plain Text Label'],
	'Comment Label': ['FixedByte', 0xFE, 'Comment Label'],
	'Extension Label': ['FixedByte', 0xFF, 'Extension Label'],
	Trailer: ['FixedByte', 0x3B, 'Trailer'],

	/**
	 * Appendix
	A. Quick Reference Table.

	Block Name                  Required   Label       Ext.   Vers.
	Application Extension       Opt. (*)   0xFF (255)  yes    89a
	Comment Extension           Opt. (*)   0xFE (254)  yes    89a
	Global Color Table          Opt. (1)   none        no     87a
	Graphic Control Extension   Opt. (*)   0xF9 (249)  yes    89a
	Header                      Req. (1)   none        no     N/A
	Image Descriptor            Opt. (*)   0x2C (044)  no     87a (89a)
	Local Color Table           Opt. (*)   none        no     87a
	Logical Screen Descriptor   Req. (1)   none        no     87a (89a)
	Plain Text Extension        Opt. (*)   0x01 (001)  yes    89a
	Trailer                     Req. (1)   0x3B (059)  no     87a

	Unlabeled Blocks
	Header                      Req. (1)   none        no     N/A
	Logical Screen Descriptor   Req. (1)   none        no     87a (89a)
	Global Color Table          Opt. (1)   none        no     87a
	Local Color Table           Opt. (*)   none        no     87a

	Graphic-Rendering Blocks
	Plain Text Extension        Opt. (*)   0x01 (001)  yes    89a
	Image Descriptor            Opt. (*)   0x2C (044)  no     87a (89a)

	Control Blocks
	Graphic Control Extension   Opt. (*)   0xF9 (249)  yes    89a

	Special Purpose Blocks
	Trailer                     Req. (1)   0x3B (059)  no     87a
	Comment Extension           Opt. (*)   0xFE (254)  yes    89a
	Application Extension       Opt. (*)   0xFF (255)  yes    89a
	*/

	'Data Sub-block': function () {
		let before = this.tell();
		let size = this.parse('Byte');
		if (size === 0) {
			// return { type: 'Block Terminator', size };
			this.seek(before);
		} else {
			let start = this.tell();
			this.skip(size);
			return { type: 'Data Sub-block', size, start };
		}
	},
	'Data Sub-block Array': function () {
		var blocks = [];
		while (true) {
			var block = this.parse('Data Sub-block');
			if (!block) { // Block Terminator
				break;
			}
			blocks.push(block);
		}
		return blocks;
	},
	GraphicControlExtension: {
		'Extension Introducer': 'Extension Introducer', // 0x21
		'Graphic Control Label': ['FixedByte', 0xF9, 'Graphic Control Label'], // 0xF9
		'Block Size': 'Byte',
		'Packed Fields': 'Graphic Control Packed Fields',
		'Delay Time': 'Unsigned',
		'Transparent Color Index': 'Byte',
		'Block Terminator': 'Block Terminator',
	},
	PlainTextExtension: {
		'Extension Introducer': 'Extension Introducer', // 0x21
		'Plain Text Label': ['FixedByte', 0x01, 'Plain Text Label'], // 0x01
		'Block Size': 'Byte',
		'Text Grid Left Position': 'Unsigned',
		'Text Grid Top Position': 'Unsigned',
		'Text Grid Width': 'Unsigned',
		'Text Grid Height': 'Unsigned',
		'Character Cell Width': 'Byte',
		'Character Cell Height': 'Byte',
		'Text Foreground Color Index': 'Byte',
		'Text Background Color Index': 'Byte',
		'Plain Text Data': 'Data Sub-block Array',
		'Block Terminator': 'Block Terminator',
	},
	CommentExtension: {
		'Extension Introducer': 'Extension Introducer', // 0x21
		'Comment Label': ['FixedByte', 0xFE, 'Comment Label'], // 0xFE
		'Comment Data': 'Data Sub-block Array',
		'Block Terminator': 'Block Terminator',
	},
	ApplicationExtension: {
		'Extension Introducer': 'Extension Introducer', // 0x21
		'Extension Label': ['FixedByte', 0xFF, 'Extension Label'], // 0xFF
		'Block Size': 'Byte',
		'Application Identifier': ['string', 8],
		'Authentication Code': ['array', 'Byte', 3], // ['string', 3],
		'Application Data': 'Data Sub-block Array',
		'Block Terminator': 'Block Terminator',
	},
	// Netscape Looping Application Extension (GIF Unofficial Specification)
	// http://www.vurdalakov.net/misc/gif
	// http://www.vurdalakov.net/misc/gif/netscape-looping-application-extension
	// http://www.vurdalakov.net/misc/gif/netscape-buffering-application-extension
	'Netscape Looping Application Extension': {
		'Netscape': () => 'Looping',
		'Name': () => 'Netscape Looping Application Extension',
		'Extension Introducer': 'Extension Introducer', // 0x21
		'Extension Label': ['FixedByte', 0xFF, 'Extension Label'], // 0xFF
		'Block Size': ['FixedByte', 0x0B, 'Extension Label', 'number'], // 0x0B
		'Application Identifier': ['FixedString', 'NETSCAPE'],
		'Authentication Code': ['FixedString', '2.0'],
		// 'Application Data': 'Data Sub-block Array',
		'Application Data': ['array', 'Netscape Looping Sub Block', 1],
		'Block Terminator': 'Block Terminator',
	},
	'Netscape Buffering Application Extension': {
		'Netscape': () => 'Buffering',
		'Name': () => 'Netscape Buffering Application Extension',
		'Extension Introducer': 'Extension Introducer', // 0x21
		'Extension Label': ['FixedByte', 0xFF, 'Extension Label'], // 0xFF
		'Block Size': ['FixedByte', 0x0B, 'Extension Label', 'number'], // 0x0B
		'Application Identifier': ['FixedString', 'NETSCAPE'],
		'Authentication Code': ['FixedString', '2.0'],
		// 'Application Data': 'Data Sub-block Array',
		'Application Data': ['array', 'Netscape Buffering Sub Block', 1],
		'Block Terminator': 'Block Terminator',
	},
	'AnimExts Looping Application Extension': {
		'Netscape': () => 'Looping',
		'Name': () => 'Netscape Looping Application Extension',
		'Extension Introducer': 'Extension Introducer', // 0x21
		'Extension Label': ['FixedByte', 0xFF, 'Extension Label'], // 0xFF
		'Block Size': ['FixedByte', 0x0B, 'Extension Label', 'number'], // 0x0B
		'Application Identifier': ['FixedString', 'ANIMEXTS'], // different from Netscape
		'Authentication Code': ['FixedString', '1.0'], // different from Netscape
		// 'Application Data': 'Data Sub-block Array',
		'Application Data': ['array', 'Netscape Looping Sub Block', 1], //same as Netscape
		'Block Terminator': 'Block Terminator',
	},
	'Netscape Looping Sub Block': {
		type: () => 'Data Sub-block',
		size: ['FixedByte', 0x03, '', 'number'],
		start: function () { return this.tell(); },
		ID: ['FixedByte', 0x01],
		'Loop Count': 'uint16', // unsigned 2-byte integer in little-endian byte order
	},
	'Netscape Buffering Sub Block': {
		type: () => 'Data Sub-block',
		size: ['FixedByte', 0x05, '', 'number'],
		start: function () { return this.tell(); },
		ID: ['FixedByte', 0x02],
		'Buffer Size': 'uint32', // unsigned 4-byte integer in little-endian byte order
	},

	/**
	 * <GIF Data Stream> ::=     Header <Logical Screen> <Data>* Trailer
	 * <Logical Screen> ::=      Logical Screen Descriptor [Global Color Table]
	 * <Data> ::=                <Graphic Block>  | <Special-Purpose Block>
	 * <Graphic Block> ::=       [Graphic Control Extension] <Graphic-Rendering Block>
	 * <Graphic-Rendering Block> ::=  <Table-Based Image>  | Plain Text Extension
	 * <Table-Based Image> ::=   Image Descriptor [Local Color Table] Image Data
	 * <Special-Purpose Block> ::=    Application Extension  | Comment Extension
	**/
	DataBlocks: function DataBlocks() {
		// [Graphic Control Extension] (<Image Descriptor> [Local Color Table] <Image Data>  | <Plain Text Extension>)  | <Special-Purpose Block>
		let ExtensionKeys = ['GraphicControlExtension', 'PlainTextExtension', 'CommentExtension', 'ApplicationExtension'];
		let blocks = [];
		let GraphicBlockIndex = 0;
		while (true) {
			let before = this.tell();
			let Introducer = this.parse('Byte');
			if (Introducer === labelsDef['ImageDescriptor']) {
				// Table-Based Image
				this.seek(before);
				GraphicBlockIndex++;
				let GraphicRenderingBlock = this.parse('TableBasedImage');
				let GraphicBlock = {
					blockType: 'Graphic Block',
					GraphicBlockIndex,
					block: {
						'Graphic Control Extension': null,
						// 'Graphic-Rendering Block Type': 'TableBasedImage',
						'Graphic-Rendering Block': GraphicRenderingBlock,
					}
				};
				blocks.push(GraphicBlock);
				continue;
			} else if (Introducer !== labelsDef['ExtensionIntroducer']) {
				// Not Extension
				this.seek(before);
				break;
			}
			// Extension
			let ExtensionLabel = this.parse('label');
			let ExtensionKey = ExtensionKeys.find(key => labelsDef[key] === ExtensionLabel);
			if (!ExtensionKey) {
				this.seek(before);
				break;
			}
			this.seek(before);
			switch (ExtensionKey) {
				case 'CommentExtension': {
					let CommentExtensionBlock = this.parse(ExtensionKey);
					blocks.push({
						blockType: ExtensionKey,
						ExtensionBlock: CommentExtensionBlock,
					});
					break;
				}
				case 'ApplicationExtension': {
					let ApplicationExtensionBlock = this.parse(ExtensionKey);
					if (ApplicationExtensionBlock['Application Identifier'] == 'NETSCAPE') {
						this.seek(before);
						let NetscapeLoopingExtension = this.parse('TRY', 'Netscape Looping Application Extension');
						if (NetscapeLoopingExtension) {
							ApplicationExtensionBlock = NetscapeLoopingExtension;
						} else {
							let NetscapeBufferingExtension = this.parse('TRY', 'Netscape Buffering Application Extension');
							if (NetscapeBufferingExtension) {
								ApplicationExtensionBlock = NetscapeBufferingExtension;
							}
						}
					} else if (ApplicationExtensionBlock['Application Identifier'] == 'AnimExts') {
						this.seek(before);
						let AnimExtsLoopingExtension = this.parse('TRY', 'AnimExts Looping Application Extension');
						if (AnimExtsLoopingExtension) {
							ApplicationExtensionBlock = AnimExtsLoopingExtension;
						}
					}
					blocks.push({
						blockType: ExtensionKey,
						ExtensionBlock: ApplicationExtensionBlock,
					});
					break;
				}
				case 'GraphicControlExtension': {
					let GraphicControlExtension = this.parse(ExtensionKey);
					let GraphicRenderingBlock, GraphicRenderingBlockType;
					let curr = this.tell();
					let label2 = this.parse('label');
					let blockSubType;
					if (label2 == labelsDef['ImageDescriptor']) {
						this.seek(curr);
						GraphicRenderingBlock = this.parse('TableBasedImage');
						GraphicRenderingBlockType = 'TableBasedImage';
					} else if (label2 == labelsDef['PlainTextExtension']) {
						this.seek(curr);
						GraphicRenderingBlock = this.parse('PlainTextExtension');
						GraphicRenderingBlockType = 'PlainTextExtension';
					} else {
						throw 'Expect: Graphic-Rendering Block';
					}
					GraphicBlockIndex++;
					let GraphicBlock = {
						blockType: 'Graphic Block',
						blockSubType: GraphicRenderingBlockType,
						GraphicBlockIndex,
						'Graphic Control Extension': GraphicControlExtension,
						'Graphic-Rendering Block': GraphicRenderingBlock,
					};
					blocks.push(GraphicBlock);
					break;
				}
				case 'PlainTextExtension': {
					GraphicBlockIndex++;
					let GraphicRenderingBlock = this.parse('PlainTextExtension');
					let GraphicBlock = {
						blockType: 'Graphic Block',
						blockSubType: 'PlainTextExtension',
						GraphicBlockIndex,
						'Graphic Control Extension': null,
						'Graphic-Rendering Block': GraphicRenderingBlock,
					};
					blocks.push(GraphicBlock);
					break;
				}
			}
		}
		return blocks;
	},

	'Graphic Control Packed Fields': {
		Reserved: 3,
		DisposalMethod: 3,
		UserInputFlag: 1,
		TransparentColorFlag: 1,
	},

	TableBasedImage: function () {
		let ImageDescriptor = this.parse('ImageDescriptor');
		let { LocalColorTableFlag, SizeOfLocalColorTable } = ImageDescriptor.PackedFields;
		let LocalColorTable = this.parse(['ColorTable', LocalColorTableFlag, SizeOfLocalColorTable]);
		let ImageData = this.parse('Table Based Image Data');
		return { type: 'TableBasedImage', ImageDescriptor, LocalColorTable, ImageData };
	},

	'Table Based Image Data': {
		LZWMinimumCodeSize: 'Byte',
		DataSubBlocks: 'Data Sub-block Array',
		'Block Terminator': 'Block Terminator',
	},

	ImageDescriptor: {
		Separator: 'Byte',
		LeftPosition: 'Unsigned',
		TopPosition: 'Unsigned',
		Width: 'Unsigned',
		Height: 'Unsigned',
		PackedFields: 'ImagePackedFields',
	},
	ImagePackedFields: {
		LocalColorTableFlag: 1,
		InterlaceFlag: 1,
		SortFlag: 1,
		Reserved: 2,
		SizeOfLocalColorTable: 3,
	},

	'GIF Data Stream': {
		Header: 'Header',
		LogicalScreen: 'LogicalScreen',
		DataBlocks: 'DataBlocks',
		Trailer: 'Trailer',
	},
};

const args = process.argv.slice(-1);
console.log({args});
let inputFile = args[0] && args[0].endsWith('.gif') && path.resolve(args[0]);

process.chdir(__dirname);
inputFile = inputFile || 'sokoban.gif';
fs.readFile(inputFile, function (err, buffer) {
	if (!buffer) {
		console.log('no buffer');
		return;
	}
	var parser = new jParser(buffer, gifParserStructure);
	var gif = parser.parse('GIF Data Stream');
	// console.log(require('util').inspect(gif, false, 10));
	fs.writeFileSync(inputFile + '.json', JSON.stringify(gif, null, 2), { encoding: 'utf8' });
	console.log('output file ' + inputFile + '.json');
});
