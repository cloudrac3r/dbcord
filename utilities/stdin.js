const readline = require("readline");

// Configure stdin
const stdin = process.stdin;
const stdout = process.stdout;
stdin.setRawMode(true);
stdin.resume();

// Buffer comparisons
const comp = {
	"CtrlC": Buffer.from([3]),
	"CtrlU": Buffer.from([0x15]),
	"CtrlL": Buffer.from([0x0c]),
	"CtrlLeft": Buffer.from([0x1b, 0x5b, 0x31, 0x3b, 0x35, 0x44]),
	"CtrlRight": Buffer.from([0x1b, 0x5b, 0x31, 0x3b, 0x35, 0x43]),
	"left": Buffer.from([0x1b, 0x5b, 0x44]),
	"right": Buffer.from([0x1b, 0x5b, 0x43]),
	"up": Buffer.from([0x1b, 0x5b, 0x41]),
	"down": Buffer.from([0x1b, 0x5b, 0x42]),
	"return": Buffer.from([0x0d]),
	"backspace": Buffer.from([0x7f]),
	"delete": Buffer.from([0x1b, 0x5b, 0x33, 0x7e]),
	"home": Buffer.from([0x1b, 0x5b, 0x48]),
	"end": Buffer.from([0x1b, 0x5b, 0x46])
}

// Store command information
let pastCommands = [];
let input = "";
let lastBuf = "";
let pastIndex = -1;
let newSessionLine = "";
let cursorPos = 0;
let pastExtraLines = 0;

const sleep = ms => new Promise(resolve => setTimeout(() => resolve(), ms));

module.exports = passthrough => {
	const {cf, bf, reloadEvent} = passthrough;
	const log = cf.log;

	const db = () => global.db;

	bf.addTemporaryListener(stdin, "data", __filename, async function(charBuf) {
		let addToInput = false;

		let oldCursorPos = cursorPos;

		// Operate on buffer
		if (charBuf.equals(comp.CtrlC)) {
			process.exit();
		} else if (charBuf.equals(comp.CtrlU)) {
			input = "";
			cursorPos = 0;
		} else if (charBuf.equals(comp.CtrlL)) {
			console.log(lastBuf);
		} else if (charBuf.equals(comp.up)) {
			if (pastIndex == -1) {
				newSessionLine = input;
			}
			if (pastIndex < pastCommands.length-1) {
				pastIndex++;
				input = pastCommands[pastIndex];
			}
			cursorPos = input.length;
		} else if (charBuf.equals(comp.down)) {
			if (pastIndex > -1) {
				pastIndex--;
				if (pastIndex == -1) {
					input = newSessionLine;
				} else {
					input = pastCommands[pastIndex];
				}
			}
			cursorPos = input.length;
		} else if (charBuf.equals(comp.left)) {
			if (cursorPos > 0) cursorPos--;
		} else if (charBuf.equals(comp.right)) {
			if (cursorPos < input.length-1) cursorPos++;
		} else if (charBuf.equals(comp.CtrlLeft)) {
			if (cursorPos == 0) return;
			const spaceChars = " \t";
			const symbolChars = `~\`!@#$%^&*()-_=+[{]}\\|;:'",<.>/?`;
			cursorPos--;
			while (cursorPos >= 0 && spaceChars.includes(input[cursorPos])) {
				cursorPos--;
			}
			let isSymbol = symbolChars.includes(input[cursorPos]);
			if (isSymbol) {
				while (cursorPos >= 0 && symbolChars.includes(input[cursorPos])) {
					cursorPos--;
				}
			} else {
				while (cursorPos >= 0 && !symbolChars.includes(input[cursorPos]) && !spaceChars.includes(input[cursorPos])) {
					cursorPos--;
				}
			}
			cursorPos++;
		} else if (charBuf.equals(comp.CtrlRight)) {
			const spaceChars = " \t";
			const symbolChars = `~\`!@#$%^&*()-_=+[{]}\\|;:'",<.>/?`;
			while (cursorPos < input.length && spaceChars.includes(input[cursorPos])) {
				cursorPos++;
			}
			let skippedSymbolCount = 0;
			while (cursorPos < input.length && symbolChars.includes(input[cursorPos])) {
				skippedSymbolCount++;
				cursorPos++;
			}
			if (skippedSymbolCount <= 1) {
				while (cursorPos < input.length && !symbolChars.includes(input[cursorPos]) && !spaceChars.includes(input[cursorPos])) {
					cursorPos++;
				}
			}
		} else if (charBuf.equals(comp.backspace)) {
			input = input.slice(0, cursorPos-1) + input.slice(cursorPos);
			cursorPos--;
		} else if (charBuf.equals(comp.delete)) {
			input = input.slice(0, cursorPos) + input.slice(cursorPos+1);
			if (cursorPos > input.length) cursorPos--;
		} else if (charBuf.equals(comp.home)) {
			cursorPos = 0;
		} else if (charBuf.equals(comp.end)) {
			cursorPos = input.length;
		} else {
			addToInput = true;
		}
		lastBuf = charBuf;

		// Operate on string
		let charString = charBuf.toString();
		if (addToInput) {
			input = input.slice(0, cursorPos) + charString + input.slice(cursorPos);
			cursorPos += charString.length;
		}

		// Draw current line
		// + Reset cursor to start point
		let linesFromStart = Math.floor(oldCursorPos/stdout.columns);
		let linesToEnd = Math.floor(input.length/stdout.columns);
		// If the cursor has moved from the start of one line to the end of the previous line as the result of a deletion,
		// set rolledBack to the number of lines moved.
		let oldRow = Math.floor(oldCursorPos/stdout.columns);
		let newRow = Math.floor(cursorPos/stdout.columns);
		let rolledBack = Math.max(oldRow-newRow, 0);
		// Move downwards
		for (let i = 0; i < linesToEnd-linesFromStart; i++) {
			stdout.write("\n");
		}
		// Move upwards and clear
		for (let i = 0; i < linesToEnd+rolledBack; i++) {
			readline.clearLine(stdout);
			readline.moveCursor(stdout, 0, -1);
		}
		readline.clearLine(stdout);
		stdout.write("\r");
		// + Write current command
		stdout.write(input);
		// + Move cursor for visual aid
		// Move to next line if hanging past last column
		if (input.length % stdout.columns == 0 && input.length != 0) stdout.write("\n");
		// Move to start
		readline.moveCursor(stdout, 0, -linesToEnd);
		readline.cursorTo(stdout, 0, null);
		// Move to cursorPos
		readline.moveCursor(stdout, cursorPos % stdout.columns, Math.floor(cursorPos/stdout.columns));

		// Process command
		if (charString == "\r") {
			console.log();
			input = input.replace(/(\r|\n)/g, "");
			try {
				let toRun = input;
				let depthRegex = /\|(\+|\d+)$/;
				let depth = toRun.match(depthRegex) || undefined;
				if (depth) {
					toRun = toRun.replace(depthRegex, "");
					if (depth[1] == "+") depth = Infinity;
					else depth = +depth[1];
				}
				let result = eval(toRun);
				let output = await cf.stringifyAsync(result, false, depth);
				log(output, "responseInfo");
			} catch (e) {
				let reachedStackBottom = false;
				let filteredStack = e.stack.split("\n").filter(line => {
					if (line.trim().startsWith("at ReadStream.<anonymous> ("+__filename)) { // )
						reachedStackBottom = true;
					}
					return !reachedStackBottom;
				}).join("\n");
				log(filteredStack, "responseError");
			}
			pastCommands = pastCommands.filter(p => p != input);
			if (input.trim().length) pastCommands.unshift(input);
			input = "";
			newSessionLine = "";
			pastIndex = -1;
			cursorPos = 0;
		}
	});
}
