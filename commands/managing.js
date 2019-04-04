module.exports = function(input) {
	let {bot, cf, bf, bc, db} = input;
	let availableFunctions = {
		lock: {
			aliases: ["lock"],
			shortHelp: "Redirect",
			reference: "",
			longHelp: "",
			eris: true,
			guildOnly: true,
			hidden: true,
			code: async function(msg, command) {
				command = cf.carg("lock "+command.input, command.prefix, command.split, command.altSplit, "edit");
				bc.edit.code(msg, command);
			}
		},
		edit: {
			aliases: ["edit", "editlist"],
			shortHelp: "Manage the list of self-assignable roles",
			reference: "[add|lock|remove] [role name...]",
			longHelp:
				`The "edit" command allows you to edit the list of self-assignable roles.\n`+
				`The list can be edited by people who match *any one* of these conditions:\n`+
				`- is the server owner\n`+
				`- has the permission "Manage Server" on one of their roles\n`+
				"- has a role that is on the managers list (see `$PREFIXhelp managers` for more)\n\n"+
				`The following commands are available:\n`+
				"`$PREFIXedit add <role name>` to make a role self-assignable\n"+
				"`$PREFIXedit remove <role name>` to make a role not self-assignable\n"+
				"`$PREFIXedit lock <role name>; <applier 1>; [applier 2]; ...` to make a role only self-assignable to people with a role from the list of appliers\n"+
				"`$PREFIXedit clear` to erase the entire list of self-assignable roles",
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
						return bf.sendMessage(msg.channel, bf.lang.saEditPermissionDenied(command.prefix));
					}
				}
				let action = command.regularWords[0];
				let name = command.regularWords.slice(1).join(command.split);
				if (action == "add") {
					if (!name) return bf.sendMessage(msg.channel, `You must name a role to add to the list. See ${command.prefix}help ${command.name} for more details.`);
					let list = await bf.dbRoleList(msg.guild, name, {all: true, locked: true});
					let promise = bf.beginSelection(msg, {
						title: "Multiple matches, select one",
						noMatches: "No matches. Maybe you misspelled the role name?"
					}, list, async (role, confirmMessage) => {
						db.run("INSERT OR IGNORE INTO Roles VALUES (?, ?)", [role.id, msg.guild.id]);
						await promise;
						bf.addReaction(confirmMessage, bf.buttons["green tick"]);
					});
				} else if (action == "remove") {
					if (!name) return bf.sendMessage(msg.channel, `You must name a role to remove from the list. See ${command.prefix}help ${command.name} for more details.`);
					let list = await bf.dbRoleList(msg.guild, name, {locked: true});
					let promise = bf.beginSelection(msg, {
						title: "Multiple matches, select one",
						noMatches: "No matches. Maybe you misspelled the role name?"
					}, list, async (role, confirmMessage) => {
						db.run("DELETE FROM Roles WHERE guildID = ? AND roleID = ?", [msg.guild.id, role.id]);
						await promise;
						bf.addReaction(confirmMessage, bf.buttons["green tick"]);
					});
				} else if (action == "lock") {
					let roleNames = [];
					roleNames.push(command.altWords[0].split(command.split).slice(1).join(command.split));
					roleNames = roleNames.concat(command.altWords.slice(1));
					new bf.InlineRoleListLocker(msg).go(roleNames);
				} else if (action == "clear") {
					bf.reactionMenu(msg.channel, `The list of self-assignable roles will be cleared. Press ${bf.buttons.tick} to confirm.`, [
						{emoji: bf.buttons.tick, ignore: "total", allowedUsers: [msg.author.id], actionType: "js", actionData: async () => {
							await db.run("DELETE FROM Locks WHERE roleID IN (SELECT roleID FROM Roles WHERE guildID = ?)", msg.guild.id);
							await db.run("DELETE FROM Roles WHERE guildID = ?", msg.guild.id);
							bf.sendMessage(msg.channel, "Done.");
						}}
					]);
				} else if (action) {
					bf.sendMessage(msg.channel, bf.lang.invalidAction(command));
				} else {
					bc.list.code(msg, command);
				}
			}
		},
		managers: {
			aliases: ["managers"],
			shortHelp: "Manage which roles are allowed to change bot settings",
			reference: "[add|list|remove] [role name...]",
			longHelp:
				`The managers list is a list of roles. Anyone who has a role that is on the managers list `+
				`will be able to edit the lists of self-assignable roles.\n`+
				`Additionally, anyone who has the permission "Manage Server" will be able to edit those lists.\n`+
				`However, the managers list itself can only be edited by people with "Manage Server".\n\n`+
				`The following commands are available:\n`+
				"`$PREFIXmanagers` or `$PREFIXmanagers list` to view the managers list\n"+
				"`$PREFIXmanagers add <role name>` to add a role to the managers list\n"+
				"`$PREFIXmanagers remove <role name>` to remove a role from the managers list",
			eris: true,
			guildOnly: true,
			category: "Server administrators",
			code: async function(msg, command) {
				// check for guild owner / manage server
				if (!bf.checkMemberManageServer(msg.member)) {
					return bf.sendMessage(msg.channel, bf.lang.managersEditPermissionDenied);
				}
				let action = command.regularWords[0];
				let name = command.regularWords.slice(1).join(command.split);
				if (action == "add") {
					if (!name) return bf.sendMessage(msg.channel, `You must name a role to add to the managers. See ${command.prefix}help ${command.name} for more details.`);
					let list = await bf.dbRoleList(msg.guild, name, {all: true});
					let promise = bf.beginSelection(msg, {
						title: "Multiple matches, select one",
						noMatches: "No matches. Maybe you misspelled the role name?"
					}, list, async (role, confirmMessage) => {
						db.run("INSERT OR IGNORE INTO Managers VALUES (?, ?)", [role.id, msg.guild.id]);
						await promise;
						bf.addReaction(confirmMessage, bf.buttons["green tick"]);
					});
				} else if (action == "remove") {
					if (!name) return bf.sendMessage(msg.channel, `You must name a role to remove from the managers. See ${command.prefix}help ${command.name} for more details.`);
					let list = await db.all("SELECT roleID FROM Managers WHERE guildID = ?", msg.guild.id);
					list = list.map(row => msg.guild.roles.get(row.roleID));
					list = cf.smartFilter(list, "name", name);
					let promise = bf.beginSelection(msg, {
						title: "Multiple matches, select one",
						noMatches: "No matches. Maybe you misspelled the role name?"
					}, list, async (role, confirmMessage) => {
						db.run("DELETE FROM Managers WHERE guildID = ? AND roleID = ?", [msg.guild.id, role.id]);
						await promise;
						bf.addReaction(confirmMessage, bf.buttons["green tick"]);
					});
				} else if (action) {
					bf.sendMessage(msg.channel, bf.lang.invalidAction(command));
				} else {
					let list = await db.all("SELECT roleID FROM Managers WHERE guildID = ?", msg.guild.id);
					list = list.map(row => msg.guild.roles.get(row.roleID).name);
					bf.beginPagination(msg.channel, {
						title: "Managers list",
						footer: {
							text: command.prefix+"managers <add|remove> name"
						}
					}, list);
				}
			}
		},
	}
	return availableFunctions;
}