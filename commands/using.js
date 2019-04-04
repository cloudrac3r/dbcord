module.exports = function(input) {
	let {bot, cf, bf, bc, db} = input;
	let availableFunctions = {
		list: {
			aliases: ["list", "show", "rolelist", "lsar"],
			shortHelp: "Display the self-assignable roles on a server",
			reference: "[filter]",
			longHelp: "Specify a filter to only display roles whose name contains those words.",
			eris: true,
			guildOnly: true,
			category: "Server members",
			code: async function(msg, command) {
				let list = await bf.dbRoleList(msg.guild, command.input, {locked: true, member: msg.member});
				let title = "Self-assignable roles";
				if (command.input) title += " (filtered)";
				bf.beginPagination(msg.channel, {
					title,
					footer: {
						text: command.prefix+"give <name>"
					}
				}, list.map(row => row.name));
			}
		},
		give: {
			aliases: ["give", "get", "add", "set", "iam"],
			shortHelp: "Give yourself a role",
			reference: "<role name>",
			longHelp: "",
			eris: true,
			guildOnly: true,
			category: "Server members",
			code: async function(msg, command) {
				if (!command.input) return bc.list.code(msg, command);
				let list = await bf.dbRoleList(msg.guild, command.input, {locked: true, member: msg.member});
				let promise = bf.beginSelection(msg, {
					title: "Multiple matches, select one",
					noMatches: "No matches. Use `"+command.prefix+"list` to see the available roles."
				}, list, (role, confirmMessage) => {
					bf.friendly.addRole(msg.member, role.id, confirmMessage, command, promise);
				});
			}
		},
		take: {
			aliases: ["take", "remove", "iamn", "iamnot"],
			shortHelp: "Remove a role from yourself",
			reference: "<role name>",
			longHelp: "",
			eris: true,
			guildOnly: true,
			category: "Server members",
			code: async function(msg, command) {
				let list = await bf.dbRoleList(msg.guild, command.input, {locked: true, member: msg.member});
				let promise = bf.beginSelection(msg, {
					title: "Multiple matches, select one",
					noMatches: "No matches. Use `"+command.prefix+"list` to see the available roles."
				}, list, (role, confirmMessage) => {
					bf.friendly.removeRole(msg.member, role.id, confirmMessage, command, promise);
				});
			}
		}
	}
	return availableFunctions;
}