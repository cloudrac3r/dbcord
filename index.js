#!/usr/local/bin/node

//process.on("unhandledRejection", err => { throw err });

/// === REQUIRES, CONSTANTS AND GLOBALS ===

const Discord = require("eris");
const fs = require("fs");

const token = require(__dirname+"/token.js"); // Bot token
//let cf = require("./common.js"); // Now loaded via module
const defaultPrefix = "db "; // Bot prefixes and related, can be changed by user preferences
const seperator = " ";

let cf = {}; let bf = {}; let bc = {}; // Common Functions, Bot Framework and Bot Commands
const events = require("events");
let reloadEvent = new events.EventEmitter();
let modules = [ // Load these modules on startup and on change
	{
		filename: __dirname+"/utilities/common.js",
		dest: "common"
	},{
		filename: __dirname+"/utilities/commonbot.js",
		dest: "bot framework"
	},{
		filename: __dirname+"/utilities/ids.js",
		dest: "common"
	},{
		filename: __dirname+"/utilities/db.js",
		dest: "bot framework"
	}
];
fs.readdirSync(__dirname+"/commands").forEach(filename => {
	if (filename.endsWith(".js")) modules.push({filename: __dirname+"/commands/"+filename, dest: "bot commands"});
});

let bot = new Discord.Client(token); // Log in bot
function log(data, type) {
	if (cf.log) cf.log(data, type);
	else console.log(data);
}

const destinations = {
	"common": filename => Object.assign(cf, require(filename)),
	"bot framework": filename => Object.assign(bf, require(filename)({Discord, bot, cf, bf, reloadEvent, loadModule})),
	"bot commands": filename => Object.assign(bc, require(filename)({Discord, bot, cf, bf, bc, reloadEvent, loadModule}))
}

// Load modules on bot start and when they are modified
function loadModule(m) {
	try {
		reloadEvent.emit(m.filename); // Allow the module to detect the reload
		delete require.cache[require.resolve(m.filename)]; // Otherwise it loads from the cache and ignores file changes
		destinations[m.dest](m.filename); // Load it!
		log("Loading module "+m.filename, "info"); // If we got here: success!
	} catch (e) {
		log("Failed to reload module "+m.filename+"\n"+e.stack, "error"); // If we got here: error.
	}
}
function watchModule(m) {
	fs.watchFile(m.filename, {interval: 2000}, () => {
		loadModule(m);
	});
}
modules.forEach(m => {
	loadModule(m);
	watchModule(m);
});

bot.on("ready", function() {
	bot.editStatus("online", {name: defaultPrefix + "help", type: 0});
});

bot.once("ready", function() { // Once the bot connects
	log(`Logged in as ${bot.user.username} (${bot.user.id})`, "info");
});

bot.on("messageCreate", checkMessage);
bot.on("messageUpdate", (newm, oldm) => {
	if (oldm == null || newm.content == undefined) return;
	if (newm.editedTimestamp && oldm.editedTimestamp != newm.editedTimestamp) checkMessage(newm);
});
function checkMessage(msg) {
	if (!msg.content) return;
	let message = msg.content;
	if (!bot.users.get(msg.author.id)) return; // Ignore "fake users"
	if (msg.author.bot) return; // Ignore other bots
	let prefix;
	let commandString;
	if (message.startsWith(defaultPrefix)) { // Default prefix
		prefix = defaultPrefix;
		commandString = message.slice(defaultPrefix.length);
	} else if (mentionMatch = message.match(new RegExp(`^<@!?${bot.user.id}>\\s*`, "ms"))) { // Starts with mention
		prefix = defaultPrefix;
		commandString = message.slice(mentionMatch[0].length);
		if (commandString.length <= 1) commandString = "help";
	} else if (bf.isDMChannel(msg.channel)) { // Bare command in DMs
		prefix = defaultPrefix;
		commandString = message;
	} else { // Not a command
		return;
	}
	let match = commandString.match(new RegExp(`^(.*?)(?:${seperator}|\n)(.*)$`, "ms"));
	if (match) commandString = match[1] + seperator + match[2];
	let words = commandString.split(seperator);
	for (let commandObject of Object.values(bc)) { // Find a bot command whose alias matches
		if (commandObject.aliases.includes(words[0])) {
			if (commandObject.guildOnly && bf.isDMChannel(msg.channel)) return bf.sendMessage(msg.channel, bf.lang.commandGuildOnly);
			commandObject.code(msg, cf.carg(words.slice(1).join(seperator), prefix, seperator, ";", words[0]));
		}
	}
}

bot.connect();

let db = new bf.db.class();
bot.once("ready", () => {
	db.connect("565467535881797647");
	console.log("Connected to DBcord");
});

let stdin = process.stdin; // Use the terminal to run JS code
stdin.on("data", async function(input) {
	input = input.toString();
	//log(`Running "${input}"`);
	try { // Attempt to run input
		let result = eval(input);
		let output = await cf.stringifyAsync(result, false);
		log(output, "responseInfo");
	} catch (e) { // Failed
		log("Error in eval.\n"+e.stack, "responseError");
	}
});