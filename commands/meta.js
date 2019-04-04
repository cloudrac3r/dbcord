module.exports = function(input) {
	let {bot, cf, bf, bc, db} = input;
	let availableFunctions = {
		stats: {
			aliases: ["stats"],
			shortHelp: "Check on the status of the bot",
			reference: "",
			longHelp: "",
			eris: true,
			category: "Meta",
			code: async function(msg, command) {
				let configuredRoles = (await db.get("select count(*) as count from (select roleID from Managers union all select roleID from Roles)")).count;
				let before = Date.now();
				await msg.channel.sendTyping();
				let ping = bf.isDMChannel(msg.channel) ? bot.shards.get(0).latency : msg.guild.shard.latency;
				let memberCount = 0;
				for (let guild of bot.guilds.values()) {
					memberCount += guild.memberCount;
				}
				let embed = {
					fields: [
						{
							name: bot.user.tag,
							value:
								`**❯ Ping:**\n${ping}ms\n`+
								`**❯ API latency:**\n${Date.now()-before}ms\n`+
								`**❯ Uptime:**\n${cf.humanTime(process.uptime()*1000)}\n`,
							inline: true
						},{
							name: "​", //SC: zero-width space
							value:
								`**❯ User count:**\n${memberCount} members / ${bot.users.size} users\n`+
								`**❯ Server count:**\n${bot.guilds.size}\n`+
								`**❯ Configured roles:**\n${configuredRoles}`,
							inline: true
						}
					],
					color: bf.userToColour(bot.user, msg.guild)
				};
				bf.sendMessage(msg.channel, {embed});
			}
		},
		help: {
			aliases: ["help"],
			shortHelp: "Looks like you got it figured out already",
			reference: "[command]",
			longHelp: "Looks like you got this part figured out as well. Nice.",
			eris: true,
			category: "Meta",
			code: function(msg, command) {
				let prefix = command.prefix;
				let target;
				if (command.regularWords[0]) target = Object.keys(bc).map(c => bc[c]).find(c => c.aliases.includes(command.regularWords[0]));
				if (target) {
					bf.sendMessage(msg.channel,
						`**${target.shortHelp}**\n`+
						`**Aliases**: ${target.aliases.join(", ")}\n`+
						`**Usage**: ${prefix}${command.regularWords[0]} ${target.reference}`+
						(target.longHelp ? "\n\n"+target.longHelp.replace(/\$PREFIX/g, prefix) : ""));
				} else {
					let commands = Object.values(bc).filter(c => !c.hidden);
					let categories = new Map();
					let categoryNames = ["Server members", "Server administrators", "Meta", "Uncategorised"];
					categoryNames.forEach(name => categories.set(name, []));
					let maxLength = 0;
					for (let command of commands) {
						let target = categoryNames.includes(command.category) ? command.category : "Uncategorised"
						categories.get(target).push(command);
						if (maxLength < command.aliases[0].length) maxLength = command.aliases[0].length;
					}
					let embed = {title: "Command list", fields: []};
					for (let name of categoryNames) {
						let category = categories.get(name);
						if (category.length) {
							let value = "";
							value += category.map(command =>
								"`"+command.aliases[0]+" ​".repeat(maxLength-command.aliases[0].length)+"` "+command.shortHelp // space + zwsp
							).join("\n");
							embed.fields.push({name, value});
						}
					}
					bf.sendMessage(msg.author.id, {embed})
					.catch(() => {
						bf.sendMessage(msg.channel, bf.lang.dmExplanation("the help message"));
					}).then(() => {
						if (!bf.isDMChannel(msg.channel)) bf.sendMessage(msg.channel, "DM sent.");
						return bf.sendMessage(msg.author.id, {embed: {description:
							"Try `"+prefix+"help <command name>` for more details about a specific command.\n"+
							"Square brackets `[ ]` indicate an optional parameter. Angled brackets `< >` indicate a required parameter. "+
							"You should not actually type those brackets in your command.\n"+
							"For a quick guide on how to use the bot, do `"+prefix+"guide`."
						}});
					})
					/*.then(() => bf.sendMessage(msg.author.id,
						"For some commands, "+bot.user.username+" allows you to use things called **flags** and **switches**.\n"+
						"Flags are used by prefixing a word with either a + or a -, e.g. `+timer`. This allows you to enable or disable a specific option.\n"+
						"Switches are used by connecting two words with an equals sign, e.g. `size=4`. This allows you to specify a certain value for an option.\n"+
						"The whole point of flags and switches is that they can be used **anywhere in the command** rather than needing to be in a specific order. "+
						"This is very helpful if you often forget the correct order for words in a certain command.\n"+
						"If you don't want to use flags or switches, you can usually use positional arguments instead.\n\nYour current prefix is `"+prefix+"`"
					));*/
				}
			}
		},
		guide: {
			aliases: ["guide"],
			shortHelp: "See a more in-depth explanation of the bot's major features",
			reference: "",
			longHelp: "",
			eris: true,
			category: "Meta",
			code: function(msg, command) {
				let rolemaster = bot.user.username;
				let prefix = command.prefix;
				let embeds = [
					{
						title: "Overview",
						description:
							`${rolemaster} aims to be everything you need to manage roles on your server, and nothing more.\n`+
							`Simplify your life: instead of bots with hundreds of commands that you don't want, `+
							`${rolemaster} keeps things simple by providing a role management experience that gives you `+
							`exactly what you want and stays out of your way.\n`+
							`All the features you need, without annoyances, free forever.`
					},{
						title: "Usage guide for server members",
						fields: [
							{
								name: "Introduction",
								value:
									`Each server can curate a list of self-assignable roles. You can use commands to give yourself these roles.\n`+
									`Examples of these roles might be an opt-in announcement role for notifications, `+
									`colours to brighten up the chat, or labels so people know who you are at a glance.`
							},{
								name: "Command list",
								value:
									"`"+prefix+"list` to see the list of available roles.\n"+
									"`"+prefix+"give <role name>` to give yourself a role.\n"+
									"`"+prefix+"take <role name>` to take away a role.\n\n"+
									`A role will show an orange diamond in the list if you already have it. If you don't have it, it will show a black square.\n\n`+
									`A role will show "locked" if it is locked. Locked roles require you to already have another specific role to get them. `+
									`For example, a "partner lounge" role might be locked behind the "partner" role. Once you have the "partner" role, `+
									`you would be able to give yourself "partner lounge".`
							}
						]
					},{
						title: "Usage guide for server administrators",
						fields: [
							{
								name: "Setting up the self-assignable role list",
								value: bc.edit.longHelp.replace(/\$PREFIX/g, prefix)
							},{
								name: "Setting up the auto role list",
								value:
									"All the roles on the auto role list will be assigned to new members when they join.\n"+
									"The auto role list is editable in exactly the same way as the self-assignable role list"
							},{
								name: "Setting up the managers list",
								value: bc.managers.longHelp.replace(/\$PREFIX/g, prefix)
							}
						]
					}
				];
				(function sendNext() {
					bf.sendMessage(msg.author.id, {embed: embeds.shift()}).then(() => {
						if (embeds.length) sendNext();
						else if (!bf.isDMChannel(msg.channel)) bf.sendMessage(msg.channel, "DM sent.");
					}).catch(() => {
						bf.sendMessage(msg.channel, bf.lang.dmExplanation("the guide"));
					});
				})();
			}
		}
	}
	return availableFunctions;
}