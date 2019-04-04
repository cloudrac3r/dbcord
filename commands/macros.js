module.exports = function(input) {
	let {bot, cf, bf, bc, db} = input;
	let availableFunctions = {
		macro: {
			aliases: ["macro", "macros"],
			shortHelp: "Assign multiple roles to someone else",
			reference: "<role name> [@mention]",
			longHelp:
				`The "macro" command allows you to assign a set of one or more roles to someone else.\n`+
				`A macro is defined as a set of one or more roles.\n`+
				`Macros can be edited by people who match *any one* of these conditions:\n`+
				`- is the server owner\n`+
				`- has the permission "Manage Server" on one of their roles\n`+
				"- has a role that is on the managers list (see `$PREFIXhelp managers` for more)\n\n"+
				`The command can be used as follows:\n`+
				"`$PREFIXmacro <macro name> @mention` to assign those roles to the mentioned user\n"+
				"`$PREFIXmacro` or `$PREFIXmacro list` to view the list of existing macros\n"+
				"`$PREFIXmacro list <macro name> to view the list of roles described by the macro\n"+
				"`$PREFIXmacro edit <macro name>; <role name 1>; [role name 2]; ...` to edit or create a macro\n"+
				"`$PREFIXmacro delete <macro name> to delete a macro",
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
		}
	}
}