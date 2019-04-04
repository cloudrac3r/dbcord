const util = require("util");

module.exports = function(input) {
	let {Discord, bot, cf, bf, db, reloadEvent} = input;

	bf.lang = {};
	bf.lang.alreadyHaveRole = prefix => "You already have that role. (Use `"+prefix+"take` to remove roles.)"
	bf.lang.dontAlreadyHaveRole = prefix => "You don't have that role. (Use `"+prefix+"give` to get roles.)"
	bf.lang.roleExplanation =
		`Make sure I have a role with the permission "Manage Roles", `+
		`and make sure my highest role is above every role you want me to be able to assign.`
	bf.lang.dmExplanation = thing =>
		`I tried to send ${thing} via DM, but it appears you have DMs disabled from me.\n`+
		`If you've blocked me, you'll need to unblock me for me to send you DMs.\n`+
		`If you haven't blocked me, you'll need to enable direct messages in one of our shared servers. `+
		`Open the server menu and select "privacy settings".`
	bf.lang.commandGuildOnly = `This command only works in servers.`
	bf.lang.managersEditPermissionDenied =
		`You aren't allowed to edit the managers list since you don't have the permission "Manage Server".\n`+
		`Give yourself a role with that permission to edit the list.`
	bf.lang.saEditPermissionDenied = prefix =>
		"You aren't allowed to edit the self-assignable role list. See `"+prefix+"help edit` for more information."
	bf.lang.autoEditPermissionDenied = prefix =>
		"You aren't allowed to edit the auto role list. See `"+prefix+"help auto` for more information."
	bf.lang.lockedRole = " ⁽ˡᵒᶜᵏᵉᵈ⁾"
	bf.lang.lockerRoleRequired = (member, lockers) =>
		"That role is locked. You'll be able to add/remove it once you have the role "+
		"`"+member.guild.roles.get(lockers[0].locker).name+"`."
	bf.lang.lockerRoleRequiredMultiple = (member, lockers) =>
		"That role is locked. You'll be able to add/remove it once you have one of the following roles:\n"+
		lockers.map(row => "`"+member.guild.roles.get(row.locker).name+"`").join(", ")
	bf.lang.invalidAction = command =>
		`Invalid action. See \`${command.prefix}help ${command.name}\` for a list of actions.`

	function APIManager(type, promise, confirmMessage, blocker) {
		return promise.then(async () => {
			if (blocker) await blocker;
			bf.addReaction(confirmMessage, bf.buttons["green tick"]);
		}).catch(err => {
			let handled = false;
			function handle(message) {
				bf.sendMessage(confirmMessage.channel, message);
				handled = true;
			}
			if (type[0] == "role") {
				if (err.code == 50001) // Missing Access
					handle(`I do not have permission to ${type[1]} that role.\n${bf.lang.roleExplanation}`);
			}
			if (!handled) {
				console.error(err);
				bf.sendMessage(confirmMessage.channel, "An unknown error occurred.");
				bf.sendMessage(cf.ids.users.cadence, "An unknown error occurred. Check the console.```js\n"+util.stringify(err)+"```");
			}
		});
	}

	async function roleLockManager(member, roleID, confirmMessage) {
		let lockers = await db.all("SELECT locker FROM Locks WHERE roleID = ?", roleID);
		if (lockers.length) {
			if (!lockers.some(row => member.roles.includes(row.locker))) {
				if (lockers.length == 1) bf.sendMessage(confirmMessage.channel, bf.lang.lockerRoleRequired(member, lockers));
				else bf.sendMessage(confirmMessage.channel, bf.lang.lockerRoleRequired(member, lockers));
				return false;
			}
		}
		return true;
	}

	bf.friendly = {
		addRole: async function(member, roleID, confirmMessage, command, blocker) {
			if (member.roles.includes(roleID)) {
				return bf.sendMessage(confirmMessage.channel, bf.lang.alreadyHaveRole(command.prefix));
			} else {
				let allowed = await roleLockManager(member, roleID, confirmMessage);
				if (allowed) return APIManager(["role", "add"], member.addRole(roleID), confirmMessage, blocker);
			}
		},
		removeRole: async function(member, roleID, confirmMessage, command, blocker) {
			if (!member.roles.includes(roleID)) {
				return bf.sendMessage(confirmMessage.channel, bf.lang.dontAlreadyHaveRole(command.prefix));
			} else {
				let allowed = await roleLockManager(member, roleID, confirmMessage);
				if (allowed) return APIManager(["role", "remove"], member.removeRole(roleID), confirmMessage, blocker);
			}
		}
	}
}