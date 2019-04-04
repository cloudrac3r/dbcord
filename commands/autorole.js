module.exports = function(input) {
	let {bot, cf, bf, bc, db} = input;
	let availableFunctions = {
		autorole: {
			aliases: ["auto", "autorole"],
			shortHelp: "Manage which roles are automatically assigned to new server members",
			reference: "[add|list|remove] [role name...]",
			longHelp:
				`This is a list of roles. All new server members will be automatically assigned all the roles on this list.\n`+
				`The list can be edited by people who match *any one* of these conditions:\n`+
				`- is the server owner\n`+
				`- has the permission "Manage Server" on one of their roles\n`+
				"- has a role that is on the managers list (see `$PREFIXhelp managers` for more)\n\n"+
				"`$PREFIXauto` or `$PREFIXauto list` to view the auto list\n"+
				"`$PREFIXauto add <role name>` to add a role to the auto list\n"+
				"`$PREFIXauto remove <role name>` to remove a role from the auto list",
			eris: true,
			guildOnly: true,
			category: "Server administrators",
			code: async function(msg, command) {
				// check for guild owner / manage server
				if (!bf.checkMemberManageServer(msg.member)) {
					// if yes, allow through, if not, check the managers list
					let managers = await db.all("SELECT roleID FROM Managers WHERE guildID = ?", msg.guild.id);
					managers = managers.map(row => row.roleID);
					if (!managers.some(m => msg.member.roles.includes(m))) { // doesn't have a manager role
						return bf.sendMessage(msg.channel, bf.lang.autoEditPermissionDenied(command.prefix));
					}
				}
				let action = command.regularWords[0];
				let name = command.regularWords.slice(1).join(command.split);
				if (action == "add") {
					if (!name) return bf.sendMessage(msg.channel, `You must name a role to add to the auto list. See ${command.prefix}help ${command.name} for more details.`);
					let list = await bf.dbRoleList(msg.guild, name, {all: true});
					let promise = bf.beginSelection(msg, {
						title: "Multiple matches, select one",
						noMatches: "No matches. Maybe you misspelled the role name?"
					}, list, async (role, confirmMessage) => {
						db.run("INSERT OR IGNORE INTO auto VALUES (?, ?)", [role.id, msg.guild.id]);
						await promise;
						bf.addReaction(confirmMessage, bf.buttons["green tick"]);
					});
				} else if (action == "remove") {
					if (!name) return bf.sendMessage(msg.channel, `You must name a role to remove from the auto list. See ${command.prefix}help ${command.name} for more details.`);
					let list = await db.all("SELECT roleID FROM Auto WHERE guildID = ?", msg.guild.id);
					list = list.map(row => msg.guild.roles.get(row.roleID));
					list = cf.smartFilter(list, "name", name);
					let promise = bf.beginSelection(msg, {
						title: "Multiple matches, select one",
						noMatches: "No matches. Maybe you misspelled the role name?"
					}, list, async (role, confirmMessage) => {
						db.run("DELETE FROM Auto WHERE guildID = ? AND roleID = ?", [msg.guild.id, role.id]);
						await promise;
						bf.addReaction(confirmMessage, bf.buttons["green tick"]);
					});
				} else if (action == "list" || !action) {
					let list = await db.all("SELECT roleID FROM Auto WHERE guildID = ?", msg.guild.id);
					list = list.map(row => msg.guild.roles.get(row.roleID).name);
					bf.beginPagination(msg.channel, {
						title: "Auto role list",
						footer: {
							text: command.prefix+"auto <add|remove> name"
						}
					}, list);
				} else if (action == "clear") {
					bf.reactionMenu(msg.channel, `The auto role list will be cleared, and new members will not receive any roles. Press ${bf.buttons.tick} to confirm.`, [
						{emoji: bf.buttons.tick, ignore: "total", allowedUsers: [msg.author.id], actionType: "js", actionData: async () => {
							await db.run("DELETE FROM Auto WHERE guildID = ?", msg.guild.id);
							bf.sendMessage(msg.channel, "Done.");
						}}
					]);
				} else {
					return bf.sendMessage(msg.channel, bf.lang.invalidAction(command));
				}
			}
		}
	}

	bot.on("guildMemberAdd", async (guild, member) => {
		let list = await db.all("SELECT roleID FROM Auto WHERE guildID = ?", guild.id);
		list = list.map(row => row.roleID);
		member.edit({roles: list});
	});

	return availableFunctions;
};