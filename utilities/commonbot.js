const events = require("events");
const userEmojiMessage = {channelID: "434994415342321674", messageID: "434994502848217099"};

let reactionMenus = {};
let messageMenus = [];
let warningIgnore = [];
let DMChannelCache = {};

module.exports = function(input) {
	let {Discord, bot, cf, bf, db, reloadEvent} = input;
	let reactionMenus = {};
	let messageMenus = [];

	function fixCAArgs(input) {
		let {c: callback, a: additional} = input;
		if (typeof(callback) == "object" || typeof(additional) == "function") {
			let t = callback;
			callback = additional;
			additional = t;
		}
		if (!callback) callback = new Function();
		if (!additional) additional = {};
		return {callback, additional};
	}
	function createSendableObject(input1, input2) {
		if (!input2) input2 = {};
		if (typeof(input1) == "number") input1 += "";
		if (typeof(input1) == "string") input1 = {content: input1};
		Object.assign(input1, input2);
		const contentKeys = ["content", "embed", "tts", "disableEveryone"];
		let content = {};
		Object.keys(input1).filter(k => contentKeys.includes(k)).forEach(k => content[k] = input1[k]);
		let file;
		if (input1.file && input1.filename) file = {file: input1.file, name: input1.filename};
		return [content, file];
	}

	Object.assign(bf, {
		userEmojis: {},
		messageCharacterLimit: 2000,
		// Button reactions.
		buttons: { // {(<:([a-z0-9_]+):[0-9]+>) ?} / {"\2": "\1",\n        }
			// Numbers
			"0": "<:bn_0:327896448081592330>",
			"1": "<:bn_1:327896448232325130>",
			"2": "<:bn_2:327896448505217037>",
			"3": "<:bn_3:327896452363976704>",
			"4": "<:bn_4:327896452464508929>",
			"5": "<:bn_5:327896454733627403>",
			"6": "<:bn_6:327896456369274880>",
			"7": "<:bn_7:327896458067968002>",
			"8": "<:bn_8:327896459070537728>",
			"9": "<:bn_9:327896459292704769>",
			// Words
			"end": "<:bn_en:327896461272678400>",
			// Punctuation
			"exclamation": "<:bn_ex:331164187831173120>",
			"question": "<:bn_qu:331164190267932672>",
			// Operators
			"plus": "<:bn_pl:328041457695064064>",
			"minus": "<:bn_mi:328042285704937472>",
			"times": "<:bn_ti:327986149203116032>",
			"plusminus": "<:bn_pm:327986149022760960>",
			// Arrows
			"left": "<:bn_ba:328062456905728002>",
			"down": "<:bn_do:328724374498836500>",
			"up": "<:bn_up:328724374540779522>",
			"right": "<:bn_fo:328724374465282049>",
			"redo": "<:bn_re:362741439211503616>",
			"point down": "<:cbn_ptd:389238901233025034>",
			// Other symbols
			"person": "<:cbn_person:362387757592739850>",
			"cards": "<:cbn_cards:362384965989826561>",
			"info": "<:cbn_info:377710017627029505>",
			"tick": "<:cbn_tick:378414422219161601>",
			"clock": "<:cbn_clock:381652491999117313>",
			"yes": "<:bn_yes:331164192864206848>",
			"no": "<:bn_no:331164190284972034>",
			"blank": "<:bn_bl:330501355737448450>",
			"green tick": "✅",
			"green cross": "❎",
			"bot tag": "<:bot:412413027565174787>"
		},
		// Check if a channel is a direct message or in a server.
		isDMChannel: function(channel) {
			if (typeof(channel) == "object") channel = channel.id;
			return !bot.channelGuildMap[channel];
		},
		// Given a thing, return a bot object.
		userObject: function(thing) {
			if (!thing) return;
			if (typeof(thing) == "string") return bot.users.get(thing);
			if (thing.constructor.name.includes("User") || thing.constructor.name == "Member") return thing;
		},
		channelObject: function(thing) {
			if (!thing) return;
			if (typeof(thing) == "string") return bot.getChannel(thing);
			if (thing.constructor.name.includes("Channel")) return thing;
		},
		guildObject: function(thing) {
			if (!thing) return;
			let result = thing;
			if (typeof(result) == "string") result = bot.guilds.get(thing);
			if (result.constructor.name == "Guild") return result;
			return channelObject(thing);
		},
		// Given a user and a server, return the user's member object.
		userToMember: function(user, guild) {
			guild = bf.guildObject(guild);
			user = bf.userObject(user);
			return guild.members.get(user.id);
		},
		// Given a channelID or userID, resolve it to a channel object.
		resolveChannel: function(channel) {
			return new Promise(resolve => {
				if (bf.channelObject(channel)) {
					resolve(bf.channelObject(channel));
				} else if (bf.userObject(channel)) {
					let userID = bf.userObject(channel).id;
					if (DMChannelCache[userID]) resolve(DMChannelCache[userID]);
					else bot.getDMChannel(userID).then(c => {
						DMChannelCache[userID] = c;
						resolve(c);
					});
				} else {
					resolve(undefined);
				}
			});
		},
		withOptionalChannel: function(input) {
			let args = cf.argsToArray(input);
			return bf.resolveChannel(args[0])
			.then(channel => new Promise(resolve => {
				if (!args[0]) {
					resolve(args);
				} else {
					if (channel) args = args.slice(1);
					resolve([channel].concat(args));
				}
			}));
		},
		// Given a user and a server, return the user's display name.
		userToNick: function(user, guild, prefer) {
			if (!prefer) prefer = "";
			user = bf.userObject(user);
			let username = user.username;
			let nick = bf.userToMember(user, guild).nick;
			if (!nick) return username; // No nick? Use username.
			if (prefer.startsWith("user")) { // User(name) should be first
				return username+" ("+nick+")";
			} else if (prefer.startsWith("nick")) { // Nick(name) should be first
				return nick+" ("+username+")";
			} else { // Just the nickname
				return nick;
			}
		},
		// Given a member or a user and a server, return the colour of the user's name.
		userToColour: function(user, guild) {
			if (user.constructor.name == "Member") {
				var member = user;
			} else if (guild) {
				guild = bf.guildObject(guild);
				var member = bf.userToMember(user, guild);
			} else return undefined;
			let role = guild.roles.filter(r => member.roles.includes(r.id)).sort((a,b) => b.position-a.position).find(r => r.color);
			return role ? role.color : undefined;
		},
		// Given a userID or channelID, return its display name.
		nameOfChannel: function(input) {
			let channelObject = bf.channelObject(input);
			let userObject = bf.userObject(input);
			if (channelObject) {
				if (bf.isDMChannel(channelObject)) {
					return "@"+input.recipient.username;
				} else {
					return "#"+input.name;
				}
			} else if (userObject) {
				return "@"+userObject.username;
			} else if (!input) {
				return "unknown channel";
			} else {
				console.log(input);
				console.log(typeof(input));
				throw "Unknown format for channel; cannot get name";
			}
		},
		ceregex: /^<a?:([a-zA-Z0-9_-]{2,32}):([0-9]+)>$/,
		matchEmoji: function(input) {
			let match = input.match(bf.ceregex);
			return match;
		},
		// Fix emojis so they can be used by Eris.
		fixEmoji: function(input) {
			if (typeof(input) == "object") {
				if (input.id) {
					return input.name+":"+input.id;
				} else {
					return input.name;
				}
			} else if (typeof(input) == "string") {
				let match = bf.matchEmoji(input);
				if (match) {
					return match[1]+":"+match[2];
				} else {
					return input;
				}
			} else {
				console.log(input);
				console.log(typeof(input));
				throw "Unknown format for emoji; cannot convert";
			}
		},
		stringifyEmoji: function(input) {
			if (typeof(input) == "object") {
				if (input.id) {
					return "<"+(input.animated ? "a" : "")+":"+input.name+":"+input.id+">";
				} else {
					return input.name;
				}
			} else {
				return input;
			}
		},
		addTemporaryListener: function(target, name, filename, code) {
			target.on(name, code);
			cf.log("Added listener: "+name, "spam");
			reloadEvent.once(filename, () => {
				cf.log("Removed listener: "+name, "spam");
				target.removeListener(name, code);
			});
		},
		// Execute code either immediately or when the bot connects.
		onBotConnect: function(code) {
			if (bot.startTime) {
				code();
			} else {
				bot.once("ready", code);
			}
		},
		// Create a fake message object from as little information as possible.
		fakeMessage(object) {
			return new Discord.Message(Object.assign({
				id: ((Date.now()-1420070400000)<<22).toString(),
				timestamp: Date.now(),
				edited_timestamp: null,
				mention_everyone: false,
				mentions: [],
				mention_roles: [],
				attachments: [],
				embeds: [],
				type: 0,
				pinned: false
			}, object), bot);
		},
		// Get a message from a channel.
		getMessage: function(channel, messageID, callback) {
			if (!callback) callback = new Function();
			if (typeof(messageID) == "object") {
				return Promise.resolve(messageID)
			} else {
				channel = bf.channelObject(channel);
				let cheat = channel.messages.get(messageID);
				if (cheat) {
					callback(null, cheat);
					return Promise.resolve(cheat);
				} else {
					return bot.getMessage(channel.id, messageID)
					.then(messageObject => {
						channel.messages.add(messageObject, undefined, true);
						callback(null, messageObject);
						return messageObject;
					});
				}
			}
		},
		// Send a message to a channel.
		sendMessage: function(channel, content, c, a) {
			if (!content) content = "";
			let {callback, additional} = fixCAArgs({c, a});
			let [actualContent, file] = createSendableObject(content, additional)
			return new Promise(resolve => {
				if (additional.mention) {
					let mention = bf.userObject(additional.mention);
					db.get("SELECT mention FROM Users WHERE userID = ?", mention.id, function(err, dbr) {
						if (dbr && dbr.mention == 1) {
							actualContent.content = mention.mention+" "+actualContent.content;
						}
						delete additional.mention;
						resolve();
					});
				} else resolve();
			})
			.then(() => bf.resolveChannel(channel))
			.then(channel => {
				let messages = cf.splitMessage(actualContent.content, 2000);
				if (channel.guild && actualContent.embed && !actualContent.embed.color) actualContent.embed.color = bf.userToColour(bot.user, channel.guild);
				let all;
				if (messages.length == 1) {
					all = Promise.all([channel.createMessage(actualContent, file)]);
				} else {
					all = Promise.all(
						messages.slice(0, -1).map(fragment => channel.createMessage(fragment))
						.concat(channel.createMessage(Object.assign(actualContent, {content: messages.slice(-1)[0]})))
					);
				}
				return all.then(results => {
					let messageObject = results.slice(-1)[0];
					cf.log(`Sent a message (${messageObject.id}) to ${bf.nameOfChannel(channel)} (${channel.id}):\n${messageObject.content}`, "spam");
					bot.getChannel(channel.id).messages.add(messageObject, undefined, true);
					if (additional.legacy) callback(null, messageObject.id, messageObject);
					else callback(null, messageObject);
					return messageObject;
				})
				.catch(callback);
			});
		},
		// Edit a message sent by the bot.
		editMessage: function() {
			return bf.withOptionalChannel(arguments)
			.then(([channel, message, content, c, a]) => {
				let {callback, additional} = fixCAArgs({c, a});
				let actualContent = createSendableObject(content, additional)[0];
				let promise;
				if (channel) {
					if (typeof(message) == "object") message = message.id;
					promise = bot.editMessage(channel.id, actualContent);
				} else {
					promise = message.edit(actualContent);
				}
				promise.then(messageObject => callback(null, messageObject));
				promise.catch(err => {
					callback(err);
					switch (err.code) {
					default:
						throw err;
					}
				});
				return promise;
			});
		},
		// React to a message.
		addReaction: function() {
			return bf.withOptionalChannel(arguments)
			.then(([channel, message, reaction, callback]) => {
				if (!callback) callback = new Function();
				reaction = bf.fixEmoji(reaction);
				let promise;
				if (channel) {
					if (typeof(message) == "object") message = message.id;
					promise = bot.addMessageReaction(channel.id, message, reaction);
				} else {
					if (message.reactions[reaction] && message.reactions[reaction].me) {
						promise = Promise.resolve();
					} else {
						promise = message.addReaction(reaction);
					}
				}
				promise.then(() => {
					callback(null);
					if (typeof(message) == "object") channel = message.channel;
					cf.log(`Added the reaction ${reaction} to a message (${message}) in ${bf.nameOfChannel(channel)} (${channel.id})`, "spam");
				});
				promise.catch(err => {
					callback(err);
					switch (err.code) {
					case 10014:
						cf.log(`Unknown emoji ${reaction} when adding reaction to a message ${message} in ${bf.nameOfChannel(channel)} (${channel.id})`, "error");
						break;
					default:
						throw err;
					}
				});
				return promise;
			});
		},
		// Add multiple reactions to a message, in order.
		addReactions: function() {
			return bf.withOptionalChannel(arguments)
			.then(([channel, message, reactions, callback, cancelEvent]) => new Promise(resolve => {
				if (!callback) callback = new Function();
				let cancelled = false;
				if (cancelEvent) cancelEvent.once("cancel", () => {
					cancelled = true;
				});
				(function addNextReaction() {
					bf.addReaction(channel, message, reactions[0]).then(() => {
						if (cancelled) {
							bf.removeReaction(channel, message, reactions[0]);
							callback(null);
							resolve();
						} else {
							reactions.shift();
							if (reactions[0]) addNextReaction();
							else {
								callback(null);
								resolve();
								if (cancelEvent) cancelEvent.removeAllListeners();
							}
						}
					}).catch(err => {
						callback(err);
						throw err;
					});
				})();
			}));
		},
		// Remove a reaction from a message.
		removeReaction: function() {
			return bf.withOptionalChannel(arguments)
			.then(([channel, message, reaction, user, callback]) => {
				user = user ? bf.userObject(user).id : undefined;
				if (!callback) callback = new Function();
				reaction = bf.fixEmoji(reaction);
				let useChannelID = !!channel; // If channel was specified, that means message is only an ID
				if (!message.removeReaction) { // However, message may not be a full message object, in which case channelID/messageID should be used
					useChannelID = true;
					channel = message.channel;
				}
				let promise;
				if (useChannelID) {
					if (typeof(message) == "object") message = message.id;
					promise = bot.removeMessageReaction(channel.id, message, reaction, user);
				} else {
					promise = message.removeReaction(reaction, user);
				}
				promise.then(() => {
					callback(null);
					if (typeof(message) == "object") channel = message.channel;
					cf.log(`Removed the reaction ${reaction} from a message (${message}) in ${bf.nameOfChannel(channel)} (${channel.id})`, "spam");
				});
				promise.catch(err => {
					callback(err);
					switch (err.code) {
					case 10014:
						cf.log(`Unknown emoji ${reaction} when removing reaction from ${message} in ${bf.nameOfChannel(channel)} (${channel.id})`, "error");
						break;
					default:
						throw err;
					}
				});
				return promise;
			});
		},
		// Remove multiple reactions from a message.
		removeReactions: function() {
			return bf.withOptionalChannel(arguments)
			.then(([channel, message, reactions, users, callback]) => {
				if (reactions) reactions = reactions.map(r => bf.fixEmoji(r));
				if (!callback) callback = new Function();
				if (users) users = users.map(u => bf.userObject(u).id);
				return new Promise(resolve => {
					if (typeof(message) == "object") resolve(message);
					else bf.getMessage(channel, message).then(resolve);
				}).then(message => {
					// Now we are guaranteed to have a message object as efficiently as possible.
					let todo = [];
					Object.keys(message.reactions).filter(r => !reactions || reactions.includes(r)).forEach(r => {
						message.getReaction(r).then(reacters => reacters.forEach(u => {
							if (!users || users.includes(u.id)) todo.push(message.removeReaction(r, u.id));
						}));
					});
					return Promise.all(todo).then(() => {
						callback();
					});
				});
			});
		},
		// Create a reaction menu
		reactionMenu: function() {
			return bf.withOptionalChannel(arguments)
			.then(([channel, message, actions, callback, cancelEvent]) => {
				if (!callback) callback = new Function();
				if (!cancelEvent) cancelEvent = new events.EventEmitter();
				actions = actions.map(a => {
					a.emoji = bf.fixEmoji(a.emoji);
					if (a.allowedUsers) a.allowedUsers = a.allowedUsers.map(u => bf.userObject(u).id);
					return a;
				});
				return new Promise(resolve => {
					if (typeof(message) == "object") resolve(message);
					else if (channel && typeof(message) == "string" && message.match(/^[0-9]{16,}$/)) {
						resolve(message);
					} else if (channel && typeof(message) == "string") {
						bf.sendMessage(channel, message).then(resolve);
					}
				}).then(message => {
					let messageID = (typeof(message) == "string" ? message : message.id);
					let channelID = (typeof(message) == "object" ? message.channel.id : channel.id);
					bf.getMessage(channel, message).then(msg => callback(null, msg));
					let promise;
					if (channel) {
						promise = bf.addReactions(channel, message, actions.map(a => a.emoji), new Function(), cancelEvent);
					} else {
						promise = bf.addReactions(message, actions.map(a => a.emoji), new Function(), cancelEvent);
					}
					reactionMenus[messageID] = {actions, channelID, cancelEvent};
					promise.catch(() => {
						delete reactionMenus[messageID];
					});
					return promise.then(() => {
						callback(null, message);
						return Promise.resolve(message);
					});
				});
			});
		},
		// A cooler reaction menu
		personalMenu: function(channel, preMessage, userID, options) {
			let message = preMessage;
			let megaActions = options.map((option, index) => {
				let action = {emoji: bf.buttons[index+1], allowedUsers: [userID], remove: "user", actionType: "js"};
				message += `\n${action.emoji} ${option.caption}`;
				if (option.response == "reactionMenuYNDB" || option.response == "reactionMenuYN") {
					action.actionData = () => {
						let ok = true;
						if (option.pre) ok = option.pre();
						if (ok) {
							bf.reactionMenu(channel, option.message, [bf.buttons.yes, bf.buttons.no].map(e => ({emoji: e, allowedUsers: [userID], ignore: "total", actionType: "js", actionData: choice})));
							function choice(msg, emoji) {
								let value = option.values[emoji.name] || option.values[emoji.name.match(/^(?:bn_)?(.*)$/)[1]];
								if (option.response == "reactionMenuYNDB") {
									option.db.run(option.DBTemplate, value, err => {
										if (err) throw err;
										bf.addReaction(msg, bf.buttons["green tick"]);
										if (option.post) option.post(value);
									});
								} else {
									option.code(msg);
								}
							}
						}
					}
				} else if (option.response == "code") {
					action.actionData = option.code;
				}
				return action;
			});
			bf.reactionMenu(channel, message, megaActions);
		},
		// Create a message menu
		messageMenu: function() {
			return bf.withOptionalChannel(arguments)
			.then(([channel, message, user, pattern, action, callback]) => {
				if (!callback) callback = new Function();
				if (!pattern) pattern = /.*/;
				return new Promise(resolve => {
					if (typeof(message) == "object") resolve(message);
					else if (channel && typeof(message) == "string" && message.match(/^[0-9]{16,}$/)) {
						resolve(message);
					} else if (channel && typeof(message) == "string") {
						bf.sendMessage(channel, message).then(resolve);
					}
				}).then(message => {
					let messageID = (typeof(message) == "string" ? message : message.id);
					let channelID = (typeof(message) == "object" ? message.channel.id : channel.id);
					let userID = bf.userObject(user).id;
					messageMenus = messageMenus.filter(m => !(m.channelID == channelID && m.messageID == messageID));
					messageMenus.push({channelID, userID, pattern, action});
					callback(null);
				});
			});
		},
		// Pin a message to a channel
		pinMessage: function() {
			return bf.withOptionalChannel(arguments)
			.then(([channel, message, callback]) => {
				if (!callback) callback = new Function();
				let promise;
				if (channel) {
					promise = bot.pinMessage(channel.id, message);
				} else {
					promise = message.pin();
				}
				let channelID = channel ? channel.id : message.channel.id;
				let messageID = typeof(message) == "object" ? message.id : message;
				promise.catch(err => {
					callback(err);
					if (warningIgnore.includes(messageID)) return;
					warningIgnore.push(messageID);
					switch (err.code) {
					case 50013:
						cf.log(`Missing permissions to pin message ${message} in ${bf.nameOfChannel(channel)} (${channel.id})`, "error");
						bf.sendMessage(channel, `I tried to pin a message, but I lack permissions. Please give me a role which has permission to manage messages.`);
						break;
					default:
						throw err;
					}
				});
				return promise.then(() => bot.getMessages(channelID).then(messages => {
					let pinAlert = messages.sort((a,b) => b.id-a.id).find(m => m.type == 6 && m.author.id == bot.user.id);
					return Promise.resolve(pinAlert);
					callback(null, pinAlert);
				}));
			});
		},
		// Unpin a message to a channel
		unpinMessage: function() {
			return bf.withOptionalChannel(arguments)
			.then(([channel, message, callback]) => {
				if (!callback) callback = new Function();
				let promise;
				if (channel) {
					promise = bot.unpinMessage(channel.id, message);
				} else {
					promise = message.unpin();
				}
				promise.then(() => {
					callback(null);
				});
				return promise;
			});
		},
		// Apply additional permissions to a channel
		editChannelPermissions: function(channel, thing, overwrites, callback) {
			let type = bf.userObject(thing) ? "member" : "role";
			channel = bf.channelObject(channel);
			overwrites = {...overwrites};
			if (!callback) callback = new Function();
			let current = {...bf.channelObject(channel).permissionOverwrites.toObject()[thing]};
			["allow", "deny", "default"].forEach(k => {
				if (!overwrites[k]) overwrites[k] = 0;
			});
			["allow", "deny"].forEach(k => current[k] |= overwrites[k]);
			["allow", "deny"].forEach(k => overwrites[k] = (overwrites[k] | overwrites.default) ^ Discord.Constants.Permissions.all);
			["allow", "deny"].forEach(k => {
				let other = (k == "allow" ? "deny" : "allow");
				current[k] &= overwrites[other];
			});
			let promise = bot.editChannelPermission(channel.id, thing, current.allow, current.deny, type);
			promise.then(() => {
				callback(null);
			});
			return promise;
		}
	});
	// Make reaction menus work
	bf.addTemporaryListener(bot, "messageReactionAdd", __filename, (msg, emoji, user) => {
		user = bf.userObject(user);
		let fixedEmoji = bf.fixEmoji(emoji);
		if (user.id == bot.user.id) return;
		let menu = reactionMenus[msg.id];
		if (!menu) return;
		let action = menu.actions.find(a => a.emoji == fixedEmoji);
		if (!action) return;
		if ((action.allowedUsers && !action.allowedUsers.includes(user.id)) || (action.deniedUsers && action.deniedUsers.includes(user.id))) {
			if (action.remove == "user") bf.removeReaction(msg, fixedEmoji, user);
			return;
		}
		switch (action.actionType) {
		case "reply":
			bf.sendMessage(msg.channel, action.actionData, {mention: user});
			break;
		case "edit":
			bf.editMessage(msg, action.actionData);
			break;
		case "legacy":
			action.actionData({d: msg}, reactionMenus);
			break;
		case "js":
			action.actionData(msg, emoji, user, menu.cancelEvent, reactionMenus);
			break;
		}
		switch (action.ignore) {
		case "that":
			menu.actions.find(a => a.emoji == fixedEmoji).actionType = "none";
			break;
		case "thatTotal":
			menu.actions = menu.actions.filter(a => a.emoji != fixedEmoji);
			break;
		case "all":
			menu.actions.forEach(a => a.actionType = "none");
			break;
		case "total":
			delete reactionMenus[msg.id];
			break;
		}
		switch (action.remove) {
		case "user":
			bf.removeReaction(msg, fixedEmoji, user);
			break;
		case "bot":
			bf.removeReaction(msg, fixedEmoji, bot.user);
			break;
		case "that":
			bf.removeReactions(msg, [fixedEmoji]);
			break;
		case "all":
			msg.removeReactions();
			break;
		case "message":
			delete reactionMenus[msg.id];
			msg.delete();
			break;
		}
		if (action.cancel) menu.cancelEvent.emit("cancel");
		//cf.log("New reaction on reaction menu: "+emoji, "warning");
	});
	bf.addTemporaryListener(bot, "messageCreate", __filename, msg => {
		function isDesiredMenu(m) {
			return m.channelID == msg.channel.id && m.userID == msg.author.id;
		}
		let menu = messageMenus.find(m => isDesiredMenu(m) && msg.content.match(m.pattern));
		if (menu) {
			menu.action(msg);
			messageMenus = messageMenus.filter(m => !isDesiredMenu(m));
		}
	});
	bf.beginPagination = function(channel, embed, list, limit = 15) {
		if (list.length == 0) list.push("(empty list)");
		let buffer = 5;
		if (list.length <= limit+buffer) {
			embed.description = list.join("\n");
			bf.sendMessage(channel, {embed});
		} else {
			let pages = [];
			while (list.length) {
				pages = pages.concat([list.slice(0, limit)]);
				list = list.slice(limit);
			}
			let page = 0;
			let formerText = "";
			if (embed.footer && embed.footer.text) formerText = " ​ │ ​ "+embed.footer.text; //SC: zero-width space; U+2502
			function modifyEmbed() {
				embed.description = pages[page].join("\n");
				if (!embed.footer) embed.footer = {};
				embed.footer.text = `Page ${page+1} of ${pages.length}`+formerText;
			}
			modifyEmbed();
			bf.sendMessage(channel, {embed}).then(message => {
				bf.reactionMenu(channel, message, [
					{emoji: bf.buttons.left, remove: "user", actionType: "js", actionData: menuCallback},
					{emoji: bf.buttons.right, remove: "user", actionType: "js", actionData: menuCallback}
				]);
			});
			function menuCallback(msg, emoji, user) {
				if (emoji.name == "bn_fo") {
					page++;
					if (page >= pages.length) page = 0;
					modifyEmbed();
					msg.edit({embed});
				} else {
					page--;
					if (page < 0) page = pages.length-1;
					modifyEmbed();
					msg.edit({embed});
				}
			}
		}
	}
	bf.beginSelection = async function(msg, details, list, callback) {
		let limit = 5;
		let buffer = 1;
		if (list.length == 0) {
			return bf.sendMessage(msg.channel, details.noMatches);
		} else if (list.length == 1) {
			return setImmediate(() => callback(list[0], msg));
		} else {
			let more = 0;
			if (list.length > limit+buffer) {
				more = list.length-limit;
				list = list.slice(0, limit);
			}
			let description = list.map((row, i) => bf.buttons[i+1]+" "+row.name).join("\n");
			if (more) description += `\n(and ${more} more...)`;
			let embed = {
				title: details.title,
				description
			}
			let selectMessage = await bf.sendMessage(msg.channel, {embed});
			let actions = Array(list.length).fill().map((_, i) => ({emoji: bf.buttons[i+1], ignore: "total", allowedUsers: [msg.author.id], actionType: "js", actionData: menuCallback}));
			function menuCallback(_, emoji) {
				let role = list[+emoji.name.split("_")[1]-1];
				callback(role, selectMessage);
			}
			return bf.reactionMenu(msg.channel, selectMessage, actions);
		}
	}
	bf.dbRoleList = async function(guild, filter, options) {
		guild = bf.guildObject(guild);
		if (!filter) filter = "";
		let lockedData = await db.all("SELECT Roles.roleID, locker FROM Roles LEFT JOIN Locks ON Roles.roleID = Locks.roleID WHERE guildID = ? GROUP BY Roles.roleID", guild.id);
		if (options.all) {
			let map = new Map();
			let toLock = [];
			for (let role of guild.roles.values()) {
				map.set(role.id, {name: role.name, id: role.id});
			}
			if (options.locked) {
				for (let row of lockedData) {
					let role = map.get(row.roleID);
					if (role) toLock.push(role);
				}
			}
			var list = cf.smartFilter([...map.values()], "name", filter);
			if (options.locked) {
				for (let role of toLock) {
					role.name += bf.lang.lockedRole;
				}
			}
			if (options.member) {
				for (let role of list) {
					if (options.member.roles.includes(role.id)) role.name = "🔸 "+role.name;
					else role.name = "▪ "+role.name;
				}
			}
		} else {
			var list = lockedData;
			list = list.map(row => ({id: row.roleID, name: guild.roles.get(row.roleID).name, locker: row.locker}));
			list = cf.smartFilter(list, "name", filter);
			if (options.locked || options.member) {
				for (let role of list) {
					if (options.locked) {
						if (role.locker) role.name += bf.lang.lockedRole;
					}
					if (options.member) {
						if (options.member.roles.includes(role.id)) role.name = "🔸 "+role.name;
						else role.name = "▪ "+role.name;
					}
				}
			}
		}
		return list;
	}
	bf.checkMemberManageServer = function(member) {
		return member.guild.ownerID == member.id || member.permission.has("manageServer") || member.permission.has("administrator")
	}

	class InlineRoleListGeneric {
		constructor(msg) {
			this.msg = msg;
			this.messages = {};
		}
		setMessages(object) {
			Object.assign(this.messages, object);
		}
		async getPrevious() {
			return ["Generic", "Previous", "List"];
		}
		setNew() {
			return bf.sendMessage(this.msg.channel, "Generic new list");
		}
		async go(roleNames) {
			if (roleNames[0].length <= 1) return bf.sendMessage(this.msg.channel, `You must name a role to modify. See ${command.prefix}help ${command.name} for more details.`);
			let roles = [];
			for (let name of roleNames) {
				let possibles = [];
				possibles = this.msg.guild.roles.filter(r => r.name == name);
				if (possibles.length == 0) possibles = this.msg.guild.roles.filter(r => r.name.toLowerCase() == name.toLowerCase());
				if (possibles.length == 0) possibles = this.msg.guild.roles.filter(r => r.name.toLowerCase().startsWith(name.toLowerCase()));
				if (possibles.length == 0) return bf.sendMessage(this.msg.channel, "Couldn't find any matches for `"+name+"`. Maybe you misspelled it?");
				if (possibles.length > 1 && !command.flags.on.includes("a")) return bf.sendMessage(this.msg.channel, "Found multiple matches for `"+name+"`. Could you be more specific?\nAdd `+a` to your command to override this warning and select all matches.");
				roles = roles.concat(possibles);
			}
			let output = this.messages.pre ? this.messages.pre(roles[0].name)+"\n\n" : "";
			let previousRoles = await this.getPrevious(roles);
			output += previousRoles.length
			? this.messages.previousRemove+previousRoles.map(r => "`"+r.name+"`").join(", ")+"\n"
			: this.messages.previousNone+"\n"
			output += roles.length >= 2
			? this.messages.newAdded+roles.slice(1).map(r => "`"+r.name+"`").join(", ")+"\n\n"
			: this.messages.newNone+"\n\n"
			output += this.messages.post || "";
			bf.reactionMenu(this.msg.channel, output, [
				{emoji: bf.buttons.tick, ignore: "total", allowedUsers: [this.msg.author.id], actionType: "js", actionData: async () => {
					await this.setNew(roles);
					bf.sendMessage(this.msg.channel, "Done.");
				}}
			]);
		}
	}
	class InlineRoleListLocker extends InlineRoleListGeneric {
		constructor(msg, roleNames) {
			super(msg, roleNames);
			this.setMessages({
				pre: name => "The role `"+name+"` will be modified as follows:",
				previousRemove: "These previously existing locks will be removed: ",
				previousNone: "There are no locks currently in place.",
				newAdded: "These new locks will be added: ",
				newNone: "No new locks will be added.",
				post:
					"As always, the locked role will only be able to be self-assigned by people with one or more of its locking roles.\n"+
					`If this is what you want, press ${bf.buttons.tick}.`
			});
		}
		getPrevious(roles) {
			return db.all("SELECT locker FROM Locks WHERE roleID = ?", roles[0].id).then(rows => {
				return rows.map(row => this.msg.guild.roles.get(row.locker));
			});
		}
		async setNew(roles) {
			await db.run("DELETE FROM Locks WHERE roleID = ?", roles[0].id);
			return Promise.all(roles.slice(1).map(role => {
				db.run("INSERT INTO Locks VALUES (?, ?)", [roles[0].id, role.id]);
			}));
		}
	}
	Object.assign(bf, {InlineRoleListGeneric, InlineRoleListLocker});

	Discord.User.prototype.__defineGetter__("tag", function() {
		return this.username+"#"+this.discriminator;
	});
	Discord.Message.prototype.__defineGetter__("guild", function() {
		return this.channel.guild;
	});
};